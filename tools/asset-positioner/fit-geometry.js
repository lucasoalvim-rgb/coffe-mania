/* Encaixe de arte isométrica na pegada 2:1: detecção dos cantos pela silhueta, solução e reamostragem.
 * Coordenadas locais (u, v) são pixels nativos da imagem já espelhada como aparece no editor; o resultado
 * fica em coordenadas nativas relativas à origem do tile. Usado pelo Posicionador e por scripts Node. */
'use strict';
(() => {
  const TILE_ANGLE = Math.atan(.5) * 180 / Math.PI;
  const project = (tx, ty, height = 0) => ({ x: (tx - ty) * 80, y: (tx + ty) * 40 - height });
  const angle = (slope) => Math.atan(Math.abs(slope)) * 180 / Math.PI;
  const slopeOf = (a, b) => (b.y - a.y) / (b.x - a.x);
  const finitePoint = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);

  /** Cantos da pegada no chão. As arestas esquerda→frente e trás→direita sobem 0,5; as outras descem. */
  function footprintCorners(sizeX = 1, sizeY = 1) {
    return { back: project(0, 0), right: project(sizeX, 0), front: project(sizeX, sizeY), left: project(0, sizeY) };
  }

  // Contorno superior e inferior por coluna, com cruzamento subpixel do limiar entre centros de pixels.
  function columnEdges(alpha, width, height, threshold) {
    const top = new Float64Array(width).fill(NaN), bottom = new Float64Array(width).fill(NaN);
    const peak = new Uint8Array(width);
    let minX = -1, maxX = -1;
    for (let x = 0; x < width; x++) {
      let y0 = -1, y1 = -1;
      for (let y = 0; y < height; y++) {
        const a = alpha[y * width + x];
        if (a > peak[x]) peak[x] = a;
        if (a >= threshold) { if (y0 < 0) y0 = y; y1 = y; }
      }
      if (y0 < 0) continue;
      if (minX < 0) minX = x;
      maxX = x;
      const a0 = alpha[y0 * width + x], above = y0 > 0 ? alpha[(y0 - 1) * width + x] : 0;
      top[x] = y0 - .5 + Math.min(1, (threshold - above) / Math.max(1, a0 - above));
      const a1 = alpha[y1 * width + x], below = y1 < height - 1 ? alpha[(y1 + 1) * width + x] : 0;
      bottom[x] = y1 + .5 + Math.min(1, (a1 - threshold) / Math.max(1, a1 - below));
    }
    if (minX < 0) return null;
    const sideEdge = (x, outside) => {
      const inner = Math.max(1, peak[x]), outer = outside >= 0 && outside < width ? peak[outside] : 0;
      return Math.min(1, Math.max(0, (inner - threshold) / Math.max(1, inner - outer)));
    };
    return { top, bottom, minX, maxX,
      left: minX + .5 - sideEdge(minX, minX - 1), right: maxX + .5 + sideEdge(maxX, maxX + 1) };
  }

  // Mínimos quadrados y = m·x + q com uma rodada de rejeição de pontos fora da reta (pés, sombras, rebarbas).
  function fitLine(edge, from, to) {
    const points = [];
    for (let x = Math.ceil(from); x <= Math.floor(to); x++) if (Number.isFinite(edge[x])) points.push([x + .5, edge[x]]);
    const solve = (list) => {
      const n = list.length;
      if (n < 3) return null;
      let sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (const [x, y] of list) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      const det = n * sxx - sx * sx;
      if (Math.abs(det) < 1e-9) return null;
      const m = (n * sxy - sx * sy) / det, q = (sy - m * sx) / n;
      const rms = Math.sqrt(list.reduce((sum, [x, y]) => sum + (m * x + q - y) ** 2, 0) / n);
      return { m, q, rms, n };
    };
    let line = solve(points);
    if (!line) return null;
    const limit = Math.max(1, 2.5 * line.rms);
    const kept = points.filter(([x, y]) => Math.abs(line.m * x + line.q - y) <= limit);
    if (kept.length >= Math.max(3, points.length * .6) && kept.length < points.length) line = solve(kept) || line;
    return line;
  }

  // Um "V" do contorno: duas retas que se encontram no vértice (frente da base ou trás do tampo).
  function fitPlane(edge, outline, lowest, names) {
    const { minX, maxX, left: xLeft, right: xRight } = outline;
    let apex = minX, best = lowest ? -Infinity : Infinity;
    for (let x = minX; x <= maxX; x++) {
      const y = edge[x];
      if (Number.isFinite(y) && (lowest ? y > best : y < best)) { best = y; apex = x; }
    }
    const plateau = [];
    for (let x = minX; x <= maxX; x++) if (Number.isFinite(edge[x]) && Math.abs(edge[x] - best) <= .5) plateau.push(x);
    apex = plateau[Math.floor(plateau.length / 2)] ?? apex;
    const dl = apex - minX, dr = maxX - apex;
    const lineL = fitLine(edge, minX + dl * .1, apex - dl * .15);
    const lineR = fitLine(edge, apex + dr * .15, maxX - dr * .1);
    if (!lineL || !lineR) return null;
    // A base desce até a frente (esquerda > 0, direita < 0); o tampo sobe até o canto traseiro.
    if (lowest ? !(lineL.m > 0 && lineR.m < 0) : !(lineL.m < 0 && lineR.m > 0)) return null;
    const ax = Math.abs(lineL.m - lineR.m) > 1e-6 ? (lineR.q - lineL.q) / (lineL.m - lineR.m) : apex + .5;
    return {
      left: { x: xLeft, y: lineL.m * xLeft + lineL.q },
      [names.apex]: { x: ax, y: lineL.m * ax + lineL.q },
      right: { x: xRight, y: lineR.m * xRight + lineR.q },
      rms: Math.max(lineL.rms, lineR.rms),
    };
  }

  /**
   * Detecta os cantos da base (esquerdo, frontal, direito) e do tampo (esquerdo, traseiro, direito) pela
   * silhueta alfa. É um ponto de partida: pés, sombras e saliências pedem ajuste manual dos pontos.
   */
  function detect(alpha, width, height, { threshold = 128 } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || alpha.length < width * height) {
      throw new Error('Imagem inválida para a detecção.');
    }
    const outline = columnEdges(alpha, width, height, threshold);
    if (!outline || outline.maxX - outline.minX < 12) throw new Error('Silhueta pequena ou vazia: reduza o limiar ou confira a transparência.');
    return {
      base: fitPlane(outline.bottom, outline, true, { apex: 'front' }),
      top: fitPlane(outline.top, outline, false, { apex: 'back' }),
    };
  }

  /** RGBA (4 bytes por pixel) para um canal alfa contíguo. */
  function alphaChannel(rgba, width, height) {
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return alpha;
  }

  /*
   * Transformação por partes que preserva as verticais:
   *   X = x + (u ≤ k ? aL·u : aL·k + aR·(u − k))
   *   Y = y + c·v + (u ≤ k ? bL·u : bL·k + bR·(u − k))
   * Com k = 0 e aL = aR, bL = bR = 0, é um retângulo escalado. No modo de ângulo, k é a coluna do vértice:
   * cada face visível recebe sua escala horizontal e seu cisalhamento vertical; a escala vertical c é comum.
   */
  function rectTransform(x, y, scaleX = 1, scaleY = scaleX) {
    return { k: 0, aL: scaleX, aR: scaleX, bL: 0, bR: 0, c: scaleY, x, y };
  }

  function map(t, p) {
    const left = p.x <= t.k;
    const du = left ? p.x : p.x - t.k;
    return {
      x: t.x + (left ? t.aL * du : t.aL * t.k + t.aR * du),
      y: t.y + t.c * p.y + (left ? t.bL * du : t.bL * t.k + t.bR * du),
    };
  }

  function inverse(t, p) {
    const kx = t.aL * t.k;
    const rx = p.x - t.x;
    const u = rx <= kx ? rx / t.aL : t.k + (rx - kx) / t.aR;
    const base = u <= t.k ? t.bL * u : t.bL * t.k + t.bR * (u - t.k);
    return { x: u, y: (p.y - t.y - base) / t.c };
  }

  function transformedBounds(t, width, height) {
    const k = Math.max(0, Math.min(width, t.k));
    const corners = [[0, 0], [width, 0], [0, height], [width, height], [k, 0], [k, height]]
      .map(([x, y]) => map(t, { x, y }));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  function validTransform(t) {
    return ['k', 'aL', 'aR', 'bL', 'bR', 'c', 'x', 'y'].every((key) => Number.isFinite(t?.[key])) &&
      t.aL > 0 && t.aR > 0 && t.c > 0;
  }

  const planeKeys = (plane) => plane === 'top' ? ['left', 'back', 'right'] : ['left', 'front', 'right'];
  const validPlane = (points, plane) => Boolean(points) && planeKeys(plane).every((key) => finitePoint(points[key])) &&
    points.left.x < points[planeKeys(plane)[1]].x && points[planeKeys(plane)[1]].x < points.right.x;

  /**
   * Calcula a transformação que leva o plano de referência da arte à pegada.
   * plane: 'base' (cantos esquerdo, frontal e direito no chão) ou 'top' (esquerdo, traseiro e direito do
   * tampo, numa altura livre; a frente da base continua apoiada na frente do tile).
   * mode: 'translate' (1:1, offsets inteiros), 'uniform' (escala uniforme, sem distorção) ou
   * 'angle' (arestas exatamente a 26,565°, verticais preservadas, escala vertical comum).
   */
  function solve({ points, plane = 'base', mode = 'uniform', sizeX = 1, sizeY = 1 }) {
    if (!['base', 'top'].includes(plane) || !['translate', 'uniform', 'angle'].includes(mode)) {
      throw new Error('Escolha um plano de referência e um modo válidos.');
    }
    const ref = plane === 'top' ? points?.top : points?.base;
    if (!validPlane(ref, plane)) {
      throw new Error(plane === 'top' ? 'Marque os cantos esquerdo, traseiro e direito do tampo.' : 'Marque os cantos esquerdo, frontal e direito da base.');
    }
    const other = plane === 'top' ? points.base : points.top;
    const otherPlane = plane === 'top' ? 'base' : 'top';
    const anchor = plane === 'top' ? points.base?.front : null;
    if (plane === 'top' && !finitePoint(anchor)) throw new Error('Com o tampo como referência, marque também a frente da base (apoio no chão).');
    const keys = planeKeys(plane), apexKey = keys[1];
    const D = footprintCorners(sizeX, sizeY);
    const source = keys.map((key) => ref[key]), target = keys.map((key) => D[key]);
    const mean = (list, key) => list.reduce((sum, p) => sum + p[key], 0) / list.length;
    const notes = [];
    let t;

    if (mode !== 'angle') {
      let s = 1;
      if (mode === 'uniform') {
        const px = mean(source, 'x'), py = mean(source, 'y'), qx = mean(target, 'x'), qy = mean(target, 'y');
        let num = 0, den = 0;
        source.forEach((p, i) => {
          num += (p.x - px) * (target[i].x - qx) + (p.y - py) * (target[i].y - qy);
          den += (p.x - px) ** 2 + (p.y - py) ** 2;
        });
        s = den > 0 ? num / den : 1;
      }
      const x = mean(target, 'x') - s * mean(source, 'x');
      const y = plane === 'top' ? D.front.y - s * anchor.y : mean(target, 'y') - s * mean(source, 'y');
      t = rectTransform(mode === 'translate' ? Math.round(x) : x, mode === 'translate' ? Math.round(y) : y, s);
    } else {
      const [P, A, R] = source, [TL, TA, TR] = target;
      const aL = (TA.x - TL.x) / (A.x - P.x), aR = (TR.x - TA.x) / (R.x - A.x);
      const mL = slopeOf(P, A), mR = slopeOf(A, R), sL = slopeOf(TL, TA), sR = slopeOf(TA, TR);
      // A escala vertical vem da outra face (tampo ou base): ela também deve terminar a 26,565°.
      let c = null;
      if (validPlane(other, otherPlane)) {
        const [oP, oA, oR] = planeKeys(otherPlane).map((key) => other[key]);
        const [oTL, oTA, oTR] = planeKeys(otherPlane).map((key) => D[key]);
        const kL = (slopeOf(oP, oA) - mL) / (aL * (slopeOf(oTL, oTA) - sL));
        const kR = (slopeOf(oA, oR) - mR) / (aR * (slopeOf(oTA, oTR) - sR));
        const estimate = (kL + kR) / (kL * kL + kR * kR);
        if (kL > 0 && kR > 0 && estimate > .5 && estimate < 2) c = estimate;
        else notes.push(`Cantos ${otherPlane === 'top' ? 'do tampo' : 'da base'} incoerentes; escala vertical estimada só pelo plano de referência.`);
      }
      if (c === null) {
        c = (aL + aR) / 2 * (sR - sL) / (mR - mL);
        if (!(c > .5 && c < 2)) throw new Error('Os cantos marcados não formam um losango plausível.');
      }
      const bL = sL * aL - c * mL, bR = sR * aR - c * mR;
      t = { k: A.x, aL, aR, bL, bR, c, x: TA.x - aL * A.x, y: 0 };
      t.y = plane === 'top' ? D.front.y - map(t, anchor).y : TA.y - map(t, A).y;
    }
    if (!validTransform(t)) throw new Error('Não foi possível calcular um encaixe com esses cantos.');
    return { transform: t, notes, ...evaluate({ points, plane, transform: t, sizeX, sizeY }) };
  }

  /** Ângulos antes/depois e desvio dos cantos de referência em relação à pegada (o tampo pode ter altura livre). */
  function evaluate({ points, plane = 'base', transform, sizeX = 1, sizeY = 1 }) {
    const D = footprintCorners(sizeX, sizeY);
    const summary = (planePoints, name, mapped) => {
      if (!validPlane(planePoints, name)) return null;
      const [P, A, R] = planeKeys(name).map((key) => mapped ? map(transform, planePoints[key]) : planePoints[key]);
      return { left: angle(slopeOf(P, A)), right: angle(slopeOf(A, R)) };
    };
    const result = {
      angles: { tile: TILE_ANGLE,
        before: { base: summary(points?.base, 'base', false), top: summary(points?.top, 'top', false) },
        after: { base: summary(points?.base, 'base', true), top: summary(points?.top, 'top', true) } },
      deviations: null, maxDeviation: null, height: 0,
    };
    const ref = plane === 'top' ? points?.top : points?.base;
    if (!validPlane(ref, plane) || !validTransform(transform)) return result;
    const keys = planeKeys(plane);
    const mapped = keys.map((key) => map(transform, ref[key]));
    // Altura do tampo: deslocamento vertical médio entre os cantos mapeados e o losango do chão.
    const height = plane === 'top' ? keys.reduce((sum, key, i) => sum + D[key].y - mapped[i].y, 0) / keys.length : 0;
    result.height = height;
    result.deviations = Object.fromEntries(keys.map((key, i) => [key, Math.hypot(mapped[i].x - D[key].x, mapped[i].y - (D[key].y - height))]));
    result.maxDeviation = Math.max(...Object.values(result.deviations));
    return result;
  }

  function validateOutput(width, height) {
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16000000) {
      throw new Error('Resultado muito grande: limite de 8192 px por lado e 16 milhões de pixels.');
    }
  }

  /**
   * Reamostra RGBA com a transformação. Translação inteira 1:1 copia os pixels sem filtro; as demais usam
   * bilinear em alfa pré-multiplicado com superamostragem (ou o vizinho mais próximo, para pixel art).
   * left/top são inteiros no mesmo referencial de t.x/t.y.
   */
  function render(rgba, width, height, t, { filter = 'smooth' } = {}) {
    if (!validTransform(t)) throw new Error('Transformação inválida.');
    const b = transformedBounds(t, width, height);
    const left = Math.floor(b.minX + 1e-6), top = Math.floor(b.minY + 1e-6);
    const outWidth = Math.ceil(b.maxX - 1e-6) - left, outHeight = Math.ceil(b.maxY - 1e-6) - top;
    validateOutput(outWidth, outHeight);
    const out = new Uint8ClampedArray(outWidth * outHeight * 4);
    const identity = t.aL === 1 && t.aR === 1 && t.c === 1 && t.bL === 0 && t.bR === 0 && Number.isInteger(t.x) && Number.isInteger(t.y);
    if (identity) {
      for (let y = 0; y < height; y++) {
        const start = ((y + t.y - top) * outWidth + (t.x - left)) * 4;
        out.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), start);
      }
      return { data: out, width: outWidth, height: outHeight, left, top };
    }
    const pixel = filter === 'pixel';
    const n = pixel ? 1 : outWidth * outHeight > 1000000 ? 2 : 3;
    const read = (x, y, acc, w) => {
      if (x < 0 || y < 0 || x >= width || y >= height || w <= 0) return;
      const i = (y * width + x) * 4, a = rgba[i + 3] * w;
      acc[0] += rgba[i] * a; acc[1] += rgba[i + 1] * a; acc[2] += rgba[i + 2] * a; acc[3] += a;
    };
    const acc = new Float64Array(4);
    for (let j = 0; j < outHeight; j++) {
      for (let i = 0; i < outWidth; i++) {
        acc.fill(0);
        for (let sy = 0; sy < n; sy++) {
          for (let sx = 0; sx < n; sx++) {
            const s = inverse(t, { x: left + i + (sx + .5) / n, y: top + j + (sy + .5) / n });
            if (s.x < 0 || s.y < 0 || s.x >= width || s.y >= height) continue;
            if (pixel) { read(Math.floor(s.x), Math.floor(s.y), acc, 1); continue; }
            const fx = s.x - .5, fy = s.y - .5, x0 = Math.floor(fx), y0 = Math.floor(fy), wx = fx - x0, wy = fy - y0;
            read(x0, y0, acc, (1 - wx) * (1 - wy)); read(x0 + 1, y0, acc, wx * (1 - wy));
            read(x0, y0 + 1, acc, (1 - wx) * wy); read(x0 + 1, y0 + 1, acc, wx * wy);
          }
        }
        if (acc[3] <= 0) continue;
        const o = (j * outWidth + i) * 4;
        out[o] = acc[0] / acc[3]; out[o + 1] = acc[1] / acc[3]; out[o + 2] = acc[2] / acc[3];
        out[o + 3] = acc[3] / (n * n);
      }
    }
    return { data: out, width: outWidth, height: outHeight, left, top };
  }

  /** Menor retângulo com alfa acima do limiar; null se tudo for transparente. */
  function alphaBox(rgba, width, height, threshold = 0) {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rgba[(y * width + x) * 4 + 3] <= threshold) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  globalThis.AssetFitGeometry = Object.freeze({
    TILE_ANGLE, angle, footprintCorners, detect, alphaChannel, rectTransform, map, inverse,
    transformedBounds, validTransform, solve, evaluate, render, alphaBox,
  });
})();
