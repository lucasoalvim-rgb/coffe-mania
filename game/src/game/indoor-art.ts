/** Geometria dos sprites de interior. left/top são relativos ao canto superior do tile; cada frame representa uma rotação e a pegada troca de eixos nas rotações ímpares. */

import type { Texture } from 'pixi.js';
import type { DoorArtGeometry } from '../world/doorGeometry';

export interface IndoorArtFrame {
  file: string;
  width: number;
  height: number;
  /** Caixa da arte em relação à origem do símbolo. */
  left: number;
  top: number;
}

export interface IndoorArtEntry {
  characterId: number;
  /** Um por rotação, na ordem em que `rotate()` percorre. */
  frames: IndoorArtFrame[];
  /** Orientação da face única de papel de parede; a outra é espelhada ao renderizar. */
  wallpaperRotation?: 0 | 1;
  /** Porta de chão 1×1: face traseira e articulação independentes das margens do PNG. */
  door?: DoorArtGeometry;
  /** Fração da altura removida da parede, carregada do manifesto visual da porta. */
  wallCutterIndex?: number;
  sizeX: number;
  sizeY: number;
  /** Pegada medida na arte, antes do override do catálogo. */
  sizeFromArt?: { sizeX: number; sizeY: number };
  /** Altura do móvel acima do piso do tile. */
  itemHeight: number;
}

/** Cenário urbano externo, alinhado à origem isométrica da sala. */
export interface IndoorSceneBackground {
  file: string;
  width: number;
  height: number;
  left: number;
  top: number;
  tiles?: readonly {
    file: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }[];
  sources: readonly {
    className: string;
    characterId: number;
    left: number;
    top: number;
  }[];
}

export interface IndoorArtFile {
  source: string;
  exportScale?: number;
  generatedAt: string;
  tile: { width: number; height: number };
  sceneBackground?: IndoorSceneBackground;
  items: Record<string, IndoorArtEntry>;
}

export interface RotatedArt {
  frame: IndoorArtFrame;
  sizeX: number;
  sizeY: number;
}

/** O que a tela precisa para desenhar arte real: o manifesto e as texturas. */
export interface ArtProvider {
  art: IndoorArt;
  textureFor(file: string): Texture | undefined;
}

export class IndoorArt {
  constructor(
    readonly entries: Readonly<Record<string, IndoorArtEntry>>,
    readonly sceneBackground?: Readonly<IndoorSceneBackground>,
  ) {}

  static from(raw: unknown): IndoorArt {
    if (typeof raw !== 'object' || raw === null) throw new Error('manifesto de arte inválido');
    const file = raw as Partial<IndoorArtFile>;
    if (typeof file.items !== 'object' || file.items === null) {
      throw new Error('manifesto de arte inválido: falta items');
    }
    for (const [className, entry] of Object.entries(file.items)) {
      if (!Array.isArray(entry.frames) || entry.frames.length === 0) {
        throw new Error(`manifesto de arte inválido: ${className} sem frames`);
      }
    }
    return new IndoorArt(file.items, file.sceneBackground);
  }

  get size(): number {
    return Object.keys(this.entries).length;
  }

  has(className: string | undefined): boolean {
    return className !== undefined && className in this.entries;
  }

  get(className: string | undefined): IndoorArtEntry | undefined {
    return className === undefined ? undefined : this.entries[className];
  }

  /** Todos os PNGs referenciados, para carregar de uma vez. */
  files(): string[] {
    const files = Object.values(this.entries).flatMap((entry) => entry.frames.map((frame) => frame.file));
    if (this.sceneBackground) {
      files.push(...(this.sceneBackground.tiles?.map((tile) => tile.file) ?? [this.sceneBackground.file]));
    }
    return files;
  }
}

/**
 * Aplica a rotação: escolhe o frame e troca a pegada quando o número de rotações
 * é ímpar (cada `rotate()` troca numTilesX com numTilesY).
 */
export function rotatedArt(entry: IndoorArtEntry, rotation: number): RotatedArt {
  const passos = Math.max(0, Math.floor(rotation));
  const frame = entry.frames[passos % entry.frames.length];
  const trocou = passos % 2 === 1;
  return {
    frame,
    sizeX: trocou ? entry.sizeY : entry.sizeX,
    sizeY: trocou ? entry.sizeX : entry.sizeY,
  };
}
