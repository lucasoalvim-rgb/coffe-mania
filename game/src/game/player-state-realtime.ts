import { loadPlayerState, type PlayerState } from './player-state';

const TOPIC = 'player_state/*';

/** Native PocketBase SSE, with cookie-authenticated subscriptions. Notifications
 * invalidate the snapshot, avoiding a second mapping of raw DB fields in the UI.
 * Only one refresh runs at a time; bursts coalesce and stale responses are skipped.
 */
export function subscribePlayerState(onState: (state: PlayerState) => void): () => void {
  let stopped = false;
  let source: EventSource | undefined;
  let controller: AbortController | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 1000;

  function disconnect(): void {
    if (retry !== undefined) clearTimeout(retry);
    retry = undefined;
    source?.close();
    source = undefined;
    controller?.abort();
    controller = undefined;
  }

  function reconnect(): void {
    if (stopped) return;
    disconnect();
    retry = setTimeout(connect, retryMs);
    retryMs = Math.min(15000, retryMs * 2);
  }

  function connect(): void {
    if (stopped) return;
    disconnect();
    const connection = new EventSource('/api/realtime', { withCredentials: true });
    const abort = new AbortController();
    source = connection;
    controller = abort;
    let dirty = false;
    let refreshing = false;

    async function refresh(): Promise<void> {
      dirty = true;
      if (refreshing) return;
      refreshing = true;
      try {
        while (dirty && !abort.signal.aborted) {
          dirty = false;
          const state = await loadPlayerState(abort.signal);
          if (!abort.signal.aborted && !dirty) onState(state);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.warn('[player-state] sincronização indisponível; reconectando', error);
          reconnect();
        }
      } finally {
        refreshing = false;
      }
    }

    connection.addEventListener('PB_CONNECT', (event) => {
      void (async () => {
        try {
          const { clientId } = JSON.parse((event as MessageEvent<string>).data) as { clientId: string };
          if (!clientId) throw new Error('Identificador realtime ausente.');
          const response = await fetch('/api/realtime', {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, subscriptions: [TOPIC] }),
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
          });
          if (abort.signal.aborted) return;
          if (response.status === 401) {
            stop();
            window.location.replace('/');
            return;
          }
          if (!response.ok) throw new Error(`Assinatura realtime: HTTP ${response.status}`);
          retryMs = 1000;
          // Subscribe first, then fetch: recover changes made during asset loading
          // or a disconnect without leaving a snapshot-to-subscription race.
          await refresh();
        } catch (error) {
          if (!abort.signal.aborted) {
            console.warn('[player-state] assinatura indisponível; reconectando', error);
            reconnect();
          }
        }
      })();
    });
    connection.addEventListener(TOPIC, () => { void refresh(); });
    connection.addEventListener('error', () => {
      if (!abort.signal.aborted) reconnect();
    });
  }

  // Close streams on page exit, but resume correctly on a mobile/bfcache return.
  const onPageHide = () => { disconnect(); };
  const onPageShow = () => { if (!source && !stopped) connect(); };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  function stop(): void {
    stopped = true;
    disconnect();
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  }

  connect();
  return stop;
}
