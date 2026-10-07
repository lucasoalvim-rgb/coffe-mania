/**
 * As 10 frases do rodapé da tela de loading.
 * Giram no relógio próprio de 2200ms, sem relação com o progresso.
 */
export const LOADING_MESSAGES: readonly string[] = [
  'Moendo os grãos...',
  'Aquecendo a máquina de espresso...',
  'Polindo as canecas...',
  'Vaporizando o leite...',
  'Arrumando as mesas...',
  'Acordando os baristas...',
  'Conferindo o estoque de açúcar...',
  'Assando os pãezinhos...',
  'Abrindo as cortinas...',
  'Servindo o primeiro cafezinho...',
] as const;

export const MESSAGE_COUNT = LOADING_MESSAGES.length;

/** Progresso percentual seguido da mensagem de carregamento. */
export function formatProgressLabel(progress: number, message: string): string {
  const percent = Math.max(0, Math.min(100, Math.floor(progress)));
  return `${percent}% - ${message}`;
}
