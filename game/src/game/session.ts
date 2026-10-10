/** Sessão validada pelo backend Go; o token fica exclusivamente no cookie HttpOnly. */
export interface PlayerSession {
  playerId: string;
  displayName: string;
  email: string;
  devTools?: boolean;
}

const endpoint = '/api/coffe/session';

async function request(path = '', options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(endpoint + path, {
      ...options, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
  }
}

export async function resolveSession(): Promise<PlayerSession | null> {
  const response = await request();
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('Servidor indisponível. Tente novamente.');
  return response.json() as Promise<PlayerSession>;
}

export async function login(email: string, password: string): Promise<PlayerSession> {
  const response = await request('/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (response.status === 401) throw new Error('Email ou senha inválidos.');
  if (!response.ok) throw new Error('Não foi possível entrar. Tente novamente.');
  const session = await response.json() as PlayerSession;
  notifySessionChange();
  return session;
}

export async function logout(): Promise<void> {
  const response = await request('/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Não foi possível sair. Tente novamente.');
  notifySessionChange();
}

function notifySessionChange(): void {
  try { localStorage.setItem('coffe-auth-change', String(Date.now())); } catch { /* Storage opcional. */ }
}
