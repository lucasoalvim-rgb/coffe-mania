import type { Point, Tile } from './iso';

/** Intrínsecos da folha: um PNG estreito, na face traseira de um piso 1×1. */
export interface DoorArtGeometry {
  /** 0: aresta tx=0 (↖); 1: aresta ty=0 (↗). A outra face é espelhada. */
  sourceRotation: 0 | 1;
  /** Pé da dobradiça na imagem, antes do espelhamento. */
  hinge: Point;
  /** Inclinação da base desenhada no PNG: normalmente -0,5 ou +0,5. */
  baseSlope: number;
}

/** A porta é de chão; o segmento recortado fica atrás do seu tile, não nele. */
export function doorOpeningTile(item: Tile & { rotation: number }): Tile {
  return item.rotation % 2 === 0
    ? { tx: item.tx - 1, ty: item.ty }
    : { tx: item.tx, ty: item.ty - 1 };
}

/** Rotação de uma folha vertical na projeção 2:1, sem deslocar a dobradiça. */
export function doorLeafVertices(
  width: number, height: number, hingeX: number, baseSlope: number, openness: number,
): Float32Array {
  const angle = Math.max(0, Math.min(1, openness)) * Math.PI / 2;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const vertices = new Float32Array([0, 0, width, 0, width, height, 0, height]);
  for (let i = 0; i < vertices.length; i += 2) {
    const fromHinge = vertices[i] - hingeX;
    vertices[i] = hingeX + fromHinge * (cos - sin);
    // O PNG já contém o desnível da base. Corrija só a diferença da rotação;
    // a 90° a ponta livre continua sobre o piso, e as linhas verticais não tombam.
    vertices[i + 1] += fromHinge * baseSlope * (cos + sin - 1);
  }
  return vertices;
}
