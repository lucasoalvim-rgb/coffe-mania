import { createInterface } from 'node:readline';

/** Use the installed CLI/config: no token is stored in the project. */
export function startNgrok({ port, launch, onExit, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const child = launch(process.env.COFFE_NGROK ?? 'ngrok', [
      'http', `http://127.0.0.1:${port}`, '--log=stdout', '--log-format=json',
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    let ready = false;
    const timer = setTimeout(() => {
      reject(new Error('O ngrok não abriu o túnel em 30 segundos. Verifique a conexão e a configuração do ngrok.'));
    }, timeoutMs);
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let entry;
      try { entry = JSON.parse(line); } catch { return; }
      if (ready || entry.msg !== 'started tunnel' || typeof entry.url !== 'string') return;
      let url;
      try { url = new URL(entry.url); } catch { return; }
      if (url.protocol !== 'https:' || url.username || url.password) return;
      ready = true;
      clearTimeout(timer);
      resolve(url.origin);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      lines.close();
      const message = error.code === 'ENOENT'
        ? 'ngrok não encontrado. Adicione-o ao PATH ou configure COFFE_NGROK com o caminho do executável.'
        : `Não foi possível iniciar o ngrok: ${error.message}`;
      if (ready) onExit(new Error(message));
      else reject(new Error(message));
    });
    child.on('close', () => {
      clearTimeout(timer);
      lines.close();
      const error = new Error('O túnel ngrok foi encerrado. Verifique as mensagens acima e a autenticação/configuração do ngrok.');
      if (ready) onExit(error);
      else reject(error);
    });
  });
}
