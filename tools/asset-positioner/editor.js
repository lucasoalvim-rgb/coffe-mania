/* Editor offline. Coordenadas nativas relativas à origem do tile: +tx=(80,40), +ty=(-80,40). */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const geometry = globalThis.AssetCutterGeometry;
  const controlIds = ['assetName', 'footprint', 'height', 'padding', 'showGuides', 'imageX', 'imageY',
    'imageWidth', 'imageHeight', 'lockRatio', 'imageScale', 'filter', 'boundsMode', 'cropLeft',
    'cropTop', 'cropWidth', 'cropHeight', 'trim', 'alphaThreshold', 'positionPreset',
    'positionWallSide', 'positionWallSpan', 'positionWallHeight', 'imageFlip',
    'positionDoorSide', 'positionDoorThickness', 'exportBackground', 'fitPlane', 'fitMode'];
  const fitGeometry = globalThis.AssetFitGeometry;
  let image = null;
  let imageVersion = 0;
  // Cantos da arte em pixels nativos da imagem como aparece (já espelhada): { base, top }.
  let fitPoints = null;
  // Correção de ângulo ativa: { k, aL, aR, bL, bR, c, ox, oy }, relativa a imageX/imageY.
  let warp = null;
  let warpCache = null;
  let sourceCache = null;
  let imageUrl = '';
  let originalName = '';
  let view = { x: 0, y: 0, scale: 1 };
  let drag = null;
  let size = { width: 1, height: 1 };
  let revision = 0;
  let cachedExport = null;
  let metadataTimer = null;
  let loadSequence = 0;
  const num = (id) => Number($(id).value) || 0;
  const int = (id) => Math.round(num(id));
  const footprint = () => $('positionPreset').value === 'door' ? [1, 1] : $('positionPreset').value === 'wall'
    ? ($('positionWallSide').value === 'left' ? [int('positionWallSpan'), 1] : [1, int('positionWallSpan')])
    : $('footprint').value.split(',').map(Number);
  const project = (tx, ty, height = 0) => ({ x: (tx - ty) * 80, y: (tx + ty) * 40 - height });
  const imageRect = () => ({ left: int('imageX'), top: int('imageY'), width: int('imageWidth'), height: int('imageHeight') });

  /** Transformação local → mundo da imagem atual, com ou sem a correção de ângulo. */
  function placement() {
    if (warp) {
      const { ox, oy, ...shape } = warp;
      return { ...shape, x: int('imageX') + ox, y: int('imageY') + oy };
    }
    return fitGeometry.rectTransform(int('imageX'), int('imageY'),
      int('imageWidth') / image.naturalWidth, int('imageHeight') / image.naturalHeight);
  }

  /** Caixa ocupada pela imagem no mundo; com a correção, inclui o cisalhamento das faces. */
  function imageBox() {
    if (!warp || !image) return imageRect();
    const b = fitGeometry.transformedBounds(placement(), image.naturalWidth, image.naturalHeight);
    return { left: Math.floor(b.minX), top: Math.floor(b.minY),
      width: Math.ceil(b.maxX) - Math.floor(b.minX), height: Math.ceil(b.maxY) - Math.floor(b.minY) };
  }

  /** RGBA da imagem como aparece (espelhada ou não), em resolução nativa. */
  function sourcePixels() {
    const flip = $('imageFlip').checked;
    if (sourceCache?.version === imageVersion && sourceCache.flip === flip) return sourceCache;
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width > 8192 || height > 8192 || width * height > 16000000) throw new Error('Imagem muito grande para o encaixe: limite de 8192 px por lado.');
    const work = document.createElement('canvas'); work.width = width; work.height = height;
    const c = work.getContext('2d', { willReadFrequently: true });
    if (flip) { c.translate(width, 0); c.scale(-1, 1); }
    c.drawImage(image, 0, 0);
    sourceCache = { version: imageVersion, flip, width, height, data: c.getImageData(0, 0, width, height).data };
    return sourceCache;
  }

  /** Imagem reamostrada pela correção de ângulo; left/top relativos a imageX/imageY. */
  function warpedImage() {
    const key = JSON.stringify([imageVersion, $('imageFlip').checked, $('filter').value, warp]);
    if (warpCache?.key === key) return warpCache;
    const source = sourcePixels();
    const { ox, oy, ...shape } = warp;
    const result = fitGeometry.render(source.data, source.width, source.height, { ...shape, x: ox, y: oy }, { filter: $('filter').value });
    const output = document.createElement('canvas'); output.width = result.width; output.height = result.height;
    output.getContext('2d').putImageData(new ImageData(result.data, result.width, result.height), 0, 0);
    warpCache = { key, canvas: output, left: result.left, top: result.top };
    return warpCache;
  }

  function surfaceShape() {
    const [sizeX, sizeY] = footprint();
    const preset = $('positionPreset').value;
    return geometry.shape({ type: preset === 'wall' || preset === 'door' ? preset : 'floor', sizeX, sizeY,
      side: preset === 'door' ? $('positionDoorSide').value : $('positionWallSide').value,
      span: int('positionWallSpan'), height: preset === 'door' ? int('height') : int('positionWallHeight'),
      thickness: int('positionDoorThickness') });
  }

  function bounds() {
    if ($('boundsMode').value === 'manual') {
      return { left: int('cropLeft'), top: int('cropTop'), width: int('cropWidth'), height: int('cropHeight') };
    }
    if (!['object', 'door'].includes($('positionPreset').value)) {
      const b = geometry.bounds(surfaceShape().points), padding = int('padding');
      return { left: b.left - padding, top: b.top - padding,
        width: b.width + padding * 2, height: b.height + padding * 2 };
    }
    const [nx, ny] = footprint();
    const padding = int('padding');
    const left = -ny * 80 - padding;
    const top = -int('height') - padding;
    return { left, top, width: (nx + ny) * 80 + padding * 2,
      height: int('height') + (nx + ny) * 40 + padding * 2 };
  }

  function clampControl(id) {
    const element = $(id);
    if (element.type !== 'number') return;
    let value = Number(element.value);
    if (!Number.isFinite(value)) value = Number(element.min) || 0;
    if (element.min !== '') value = Math.max(Number(element.min), value);
    if (element.max !== '') value = Math.min(Number(element.max), value);
    element.value = Math.round(value);
  }

  function sanitizeName() {
    return ($('assetName').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'meu-asset');
  }

  function syncScale() {
    if (image) $('imageScale').value = Math.round(int('imageWidth') / image.naturalWidth * 100);
  }

  function alignImage() {
    if ($('positionPreset').value === 'door') {
      const b = geometry.bounds(surfaceShape().points);
      $('imageX').value = Math.round(b.left + (b.width - int('imageWidth')) / 2);
      $('imageY').value = b.top + b.height - int('imageHeight');
      changed(); return;
    }
    if ($('positionPreset').value !== 'object') {
      const b = geometry.bounds(surfaceShape().points);
      $('imageX').value = Math.round(b.left + (b.width - int('imageWidth')) / 2);
      $('imageY').value = Math.round(b.top + (b.height - int('imageHeight')) / 2);
      changed(); return;
    }
    const [nx, ny] = footprint();
    const center = project(nx / 2, ny / 2);
    $('imageX').value = Math.round(center.x - int('imageWidth') / 2);
    $('imageY').value = Math.round(center.y - int('imageHeight'));
    changed();
  }

  function changed() {
    revision++;
    cachedExport = null;
    const preset = $('positionPreset').value;
    $('positionWallOptions').hidden = preset !== 'wall';
    $('positionDoorOptions').hidden = preset !== 'door';
    $('footprint').disabled = preset === 'door';
    $('footprintLabel').hidden = preset === 'wall';
    $('heightLabel').hidden = !['object', 'door'].includes(preset);
    $('fitPresetImage').hidden = preset === 'object';
    $('fitPresetImage').disabled = !image;
    $('alignImage').textContent = preset === 'door' ? 'Alinhar à face traseira' : preset === 'object' ? 'Centralizar base na pegada' : 'Centralizar imagem no preset';
    $('fitPresetImage').textContent = preset === 'door' ? 'Ajustar tamanho à porta' : 'Ajustar tamanho ao preset';
    $('boundsMode').options[0].textContent = ['object', 'door'].includes(preset) ? 'Grade + altura + margem' : 'Preset + margem';
    $('presetHint').textContent = preset === 'floor'
      ? 'O preset começa em 1×1, sem altura e com 2 px de margem: área de 164×84 px. Margem 0 gera 160×80 px. Pode escolher outras pegadas.'
      : preset === 'door'
        ? 'Porta de chão 1×1, fina e alta, junto à face traseira escolhida. A faixa indica a espessura; o verde mostra a folha vertical. Origem e ângulo do tile permanecem iguais.'
      : preset === 'wall'
        ? 'Guia da face vertical a 26,565°, com lado, altura e comprimento ajustáveis. A área automática acompanha a caixa da face, sem espaço extra de móvel.'
        : 'A altura aumenta o espaço acima do chão, sem mudar o tile. Os guias nunca entram no PNG.';
    const white = $('exportBackground').value === 'white';
    const icon = $('exportPng').querySelector('svg');
    $('exportPng').replaceChildren(...(icon ? [icon] : []), document.createTextNode(white ? 'Exportar PNG branco' : 'Exportar PNG transparente'));
    if ($('exportBackgroundHint')) $('exportBackgroundHint').textContent = white
      ? 'Fundo branco, em resolução nativa. Não altera os assets do jogo.'
      : 'Fundo transparente, em resolução nativa. Não altera os assets do jogo.';
    $('manualBounds').hidden = $('boundsMode').value !== 'manual';
    const fitAvailable = Boolean(image) && preset === 'object';
    $('fitDetect').disabled = !fitAvailable;
    $('fitApply').disabled = !fitAvailable || !fitPoints;
    $('fitClear').disabled = !warp;
    // Com a correção ativa, o tamanho vem do encaixe; mover continua livre.
    for (const id of ['imageWidth', 'imageHeight', 'imageScale', 'lockRatio']) $(id).disabled = Boolean(warp);
    const b = bounds();
    const r = image ? imageBox() : imageRect();
    $('clipWarning').hidden = !image || (r.left >= b.left && r.top >= b.top &&
      r.left + r.width <= b.left + b.width && r.top + r.height <= b.top + b.height);
    updateFitInfo();
    draw();
    clearTimeout(metadataTimer);
    metadataTimer = setTimeout(updateMetadata, 100);
  }

  controlIds.forEach((id) => $(id).addEventListener('input', () => {
    // Let a number field pass through empty / incomplete states while typing, e.g. a leading minus.
    if ($(id).type === 'number' && ($(id).value === '' || $(id).validity.badInput)) return;
    clampControl(id);
    if (image && ['imageWidth', 'imageHeight'].includes(id)) {
      if ($('lockRatio').checked) {
        if (id === 'imageWidth') $('imageHeight').value = Math.max(1, Math.round(int(id) * image.naturalHeight / image.naturalWidth));
        else $('imageWidth').value = Math.max(1, Math.round(int(id) * image.naturalWidth / image.naturalHeight));
      }
      syncScale();
    }
    if (image && id === 'imageScale') {
      $('imageWidth').value = Math.max(1, Math.round(image.naturalWidth * num(id) / 100));
      $('imageHeight').value = Math.max(1, Math.round(image.naturalHeight * num(id) / 100));
    }
    if (id === 'imageFlip') flipChanged();
    changed();
  }));
  $('positionPreset').addEventListener('change', () => {
    const preset = $('positionPreset').value;
    $('boundsMode').value = 'auto';
    $('footprint').value = '1,1';
    $('positionWallSpan').value = 1;
    $('height').value = ['object', 'door'].includes(preset) ? 200 : 0;
    $('padding').value = preset === 'object' ? 12 : 2;
    $('trim').checked = ['object', 'door'].includes(preset);
    if (preset === 'door') { $('positionDoorSide').value = 'left'; $('positionDoorThickness').value = 8; }
    $('alphaThreshold').value = 0;
    $('showGuides').checked = true;
    if (image) alignImage(); else changed();
    fitView();
  });
  controlIds.filter((id) => $(id).type === 'number').forEach((id) => $(id).addEventListener('blur', () => {
    clampControl(id);
    $(id).dispatchEvent(new Event('input'));
  }));
  $('boundsMode').addEventListener('change', () => {
    if ($('boundsMode').value === 'manual') {
      // Start the manual rectangle at the current automatic dimensions.
      $('boundsMode').value = 'auto';
      const b = bounds();
      $('boundsMode').value = 'manual';
      $('cropLeft').value = b.left; $('cropTop').value = b.top;
      $('cropWidth').value = b.width; $('cropHeight').value = b.height;
      changed();
    }
  });
  $('alignImage').addEventListener('click', alignImage);
  $('fitPresetImage').addEventListener('click', () => {
    if (!image || $('positionPreset').value === 'object') return;
    const b = geometry.bounds(surfaceShape().points);
    const scale = Math.min(b.width / image.naturalWidth, b.height / image.naturalHeight);
    $('imageWidth').value = Math.max(1, Math.round(image.naturalWidth * scale));
    $('imageHeight').value = Math.max(1, Math.round(image.naturalHeight * scale));
    syncScale(); alignImage(); fitView();
  });

  function fitView() {
    const b = bounds();
    const r = image ? imageBox() : imageRect();
    const left = image ? Math.min(b.left, r.left) : b.left;
    const top = image ? Math.min(b.top, r.top) : b.top;
    const right = image ? Math.max(b.left + b.width, r.left + r.width) : b.left + b.width;
    const bottom = image ? Math.max(b.top + b.height, r.top + r.height) : b.top + b.height;
    view.scale = Math.max(.1, Math.min(8, (size.width - 90) / (right - left), (size.height - 90) / (bottom - top)));
    view.x = size.width / 2 - (left + right) / 2 * view.scale;
    view.y = size.height / 2 - (top + bottom) / 2 * view.scale;
    syncZoom(); draw();
  }

  function syncZoom() {
    $('viewZoom').value = Math.round(view.scale * 100);
    $('zoomLabel').textContent = `${Math.round(view.scale * 100)}%`;
  }

  function zoomAt(newScale, px = size.width / 2, py = size.height / 2) {
    newScale = Math.max(.1, Math.min(8, newScale));
    const wx = (px - view.x) / view.scale;
    const wy = (py - view.y) / view.scale;
    view.scale = newScale;
    view.x = px - wx * newScale; view.y = py - wy * newScale;
    syncZoom(); draw();
  }
  $('fitView').addEventListener('click', fitView);
  $('viewZoom').addEventListener('input', () => zoomAt(num('viewZoom') / 100));
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const p = localPoint(event);
    zoomAt(view.scale * Math.exp(-event.deltaY * .0015), p.x, p.y);
  }, { passive: false });

  function line(a, b, color, width = 1, dashed = false) {
    ctx.strokeStyle = color; ctx.lineWidth = width / view.scale;
    ctx.setLineDash(dashed ? [6 / view.scale, 5 / view.scale] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  function grid(height, color, dashed = false) {
    const [nx, ny] = footprint();
    for (let tx = 0; tx <= nx; tx++) line(project(tx, 0, height), project(tx, ny, height), color, 2, dashed);
    for (let ty = 0; ty <= ny; ty++) line(project(0, ty, height), project(nx, ty, height), color, 2, dashed);
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
    const b = bounds();
    const white = $('exportBackground').value === 'white';
    ctx.fillStyle = white ? '#ffffff' : '#f4f5f7'; ctx.fillRect(b.left, b.top, b.width, b.height);
    // Checkerboard is only an editor backdrop, never part of export.
    ctx.save(); ctx.beginPath(); ctx.rect(b.left, b.top, b.width, b.height); ctx.clip();
    ctx.fillStyle = '#e2e5ea';
    const cell = Math.max(16, Math.ceil(8 / view.scale));
    for (let y = b.top; !white && y < b.top + b.height; y += cell) {
      for (let x = b.left; x < b.left + b.width; x += cell) {
        if ((Math.floor((x - b.left) / cell) + Math.floor((y - b.top) / cell)) % 2) ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.restore();
    if (image) {
      ctx.imageSmoothingEnabled = $('filter').value === 'smooth';
      ctx.imageSmoothingQuality = 'high';
      paintImage(ctx);
    }
    if ($('showGuides').checked) {
      const [nx, ny] = footprint();
      const preset = $('positionPreset').value;
      const h = preset === 'wall' ? int('positionWallHeight') : preset === 'floor' ? 0 : int('height');
      if (preset === 'object') {
        for (const [tx, ty] of [[0, 0], [nx, 0], [nx, ny], [0, ny]]) {
          line(project(tx, ty), project(tx, ty, h), '#48876d88', 1, true);
        }
        grid(h, '#129369aa', true); grid(0, '#1277da');
      } else if (preset === 'door') {
        grid(0, '#1277da');
        const s = surfaceShape();
        geometry.trace(ctx, s.basePoints); ctx.fillStyle = '#e7aa5d44'; ctx.fill();
        ctx.strokeStyle = '#b57922'; ctx.lineWidth = 2 / view.scale; ctx.stroke();
        geometry.trace(ctx, s.points); ctx.strokeStyle = '#48876d'; ctx.lineWidth = 1 / view.scale;
        ctx.setLineDash([6 / view.scale, 5 / view.scale]); ctx.stroke(); ctx.setLineDash([]);
        geometry.trace(ctx, s.leafPoints); ctx.strokeStyle = '#129369'; ctx.lineWidth = 2 / view.scale; ctx.stroke();
        ctx.font = `${12 / view.scale}px system-ui`; ctx.fillStyle = '#896012';
        ctx.fillText('Face traseira · porta', s.basePoints[0].x + 10 / view.scale, s.basePoints[0].y + 18 / view.scale);
      } else if (preset === 'floor') grid(0, '#1277da');
      else {
        ctx.save(); ctx.globalAlpha = .25; grid(0, '#1277da'); ctx.restore();
        const s = surfaceShape();
        geometry.trace(ctx, s.points);
        ctx.strokeStyle = '#129369'; ctx.lineWidth = 2 / view.scale; ctx.stroke();
        const a = s.points[3], b = s.points[2], span = int('positionWallSpan');
        for (let index = 1; index < span; index++) {
          const base = { x: a.x + (b.x - a.x) * index / span, y: a.y + (b.y - a.y) * index / span };
          line(base, { x: base.x, y: base.y - h }, '#48876d88', 1, true);
        }
      }
      line({ x: -8 / view.scale, y: 0 }, { x: 8 / view.scale, y: 0 }, '#e22d50', 2);
      line({ x: 0, y: -8 / view.scale }, { x: 0, y: 8 / view.scale }, '#e22d50', 2);
      ctx.font = `${12 / view.scale}px system-ui`; ctx.fillStyle = '#b51d3a';
      ctx.fillText('O (0,0)', 10 / view.scale, -10 / view.scale);
      ctx.fillStyle = '#00774c';
      const surfaceTop = preset === 'wall' ? geometry.bounds(surfaceShape().points).top : -h;
      ctx.fillText(preset === 'floor' ? 'Piso' : `H = ${h} px`, 10 / view.scale, surfaceTop - 10 / view.scale);
    }
    ctx.strokeStyle = '#e8a318'; ctx.lineWidth = 2 / view.scale;
    ctx.setLineDash([8 / view.scale, 5 / view.scale]); ctx.strokeRect(b.left, b.top, b.width, b.height); ctx.setLineDash([]);
    if (image && warp) {
      const t = placement(), w = image.naturalWidth, h = image.naturalHeight, k = Math.max(0, Math.min(w, t.k));
      ctx.beginPath();
      [[0, 0], [k, 0], [w, 0], [w, h], [k, h], [0, h]].forEach(([x, y], index) => {
        const p = fitGeometry.map(t, { x, y });
        ctx[index ? 'lineTo' : 'moveTo'](p.x, p.y);
      });
      ctx.closePath(); ctx.strokeStyle = '#845bef'; ctx.lineWidth = 1 / view.scale; ctx.stroke();
    } else if (image) {
      const r = imageRect();
      ctx.strokeStyle = '#845bef'; ctx.lineWidth = 1 / view.scale;
      ctx.strokeRect(r.left, r.top, r.width, r.height);
      const handle = 11 / view.scale;
      ctx.fillStyle = '#845bef';
      ctx.fillRect(r.left + r.width - handle / 2, r.top + r.height - handle / 2, handle, handle);
    }
    if (image && fitPoints) drawFitPoints();
    ctx.restore();
  }

  const FIT_COLORS = { base: '#ff8a1f', top: '#22c3e6' };
  const FIT_LABELS = { left: 'E', front: 'F', back: 'T', right: 'D' };
  const fitKeys = (plane) => plane === 'top' ? ['left', 'back', 'right'] : ['left', 'front', 'right'];

  function fitHandles() {
    if (!image || !fitPoints) return [];
    const t = placement();
    return ['base', 'top'].flatMap((plane) => fitPoints[plane]
      ? fitKeys(plane).map((key) => ({ plane, key, world: fitGeometry.map(t, fitPoints[plane][key]) })) : []);
  }

  function drawFitPoints() {
    const reference = $('fitPlane').value;
    const handles = fitHandles();
    for (const plane of ['base', 'top']) {
      const points = handles.filter((handle) => handle.plane === plane);
      if (points.length !== 3) continue;
      ctx.beginPath();
      points.forEach((handle, index) => ctx[index ? 'lineTo' : 'moveTo'](handle.world.x, handle.world.y));
      ctx.strokeStyle = FIT_COLORS[plane]; ctx.lineWidth = (plane === reference ? 2 : 1) / view.scale;
      ctx.setLineDash(plane === reference ? [] : [4 / view.scale, 4 / view.scale]); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = `bold ${10 / view.scale}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const handle of handles) {
      ctx.beginPath(); ctx.arc(handle.world.x, handle.world.y, 6 / view.scale, 0, Math.PI * 2);
      ctx.fillStyle = FIT_COLORS[handle.plane]; ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1 / view.scale; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillText(FIT_LABELS[handle.key], handle.world.x, handle.world.y + .5 / view.scale);
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function fitHandleAt(p) {
    const radius = 9 / view.scale;
    return fitHandles().find((handle) => Math.hypot(handle.world.x - p.x, handle.world.y - p.y) <= radius) || null;
  }

  const formatNumber = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits).replace('.', ',') : '—';
  const formatAngles = (a) => a ? `${formatNumber(a.left)}° / ${formatNumber(a.right)}°` : '—';

  function updateFitInfo() {
    if (!image || !fitPoints) {
      $('fitInfo').textContent = image ? 'Clique em Detectar cantos da arte.' : 'Importe uma imagem e detecte os cantos.';
      return;
    }
    const [sizeX, sizeY] = footprint();
    const plane = $('fitPlane').value;
    const result = fitGeometry.evaluate({ points: fitPoints, plane, transform: placement(), sizeX, sizeY });
    const lines = [`Tile: ${formatNumber(fitGeometry.TILE_ANGLE, 2)}° (2:1)`,
      `Arte  base ${formatAngles(result.angles.before.base)} · tampo ${formatAngles(result.angles.before.top)}`,
      `Agora base ${formatAngles(result.angles.after.base)} · tampo ${formatAngles(result.angles.after.top)}`];
    lines.push(result.maxDeviation === null
      ? `Marque os cantos ${plane === 'top' ? 'do tampo' : 'da base'} para medir o desvio.`
      : `Desvio dos cantos: ${formatNumber(result.maxDeviation)} px${plane === 'top' ? ` · tampo a ${formatNumber(result.height)} px` : ''}`);
    if (warp) lines.push(`Correção: horizontal ${formatNumber(warp.aL * 100)}% / ${formatNumber(warp.aR * 100)}% · vertical ${formatNumber(warp.c * 100)}%`);
    $('fitInfo').textContent = lines.join('\n');
  }

  /** Espelhar troca os lados: os cantos acompanham a arte e a correção precisa ser refeita. */
  function flipChanged() {
    if (fitPoints && image) {
      const width = image.naturalWidth, mirror = (p) => ({ x: width - p.x, y: p.y });
      for (const plane of ['base', 'top']) {
        const points = fitPoints[plane];
        if (!points) continue;
        const middle = plane === 'top' ? 'back' : 'front';
        fitPoints[plane] = { left: mirror(points.right), [middle]: mirror(points[middle]), right: mirror(points.left) };
      }
    }
    if (warp) { removeWarp(); report('Correção de ângulo removida ao espelhar. Clique em Encaixar na pegada para refazê-la.'); }
  }

  function removeWarp() {
    if (!warp) return;
    // Volta ao retângulo em tamanho nativo, mantendo a posição do canto superior esquerdo.
    $('imageX').value = Math.round(int('imageX') + warp.ox); $('imageY').value = Math.round(int('imageY') + warp.oy);
    $('imageWidth').value = image.naturalWidth; $('imageHeight').value = image.naturalHeight;
    warp = null; warpCache = null;
    syncScale();
  }

  // Pontos iniciais para arrastar quando a silhueta não forma um losango (pés, plantas, sombras).
  function defaultPlane(plane) {
    const w = image.naturalWidth, h = image.naturalHeight;
    return plane === 'top'
      ? { left: { x: 0, y: h * .3 }, back: { x: w / 2, y: 0 }, right: { x: w, y: h * .3 } }
      : { left: { x: 0, y: h * .7 }, front: { x: w / 2, y: h }, right: { x: w, y: h * .7 } };
  }

  $('fitDetect').addEventListener('click', () => {
    if (!image) return;
    try {
      const source = sourcePixels();
      const found = fitGeometry.detect(fitGeometry.alphaChannel(source.data, source.width, source.height), source.width, source.height);
      const clean = (plane) => found[plane] && Object.fromEntries(fitKeys(plane).map((key) => [key, found[plane][key]]));
      fitPoints = { base: clean('base') || defaultPlane('base'), top: clean('top') || defaultPlane('top') };
      const missing = ['base', 'top'].filter((plane) => !found[plane]).map((plane) => plane === 'top' ? 'tampo' : 'base');
      const irregular = ['base', 'top'].filter((plane) => found[plane]?.rms > 1.5).map((plane) => plane === 'top' ? 'tampo' : 'base');
      changed();
      report(missing.length ? `Não reconheci ${missing.join(' e ')} pela silhueta: arraste os pontos até os cantos.`
        : irregular.length ? `Contorno irregular em ${irregular.join(' e ')}: confira os pontos antes de encaixar.`
        : 'Cantos detectados. Confira os pontos e clique em Encaixar na pegada.');
    } catch (error) { report(error.message, true); }
  });

  $('fitApply').addEventListener('click', () => {
    if (!image || !fitPoints) return;
    try {
      const [sizeX, sizeY] = footprint();
      const mode = $('fitMode').value;
      const result = fitGeometry.solve({ points: fitPoints, plane: $('fitPlane').value, mode, sizeX, sizeY });
      const t = result.transform;
      warp = null; warpCache = null;
      if (mode === 'angle') {
        const x = Math.floor(t.x), y = Math.floor(t.y);
        $('imageX').value = x; $('imageY').value = y;
        $('imageWidth').value = image.naturalWidth; $('imageHeight').value = image.naturalHeight;
        warp = { k: t.k, aL: t.aL, aR: t.aR, bL: t.bL, bR: t.bR, c: t.c, ox: t.x - x, oy: t.y - y };
      } else {
        $('imageWidth').value = Math.max(1, Math.round(image.naturalWidth * t.c));
        $('imageHeight').value = Math.max(1, Math.round(image.naturalHeight * t.c));
        $('imageX').value = Math.round(t.x); $('imageY').value = Math.round(t.y);
      }
      syncScale();
      // A área automática cresce para não cortar a arte encaixada; a origem do tile não muda.
      const box = imageBox();
      if ($('boundsMode').value === 'auto' && -box.top > int('height')) $('height').value = Math.ceil(-box.top);
      changed(); fitView();
      const residual = fitGeometry.evaluate({ points: fitPoints, plane: $('fitPlane').value, transform: placement(), sizeX, sizeY });
      report(`Encaixe aplicado: desvio de ${formatNumber(residual.maxDeviation)} px nos cantos.${result.notes.length ? ` ${result.notes.join(' ')}` : ''}` +
        (mode === 'angle' ? '' : ' Este modo preserva o ângulo da arte; use Corrigir ângulo para levar as arestas a 26,565°.'));
    } catch (error) { report(error.message, true); }
  });

  $('fitClear').addEventListener('click', () => {
    removeWarp(); changed();
    report('Correção de ângulo removida. A imagem voltou ao tamanho nativo.');
  });

  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function worldPoint(event) {
    const p = localPoint(event);
    return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
  }
  globalThis.AssetImageMenu.attach(canvas, {
    hasImage: () => Boolean(image),
    isFlipped: () => $('imageFlip').checked,
    onFlip: () => {
      $('imageFlip').checked = !$('imageFlip').checked;
      flipChanged();
      changed();
      report($('imageFlip').checked ? 'Imagem invertida horizontalmente.' : 'Imagem na orientação original.');
    },
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (![0, 2].includes(event.button)) return;
    canvas.focus();
    const p = worldPoint(event);
    const r = imageRect();
    const box = image ? imageBox() : r;
    const radius = 13 / view.scale;
    const fitHandle = event.button === 0 ? fitHandleAt(p) : null;
    if (event.button === 2) drag = { mode: 'pan', point: localPoint(event), x: view.x, y: view.y };
    else if (fitHandle) drag = { mode: 'fitPoint', plane: fitHandle.plane, key: fitHandle.key };
    else if (image && !warp && Math.abs(p.x - r.left - r.width) < radius && Math.abs(p.y - r.top - r.height) < radius) {
      drag = { mode: 'resize', point: p, rect: r };
    } else if (image && p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height) {
      drag = { mode: 'move', point: p, rect: r };
    } else drag = { mode: 'pan', point: localPoint(event), x: view.x, y: view.y };
    drag.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) {
      const p = worldPoint(event), r = imageRect(), radius = 13 / view.scale;
      canvas.style.cursor = image && fitHandleAt(p) ? 'crosshair'
        : image && !warp && Math.abs(p.x - r.left - r.width) < radius && Math.abs(p.y - r.top - r.height) < radius ? 'nwse-resize' : 'grab';
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    if (drag.mode === 'pan') {
      const p = localPoint(event);
      view.x = drag.x + p.x - drag.point.x; view.y = drag.y + p.y - drag.point.y; draw(); return;
    }
    const p = worldPoint(event);
    if (drag.mode === 'fitPoint') {
      // Os pontos ficam em pixels da imagem: continuam válidos ao mover, escalar ou corrigir o ângulo.
      fitPoints[drag.plane][drag.key] = fitGeometry.inverse(placement(), p);
      updateFitInfo(); draw(); return;
    }
    if (drag.mode === 'move') {
      $('imageX').value = Math.round(drag.rect.left + p.x - drag.point.x);
      $('imageY').value = Math.round(drag.rect.top + p.y - drag.point.y);
    } else {
      let width = Math.max(1, Math.round(drag.rect.width + p.x - drag.point.x));
      let height = Math.max(1, Math.round(drag.rect.height + p.y - drag.point.y));
      if ($('lockRatio').checked) {
        const ratio = image.naturalWidth / image.naturalHeight;
        // Project pointer motion onto the proportional diagonal (no jump on grabbing).
        const factor = (width * ratio + height) / (ratio * ratio + 1);
        height = Math.max(1, Math.round(factor)); width = Math.max(1, Math.round(factor * ratio));
      }
      $('imageWidth').value = Math.min(8192, width); $('imageHeight').value = Math.min(8192, height);
      syncScale();
    }
    changed();
  });
  const finishDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', finishDrag);
  canvas.addEventListener('pointercancel', finishDrag);
  canvas.addEventListener('lostpointercapture', finishDrag);
  canvas.addEventListener('keydown', (event) => {
    if (!image) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); const step = event.shiftKey ? 10 : 1;
    $('imageX').value = int('imageX') + direction[0] * step;
    $('imageY').value = int('imageY') + direction[1] * step;
    changed();
  });

  function report(message, error = false) {
    $('status').textContent = message;
    $('status').style.color = error ? '#ffd08a' : '#c5d9f5';
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  async function setImage(url, name, settings = null) {
    const sequence = ++loadSequence;
    const nextImage = new Image();
    await new Promise((resolve, reject) => { nextImage.onload = resolve; nextImage.onerror = () => reject(new Error('Não foi possível abrir esta imagem.')); nextImage.src = url; });
    if (sequence !== loadSequence) return;
    if (!nextImage.naturalWidth || !nextImage.naturalHeight) throw new Error('Imagem sem dimensões válidas.');
    image = nextImage; imageUrl = url; originalName = name;
    imageVersion++; fitPoints = null; warp = null; warpCache = null; sourceCache = null;
    $('imageFlip').checked = false;
    $('assetName').value = name.replace(/\.[^.]+$/, '') || 'meu-asset';
    $('imageWidth').value = image.naturalWidth; $('imageHeight').value = image.naturalHeight;
    if (settings) {
      // Old projects and callers without a category retain the original furniture behavior.
      $('positionPreset').value = 'object';
      $('positionWallSide').value = 'left'; $('positionWallSpan').value = 1; $('positionWallHeight').value = 208;
      $('positionDoorSide').value = 'left'; $('positionDoorThickness').value = 8;
      $('exportBackground').value = 'transparent';
      $('fitPlane').value = 'base'; $('fitMode').value = 'angle';
      if (typeof settings.footprint === 'string' && /^\d+,\d+$/.test(settings.footprint)) {
        const [nx, ny] = settings.footprint.split(',').map(Number);
        if (nx >= 1 && ny >= 1 && nx <= 8 && ny <= 8 && !Array.from($('footprint').options).some((option) => option.value === settings.footprint)) {
          $('footprint').add(new Option(`${nx} × ${ny} — personalizado`, settings.footprint));
        }
      }
      for (const id of controlIds) {
        if (!(id in settings)) continue;
        if ($(id).type === 'checkbox') $(id).checked = Boolean(settings[id]);
        else $(id).value = settings[id];
        clampControl(id);
      }
      if (!$('footprint').value) $('footprint').value = '1,1';
      if (!$('boundsMode').value) $('boundsMode').value = 'auto';
      if (!$('filter').value) $('filter').value = 'smooth';
      if (!$('positionPreset').value) $('positionPreset').value = 'object';
      if (!$('positionWallSide').value) $('positionWallSide').value = 'left';
      if (!$('positionDoorSide').value) $('positionDoorSide').value = 'left';
      if (!$('exportBackground').value) $('exportBackground').value = 'transparent';
      if ($('positionPreset').value === 'door') $('footprint').value = '1,1';
      if (!$('fitPlane').value) $('fitPlane').value = 'base';
      if (!$('fitMode').value) $('fitMode').value = 'angle';
      fitPoints = restoreFitPoints(settings.fitPoints);
      warp = restoreWarp(settings.angleCorrection);
    } else alignImage();
    syncScale();
    $('imageInfo').textContent = `${name} · original ${image.naturalWidth} × ${image.naturalHeight} px`;
    $('empty').hidden = true;
    $('saveProject').disabled = false;
    changed(); fitView();
    report('Imagem importada. Arraste e ajuste o tamanho; PNGs transparentes são recomendados.');
  }

  // Projetos sem encaixe, ou com dados inválidos, abrem sem pontos e sem correção.
  function restoreFitPoints(data) {
    if (!data || typeof data !== 'object') return null;
    const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
    const plane = (points, keys) => {
      const restored = Object.fromEntries(keys.map((key) => [key, point(points?.[key])]));
      return Object.values(restored).every(Boolean) ? restored : null;
    };
    const restored = { base: plane(data.base, fitKeys('base')), top: plane(data.top, fitKeys('top')) };
    return restored.base || restored.top ? restored : null;
  }

  function restoreWarp(data) {
    if (!data || typeof data !== 'object') return null;
    const keys = ['k', 'aL', 'aR', 'bL', 'bR', 'c', 'ox', 'oy'];
    if (!keys.every((key) => Number.isFinite(data[key])) || !(data.aL > 0 && data.aR > 0 && data.c > 0)) return null;
    return Object.fromEntries(keys.map((key) => [key, data[key]]));
  }

  async function importFile(file) {
    if (!file) return;
    try { await setImage(await readFile(file), file.name); }
    catch (error) { report(error.message, true); }
  }
  $('importImage').addEventListener('click', () => $('imageFile').click());
  $('imageFile').addEventListener('change', async () => { await importFile($('imageFile').files[0]); $('imageFile').value = ''; });
  $('viewport').addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('viewport').addEventListener('drop', (event) => { event.preventDefault(); importFile(event.dataTransfer.files[0]); });

  // Preview and export share the same transform; position and dimensions stay intact.
  function paintImage(context, offsetX = 0, offsetY = 0) {
    if (warp) {
      const warped = warpedImage();
      context.drawImage(warped.canvas, int('imageX') + warped.left + offsetX, int('imageY') + warped.top + offsetY);
      return;
    }
    const r = imageRect();
    context.save();
    context.translate(r.left + offsetX + ($('imageFlip').checked ? r.width : 0), r.top + offsetY);
    context.scale($('imageFlip').checked ? -1 : 1, 1);
    context.drawImage(image, 0, 0, r.width, r.height);
    context.restore();
  }

  function prepareExport() {
    if (!image) throw new Error('Importe uma imagem primeiro.');
    if (cachedExport?.revision === revision) return cachedExport;
    const b = bounds();
    if (b.width < 1 || b.height < 1 || b.width > 8192 || b.height > 8192 || b.width * b.height > 16000000) {
      throw new Error('Área muito grande: limite de 8192 px por lado e 16 milhões de pixels.');
    }
    const work = document.createElement('canvas'); work.width = b.width; work.height = b.height;
    const c = work.getContext('2d', { willReadFrequently: true });
    c.imageSmoothingEnabled = $('filter').value === 'smooth'; c.imageSmoothingQuality = 'high';
    const r = imageRect();
    paintImage(c, -b.left, -b.top);
    let x0 = 0, y0 = 0, x1 = b.width - 1, y1 = b.height - 1;
    const data = c.getImageData(0, 0, b.width, b.height).data;
    let minX = b.width, minY = b.height, maxX = -1, maxY = -1;
    const threshold = int('alphaThreshold');
    for (let y = 0; y < b.height; y++) {
      for (let x = 0; x < b.width; x++) {
        if (data[(y * b.width + x) * 4 + 3] <= threshold) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) throw new Error('Nenhum pixel visível no recorte. Reposicione a imagem ou reduza o limiar de alfa.');
    if ($('trim').checked) { x0 = minX; y0 = minY; x1 = maxX; y1 = maxY; }
    const output = document.createElement('canvas');
    output.width = x1 - x0 + 1; output.height = y1 - y0 + 1;
    const outputContext = output.getContext('2d');
    // Flatten only AFTER alpha-based trimming; white must never change offsets.
    if ($('exportBackground').value === 'white') {
      outputContext.fillStyle = '#ffffff'; outputContext.fillRect(0, 0, output.width, output.height);
    }
    outputContext.drawImage(work, x0, y0, output.width, output.height, 0, 0, output.width, output.height);
    const [sizeX, sizeY] = footprint();
    const filename = `${sanitizeName()}.png`;
    const frame = { file: filename, width: output.width, height: output.height, left: b.left + x0, top: b.top + y0 };
    cachedExport = { revision, canvas: output, frame, metadata: {
      tileWidth: 160, tileHeight: 80, exportScale: 2, sizeX, sizeY, frames: [frame],
      template: { heightAboveOrigin: $('positionPreset').value === 'wall'
          ? Math.max(0, -geometry.bounds(surfaceShape().points).top)
          : $('positionPreset').value === 'floor' ? 0 : int('height'),
        exportArea: b, alphaThreshold: threshold, background: $('exportBackground').value,
        trimmed: $('trim').checked, image: { ...r, flipHorizontal: $('imageFlip').checked, angleCorrection: warp ? { ...warp } : null },
        fit: fitPoints ? { plane: $('fitPlane').value, mode: $('fitMode').value, points: fitPoints,
          maxDeviation: fitGeometry.evaluate({ points: fitPoints, plane: $('fitPlane').value, transform: placement(), sizeX, sizeY }).maxDeviation } : null,
        filter: $('filter').value,
        preset: $('positionPreset').value,
        door: $('positionPreset').value === 'door' ? { side: $('positionDoorSide').value,
          thickness: int('positionDoorThickness'), height: int('height'), inset: 2, placement: 'back-edge', itemType: 'door' } : null,
        wall: $('positionPreset').value === 'wall' ? { side: $('positionWallSide').value,
          span: int('positionWallSpan'), height: int('positionWallHeight') } : null }
    } };
    return cachedExport;
  }

  function updateMetadata() {
    if (!image) return;
    try {
      const { frame } = prepareExport();
      $('metadata').textContent = `PNG: ${frame.width} × ${frame.height} px\nleft: ${frame.left}   top: ${frame.top}\nOrigem no PNG: (${ -frame.left }, ${ -frame.top })`;
      $('exportPng').disabled = false; $('exportJson').disabled = false;
    } catch (error) {
      $('metadata').textContent = error.message;
      $('exportPng').disabled = true; $('exportJson').disabled = true;
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function approveClipping() {
    return $('clipWarning').hidden || window.confirm('A caixa da imagem ultrapassa a área amarela. O que estiver fora será cortado. Exportar assim mesmo?');
  }
  $('exportPng').addEventListener('click', () => {
    try {
      const result = prepareExport();
      if (!approveClipping()) return;
      result.canvas.toBlob((blob) => {
        if (!blob) { report('Não foi possível gerar o PNG.', true); return; }
        download(blob, result.frame.file);
        report(`PNG exportado: ${result.frame.width} × ${result.frame.height} px; left=${result.frame.left}, top=${result.frame.top}. Salve também o JSON para usar esses offsets no jogo.`);
      }, 'image/png');
    } catch (error) { report(error.message, true); }
  });
  $('exportJson').addEventListener('click', () => {
    try {
      const result = prepareExport();
      download(new Blob([JSON.stringify(result.metadata, null, 2)], { type: 'application/json' }), `${sanitizeName()}.offsets.json`);
      report('Offsets salvos. Use sizeX/sizeY e frames no manifesto; nada foi aplicado ao jogo automaticamente.');
    } catch (error) { report(error.message, true); }
  });

  $('saveProject').addEventListener('click', () => {
    const settings = Object.fromEntries(controlIds.map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value]));
    settings.fitPoints = fitPoints; settings.angleCorrection = warp;
    const projectData = { format: 'coffe-mania-asset-positioner', version: 1, originalName, imageUrl, settings };
    download(new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' }), `${sanitizeName()}.projeto.json`);
    report('Projeto salvo com a imagem original e todos os ajustes.');
  });
  $('openProject').addEventListener('click', () => $('projectFile').click());
  $('projectFile').addEventListener('change', async () => {
    const file = $('projectFile').files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'coffe-mania-asset-positioner' || data.version !== 1 || typeof data.imageUrl !== 'string' ||
        !data.imageUrl.startsWith('data:image/') || !data.settings || typeof data.settings !== 'object') {
        throw new Error('Selecione um arquivo .projeto.json gerado por esta ferramenta.');
      }
      await setImage(data.imageUrl, String(data.originalName || 'meu-asset.png'), data.settings);
      report('Projeto restaurado.');
    } catch (error) { report(error.message, true); }
    $('projectFile').value = '';
  });

  let initialView = true;
  window.assetPositioner = Object.freeze({ importImage: setImage, hasImage: () => Boolean(image), fitView });
  new ResizeObserver(() => {
    const rect = $('viewport').getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const old = size;
    size = { width: rect.width, height: rect.height };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
    if (initialView) { fitView(); initialView = false; }
    else { view.x += (size.width - old.width) / 2; view.y += (size.height - old.height) / 2; draw(); }
  }).observe($('viewport'));
  changed();
})();
