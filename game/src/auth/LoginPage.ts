import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import './login.css';

import { login, logout, type PlayerSession } from '../game/session';

function card(host: HTMLElement): HTMLElement {
  host.innerHTML = `
    <main class="login-card">
      <h1>Coffe Mania</h1>
      <div class="login-content"></div>
      <p class="login-error" role="alert" aria-live="polite"></p>
    </main>`;
  return host.querySelector<HTMLElement>('.login-content')!;
}

export function renderLoginPage(host: HTMLElement, session: PlayerSession | null): void {
  const content = card(host);
  const error = host.querySelector<HTMLElement>('.login-error')!;
  if (session) {
    content.innerHTML = `
      <p class="login-welcome"></p>
      <a class="login-primary" href="/play">Jogar</a>
      <button class="login-secondary" type="button">Sair</button>`;
    content.querySelector<HTMLElement>('.login-welcome')!.textContent = session.displayName;
    const requestedRoom = new URLSearchParams(window.location.search).get('room');
    if (requestedRoom) content.querySelector('a')!.setAttribute('href', '/play?room=' + encodeURIComponent(requestedRoom));
    const button = content.querySelector<HTMLButtonElement>('button')!;
    button.addEventListener('click', async () => {
      button.disabled = true;
      error.textContent = '';
      try {
        await logout();
        renderLoginPage(host, null);
      } catch (reason) {
        error.textContent = errorMessage(reason);
        button.disabled = false;
      }
    });
    return;
  }
  content.innerHTML = `
    <p class="login-subtitle">Entre para abrir seu café.</p>
    <form class="login-form">
      <label for="login-email">Email</label>
      <input id="login-email" name="email" type="email" autocomplete="username" required>
      <label for="login-password">Senha</label>
      <input id="login-password" name="password" type="password" autocomplete="current-password" required>
      <button class="login-primary" type="submit">Entrar</button>
    </form>`;
  const form = content.querySelector<HTMLFormElement>('form')!;
  const button = form.querySelector<HTMLButtonElement>('button')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Entrando…';
    error.textContent = '';
    const data = new FormData(form);
    try {
      await login(String(data.get('email')).trim(), String(data.get('password')));
      const room = new URLSearchParams(window.location.search).get('room');
      window.location.assign(room ? '/play?room=' + encodeURIComponent(room) : '/play');
    } catch (reason) {
      error.textContent = errorMessage(reason);
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
}

export function renderSessionError(host: HTMLElement, error: unknown): void {
  document.body.classList.add('auth-page');
  const content = card(host);
  host.querySelector<HTMLElement>('.login-error')!.textContent = errorMessage(error);
  content.innerHTML = '<button class="login-primary" type="button">Tentar novamente</button>';
  content.querySelector('button')!.addEventListener('click', () => window.location.reload());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocorreu um erro. Tente novamente.';
}
