import type { ResolvedLook } from './wardrobe';

/** Compõe a textura 256×256 sobre a cor da pele, em ordem de prioridade. tx/ty preservam o posicionamento de cada símbolo dentro da textura. */

export interface AtlasSymbol {
  /** Posição na folha do atlas. */
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Posição na textura 256x256 do avatar. */
  tx: number;
  ty: number;
}

export interface AtlasFile {
  sheet: [number, number];
  texSize: number;
  symbols: Record<string, AtlasSymbol>;
}

export function parseAtlas(raw: unknown): AtlasFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('atlas do avatar inválido');
  const file = raw as Partial<AtlasFile>;
  if (!Array.isArray(file.sheet) || typeof file.texSize !== 'number' || typeof file.symbols !== 'object') {
    throw new Error('atlas do avatar inválido: faltam sheet, texSize ou symbols');
  }
  return file as AtlasFile;
}

export const rgbToCss = (colour: number): string =>
  `#${(colour & 0xffffff).toString(16).padStart(6, '0')}`;

export interface ComposeTarget {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Desenha a textura do look num canvas. Devolve a lista de símbolos que não
 * existiam no atlas — vazia é o esperado.
 */
export function composeAvatarTexture(
  target: ComposeTarget,
  sheet: CanvasImageSource,
  atlas: AtlasFile,
  look: ResolvedLook,
): string[] {
  const context = target.getContext('2d');
  if (!context) throw new Error('sem contexto 2d para compor a textura do avatar');

  const size = atlas.texSize;
  target.width = size;
  target.height = size;

  context.clearRect(0, 0, size, size);
  context.fillStyle = rgbToCss(look.skinColour);
  context.fillRect(0, 0, size, size);

  const faltando: string[] = [];
  for (const name of look.textureLayers) {
    const symbol = atlas.symbols[name];
    if (!symbol) {
      faltando.push(name);
      continue;
    }
    context.drawImage(sheet, symbol.sx, symbol.sy, symbol.w, symbol.h, symbol.tx, symbol.ty, symbol.w, symbol.h);
  }

  return faltando;
}
