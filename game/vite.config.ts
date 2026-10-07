import { defineConfig, loadEnv } from 'vite';
import type { ProxyOptions } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), 'COFFE_'), ...process.env };
  const backendURL = env.COFFE_BACKEND_URL ?? `http://127.0.0.1:${env.COFFE_DATABASE_PORT ?? '8090'}`;
  const gameURL = env.COFFE_GAME_URL ?? `http://127.0.0.1:${env.COFFE_GAME_PORT ?? '8091'}`;
  const tunnelHost = env.COFFE_NGROK_ORIGIN ? new URL(env.COFFE_NGROK_ORIGIN).host : undefined;
  const backendProxy = (): ProxyOptions => ({
    target: backendURL,
    changeOrigin: false,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Only the configured HTTPS tunnel can supply the forwarded scheme.
        proxyReq.setHeader('X-Forwarded-Proto', tunnelHost && req.headers.host === tunnelHost ? 'https' : 'http');
      });
    },
  });
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: '/',
    plugins: [{
      name: 'coffe-play-auth',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (tunnelHost && req.headers.host === tunnelHost && (url.pathname === '/_' || url.pathname.startsWith('/_/'))) {
            res.writeHead(404); res.end(); return;
          }
          if (url.pathname !== '/play' && url.pathname !== '/play/') return next();
          res.setHeader('Cache-Control', 'no-store');
          try {
            const session = await fetch(backendURL + '/api/coffe/session', {
              headers: { cookie: req.headers.cookie ?? '' }, signal: AbortSignal.timeout(8000),
            });
            if (session.status === 401) {
              const room = url.searchParams.get('room');
              res.writeHead(303, { Location: room ? '/?room=' + encodeURIComponent(room) : '/' }); res.end();
            } else if (session.ok) {
              next();
            } else {
              res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Servidor indisponível.');
            }
          } catch {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Backend indisponível. Inicie os serviços com npm run dev.');
          }
        });
      },
    }],
    optimizeDeps: { entries: ['index.html'] },
    server: {
      host: '0.0.0.0',
      port: Number(env.COFFE_WEB_PORT ?? 5173),
      strictPort: true,
      allowedHosts: tunnelHost ? [tunnelHost] : [],
      proxy: {
        '/game': { target: gameURL, ws: true, changeOrigin: false },
        '/api': backendProxy(),
        '/_': backendProxy(),
      },
    },
    build: { target: 'es2022', assetsInlineLimit: 0 },
  };
});
