import { renderLoginPage, renderSessionError } from './auth/LoginPage';
import { resolveSession } from './game/session';

async function start(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app não encontrado');
  const playing = window.location.pathname === '/play' || window.location.pathname === '/play/';
  document.body.classList.add('auth-page');
  host.innerHTML = '<p class="auth-check" role="status">Verificando sessão…</p>';
  try {
    const session = await resolveSession();
    if (playing) {
      if (!session) {
        const room = new URLSearchParams(window.location.search).get('room');
        window.location.replace(room ? '/?room=' + encodeURIComponent(room) : '/');
        return;
      }
      document.body.classList.remove('auth-page');
      host.replaceChildren();
      await import('./play');
      const checkAccess = async () => {
        if (document.hidden) return;
        try {
          if (!await resolveSession()) window.location.replace('/');
        } catch { /* Uma falha de rede temporária não encerra uma sessão válida. */ }
      };
      window.addEventListener('pageshow', () => { void checkAccess(); });
      document.addEventListener('visibilitychange', () => { void checkAccess(); });
      window.addEventListener('storage', (event) => {
        if (event.key === 'coffe-auth-change') void checkAccess();
      });
    } else {
      renderLoginPage(host, session);
    }
  } catch (error) {
    renderSessionError(host, error);
  }
}

void start();
