import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';

import { LOADING_MESSAGES } from '../screens/loading/messages';
import { FONT_FAMILY, FONT_WEIGHT } from './font-tokens';

export { FONT_FAMILY, FONT_WEIGHT } from './font-tokens';

/** Carrega a Fredoka antes de criar textos Pixi, que rasterizam imediatamente. A amostra inclui dígitos e acentos para carregar os subsets necessários. */

const SAMPLE_TEXT = `0123456789% -${LOADING_MESSAGES.join('')}`;

let pending: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  if (pending) return pending;

  pending = (async () => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) return;

    try {
      await Promise.all([
        fonts.load(`400 50px "${FONT_FAMILY}"`, SAMPLE_TEXT),
        fonts.load(`${FONT_WEIGHT} 50px "${FONT_FAMILY}"`, SAMPLE_TEXT),
        fonts.load(`700 50px "${FONT_FAMILY}"`, SAMPLE_TEXT),
      ]);
      await fonts.ready;
    } catch (error) {
      // Sem a Fredoka o jogo ainda roda, só sai com a fonte de fallback.
      console.warn('[fonts] falha ao carregar a Fredoka', error);
    }
  })();

  return pending;
}

/** Verdadeiro quando a Fredoka 600 já está pronta para rasterizar. */
export function isFontReady(): boolean {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return false;
  return fonts.check(`${FONT_WEIGHT} 50px "${FONT_FAMILY}"`, SAMPLE_TEXT);
}
