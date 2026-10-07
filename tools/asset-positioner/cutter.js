'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const geometry = globalThis.AssetCutterGeometry;
  const canvas = $('cutterCanvas'), ctx = canvas.getContext('2d');
  const preview = $('cutterPreview');
  const controls = ['cutterName', 'cutterType', 'cutterFootprint', 'cutterHeight', 'cutterSide', 'cutterWallSpan', 'cutterWallHeight',
    'cutterDragMode', 'cutterMaskX', 'cutterMaskY', 'cutterImageX', 'cutterImageY', 'cutterScale', 'cutterRotation', 'cutterFlip', 'cutterFilter'];
  let image = null, originalName = '', loadSequence = 0;
  let size = { width: 1, height: 1 }, view = { x: 0, y: 0, scale: 1 };
  let drag = null, pendingPreview = null, cachedCut = null;
  const num = (id) => Number($(id).value) || 0;
  const int = (id) => Math.round(num(id));
  const maskOrigin = () => ({ x: int('cutterMaskX'), y: int('cutterMaskY') });

  function currentShape() {
    const [sizeX, sizeY] = $('cutterFootprint').value.split(',').map(Number);
    return geometry.shape({ type: $('cutterType').value, sizeX, sizeY, side: $('cutterSide').value,
      span: int('cutterWallSpan'), height: int('cutterWallHeight'), heightAboveTile: int('cutterHeight') });
  }

  function imageTransform() {
    const scale = num('cutterScale') / 100;
    return { x: int('cutterImageX'), y: int('cutterImageY'),
      width: (image?.naturalWidth || 0) * scale, height: (image?.naturalHeight || 0) * scale,
      angle: num('cutterRotation') * Math.PI / 180, flip: $('cutterFlip').checked };
  }

  function imageBounds() {
    const t = imageTransform(), cx = t.x + t.width / 2, cy = t.y + t.height / 2;
    const cos = Math.cos(t.angle), sin = Math.sin(t.angle);
    return geometry.bounds([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({
      x: cx + dx * t.width / 2 * cos - dy * t.height / 2 * sin,
      y: cy + dx * t.width / 2 * sin + dy * t.height / 2 * cos
    })));
  }

  function paintImage(context) {
    if (!image) return;
    const t = imageTransform();
    context.save();
    context.imageSmoothingEnabled = $('cutterFilter').value === 'smooth'; context.imageSmoothingQuality = 'high';
    context.translate(t.x + t.width / 2, t.y + t.height / 2);
    context.rotate(t.angle); context.scale(t.flip ? -1 : 1, 1);
    context.drawImage(image, -t.width / 2, -t.height / 2, t.width, t.height);
    context.restore();
  }

  function report(text, error = false) {
    $('cutterStatus').textContent = text;
    $('cutterStatus').style.color = error ? '#ffd08a' : '#c5d9f5';
  }

  function filename() {
    return ($('cutterName').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'meu-recorte') + '.png';
  }

  function changed() {
    cachedCut = null;
    $('cutterFloorOptions').hidden = $('cutterType').value !== 'floor';
    $('cutterWallOptions').hidden = $('cutterType').value !== 'wall';
    draw();
    clearTimeout(pendingPreview); pendingPreview = setTimeout(updatePreview, 70);
  }

  function normalize(id) {
    const element = $(id);
    if (element.type !== 'number') return;
    let value = Number(element.value);
    if (!Number.isFinite(value)) value = Number(element.min) || 0;
    if (element.min !== '') value = Math.max(Number(element.min), value);
    if (element.max !== '') value = Math.min(Number(element.max), value);
    element.value = element.step === '0.1' ? Math.round(value * 10) / 10 : Math.round(value);
  }
  controls.forEach((id) => {
    $(id).addEventListener('input', () => {
      if ($(id).type === 'number' && ($(id).value === '' || $(id).validity.badInput)) return;
      normalize(id); changed();
    });
    if ($(id).type === 'number') $(id).addEventListener('blur', () => { normalize(id); changed(); });
  });

  function centerMask() {
    const b = geometry.bounds(currentShape().points), t = imageTransform();
    $('cutterMaskX').value = Math.round(t.x + t.width / 2 - b.left - b.width / 2);
    $('cutterMaskY').value = Math.round(t.y + t.height / 2 - b.top - b.height / 2);
    changed();
  }
  $('cutterCenter').addEventListener('click', centerMask);

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#e2e5ea'; ctx.fillRect(0, 0, size.width, size.height);
    ctx.fillStyle = '#f4f5f7';
    for (let y = 0; y < size.height; y += 16) for (let x = 0; x < size.width; x += 16) {
      if ((x / 16 + y / 16) % 2) ctx.fillRect(x, y, 16, 16);
    }
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
    const s = currentShape(), origin = maskOrigin();
    // Full sheet remains visible at reduced opacity to locate neighboring assets.
    ctx.globalAlpha = .3; paintImage(ctx); ctx.globalAlpha = 1;
    ctx.save(); geometry.trace(ctx, s.points, origin.x, origin.y); ctx.clip(); paintImage(ctx); ctx.restore();
    geometry.trace(ctx, s.points, origin.x, origin.y);
    ctx.strokeStyle = '#dc9100'; ctx.lineWidth = 2 / view.scale; ctx.stroke();
    ctx.strokeStyle = '#1674c688'; ctx.lineWidth = 1 / view.scale; ctx.setLineDash([4 / view.scale, 4 / view.scale]);
    const segment = (a, b) => {
      ctx.beginPath(); ctx.moveTo(a.x + origin.x, a.y + origin.y); ctx.lineTo(b.x + origin.x, b.y + origin.y); ctx.stroke();
    };
    if ($('cutterType').value === 'floor') {
      for (let tx = 1; tx < s.sizeX; tx++) segment(geometry.project(tx, 0), geometry.project(tx, s.sizeY));
      for (let ty = 1; ty < s.sizeY; ty++) segment(geometry.project(0, ty), geometry.project(s.sizeX, ty));
      const height = int('cutterHeight');
      if (height > 0) {
        const floor = geometry.shape({ sizeX: s.sizeX, sizeY: s.sizeY }).points;
        floor.forEach((point, index) => segment(point, floor[(index + 1) % floor.length]));
        ctx.strokeStyle = '#129369aa';
        floor.forEach((point, index) => {
          const next = floor[(index + 1) % floor.length];
          segment({ x: point.x, y: point.y - height }, { x: next.x, y: next.y - height });
        });
      }
    } else {
      const a = s.points[3], b = s.points[2], h = int('cutterWallHeight'), span = int('cutterWallSpan');
      for (let index = 1; index < span; index++) {
        const base = { x: a.x + (b.x - a.x) * index / span, y: a.y + (b.y - a.y) * index / span };
        segment(base, { x: base.x, y: base.y - h });
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#e22d50'; ctx.lineWidth = 2 / view.scale;
    ctx.beginPath(); ctx.moveTo(origin.x - 7 / view.scale, origin.y); ctx.lineTo(origin.x + 7 / view.scale, origin.y);
    ctx.moveTo(origin.x, origin.y - 7 / view.scale); ctx.lineTo(origin.x, origin.y + 7 / view.scale); ctx.stroke();
    ctx.font = `${12 / view.scale}px system-ui`; ctx.fillStyle = '#b51d3a';
    ctx.fillText('Origem do tile', origin.x + 10 / view.scale, origin.y - 10 / view.scale);
    ctx.restore();
  }

  function syncZoom() {
    $('cutterZoom').value = Math.round(view.scale * 100);
    $('cutterZoomLabel').textContent = `${Math.round(view.scale * 100)}%`;
  }
  function fitView(selectionOnly = false) {
    if (size.width < 1 || size.height < 1) return;
    const b = geometry.bounds(currentShape().points), origin = maskOrigin(), sheet = imageBounds();
    let left = b.left + origin.x, top = b.top + origin.y, right = left + b.width, bottom = top + b.height;
    if (image && !selectionOnly) {
      left = Math.min(left, sheet.left); top = Math.min(top, sheet.top);
      right = Math.max(right, sheet.left + sheet.width); bottom = Math.max(bottom, sheet.top + sheet.height);
    }
    view.scale = Math.max(.05, Math.min(12, (size.width - 80) / (right - left), (size.height - 80) / (bottom - top)));
    view.x = size.width / 2 - (left + right) / 2 * view.scale;
    view.y = size.height / 2 - (top + bottom) / 2 * view.scale;
    syncZoom(); draw();
  }
  function zoomAt(scale, x = size.width / 2, y = size.height / 2) {
    const wx = (x - view.x) / view.scale, wy = (y - view.y) / view.scale;
    view.scale = Math.max(.05, Math.min(12, scale)); view.x = x - wx * view.scale; view.y = y - wy * view.scale;
    syncZoom(); draw();
  }
  $('cutterFit').addEventListener('click', () => fitView(false));
  $('cutterFocus').addEventListener('click', () => fitView(true));
  $('cutterZoom').addEventListener('input', () => zoomAt(num('cutterZoom') / 100));
  function localPoint(event) {
    const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const p = localPoint(event);
    zoomAt(view.scale * Math.exp(-event.deltaY * .0015), p.x, p.y);
  }, { passive: false });
  globalThis.AssetImageMenu.attach(canvas, {
    hasImage: () => Boolean(image),
    isFlipped: () => $('cutterFlip').checked,
    onFlip: () => {
      $('cutterFlip').checked = !$('cutterFlip').checked;
      changed();
      report($('cutterFlip').checked ? 'Imagem invertida horizontalmente.' : 'Imagem na orientação original.');
    },
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (![0, 2].includes(event.button)) return;
    canvas.focus(); const mode = event.button === 2 ? 'pan' : $('cutterDragMode').value;
    const prefix = mode === 'mask' ? 'cutterMask' : 'cutterImage';
    drag = { pointerId: event.pointerId, mode, prefix, start: localPoint(event),
      x: mode === 'pan' ? view.x : int(prefix + 'X'), y: mode === 'pan' ? view.y : int(prefix + 'Y') };
    canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    canvas.style.cursor = drag ? 'grabbing' : 'grab';
    if (!drag || drag.pointerId !== event.pointerId) return;
    const p = localPoint(event), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.mode === 'pan') { view.x = drag.x + dx; view.y = drag.y + dy; draw(); }
    else {
      $(drag.prefix + 'X').value = Math.round(drag.x + dx / view.scale);
      $(drag.prefix + 'Y').value = Math.round(drag.y + dy / view.scale); changed();
    }
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => canvas.addEventListener(name, () => { drag = null; }));
  canvas.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault(); const prefix = $('cutterDragMode').value === 'mask' ? 'cutterMask' : 'cutterImage', step = event.shiftKey ? 10 : 1;
    $(prefix + 'X').value = int(prefix + 'X') + delta[0] * step;
    $(prefix + 'Y').value = int(prefix + 'Y') + delta[1] * step; changed();
  });

  async function importFile(file) {
    if (!file) return;
    const sequence = ++loadSequence;
    try {
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file);
      });
      const next = new Image();
      await new Promise((resolve, reject) => { next.onload = resolve; next.onerror = () => reject(new Error('Formato de imagem inválido.')); next.src = url; });
      if (sequence !== loadSequence) return;
      image = next; originalName = file.name;
      $('cutterName').value = file.name.replace(/\.[^.]+$/, '') + '-recorte';
      $('cutterImageX').value = 0; $('cutterImageY').value = 0;
      $('cutterScale').value = 100; $('cutterRotation').value = 0; $('cutterFlip').checked = false;
      $('cutterSourceInfo').textContent = `${file.name} · ${image.naturalWidth} × ${image.naturalHeight} px`;
      centerMask(); fitView();
      report('Imagem importada. Arraste a máscara sobre um asset; use “Focar recorte” para ajustar as bordas.');
    } catch (error) { report(error.message, true); }
  }
  $('cutterImport').addEventListener('click', () => $('cutterFile').click());
  $('cutterFile').addEventListener('change', async () => { await importFile($('cutterFile').files[0]); $('cutterFile').value = ''; });
  $('cutterViewport').addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  $('cutterViewport').addEventListener('drop', (event) => { event.preventDefault(); importFile(event.dataTransfer.files[0]); });

  function prepareCut() {
    if (!image) throw new Error('Importe uma imagem primeiro.');
    if (cachedCut) return cachedCut;
    const s = currentShape(), b = geometry.bounds(s.points), origin = maskOrigin();
    if (b.width < 1 || b.height < 1 || b.width > 8192 || b.height > 8192 || b.width * b.height > 16000000) {
      throw new Error('Recorte muito grande: limite de 8192 px por lado e 16 milhões de pixels.');
    }
    const output = document.createElement('canvas'); output.width = b.width; output.height = b.height;
    const c = output.getContext('2d', { willReadFrequently: true });
    c.save(); geometry.trace(c, s.points, -b.left, -b.top); c.clip();
    c.translate(-b.left - origin.x, -b.top - origin.y); paintImage(c); c.restore();
    const pixels = c.getImageData(0, 0, b.width, b.height).data;
    let hasPixels = false;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) { hasPixels = true; break; }
    if (!hasPixels) throw new Error('A máscara não contém pixels visíveis. Mova-a sobre a imagem.');
    const frame = { file: filename(), width: b.width, height: b.height, left: b.left, top: b.top };
    cachedCut = { canvas: output, frame, shape: s, metadata: {
      tileWidth: 160, tileHeight: 80, exportScale: 2, sizeX: s.sizeX, sizeY: s.sizeY, frames: [frame],
      cutter: { type: $('cutterType').value, side: $('cutterType').value === 'wall' ? $('cutterSide').value : null,
        heightAboveTile: $('cutterType').value === 'wall' ? 0 : int('cutterHeight'),
        wallHeight: $('cutterType').value === 'wall' ? int('cutterWallHeight') : null,
        angleDegrees: 26.565051177, maskOrigin: origin, polygon: s.points,
        sourceFile: originalName, sourceTransform: imageTransform(), filter: $('cutterFilter').value }
    } };
    return cachedCut;
  }

  function updatePreview() {
    try {
      const result = prepareCut();
      preview.width = result.frame.width; preview.height = result.frame.height;
      preview.getContext('2d').drawImage(result.canvas, 0, 0);
      $('cutterInfo').textContent = `PNG: ${result.frame.width} × ${result.frame.height} px\nleft: ${result.frame.left}   top: ${result.frame.top}\nMáscara fixa · ângulo 26,565°`
        + ($('cutterType').value === 'floor' ? `\nAltura acima do tile: ${int('cutterHeight')} px` : '');
      ['cutterExport', 'cutterJson', 'cutterSend'].forEach((id) => { $(id).disabled = false; });
    } catch (error) {
      preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);
      $('cutterInfo').textContent = error.message;
      ['cutterExport', 'cutterJson', 'cutterSend'].forEach((id) => { $(id).disabled = true; });
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  $('cutterExport').addEventListener('click', () => {
    try {
      const result = prepareCut();
      result.canvas.toBlob((blob) => {
        if (!blob) { report('Não foi possível gerar o PNG.', true); return; }
        download(blob, result.frame.file); report(`Recorte exportado: ${result.frame.file}. Os outros assets fora da máscara não foram incluídos.`);
      }, 'image/png');
    } catch (error) { report(error.message, true); }
  });
  $('cutterJson').addEventListener('click', () => {
    try {
      const result = prepareCut();
      download(new Blob([JSON.stringify(result.metadata, null, 2)], { type: 'application/json' }), result.frame.file.replace(/\.png$/, '.offsets.json'));
      report('Offsets e configuração do recorte salvos; nenhum asset do jogo foi alterado.');
    } catch (error) { report(error.message, true); }
  });
  $('cutterSend').addEventListener('click', async () => {
    try {
      const result = prepareCut();
      if (window.assetPositioner.hasImage() && !window.confirm('Substituir a imagem aberta no posicionador por este recorte? Salve o projeto anterior se quiser mantê-lo.')) return;
      const isWall = $('cutterType').value === 'wall';
      const itemHeight = isWall ? 0 : int('cutterHeight');
      await window.assetPositioner.importImage(result.canvas.toDataURL('image/png'), result.frame.file, {
        positionPreset: isWall ? 'wall' : itemHeight > 0 ? 'object' : 'floor',
        positionWallSide: $('cutterSide').value, positionWallSpan: int('cutterWallSpan'),
        positionWallHeight: int('cutterWallHeight'),
        footprint: `${result.shape.sizeX},${result.shape.sizeY}`, height: isWall ? int('cutterWallHeight') : itemHeight,
        padding: 0, imageX: result.frame.left, imageY: result.frame.top,
        imageWidth: result.frame.width, imageHeight: result.frame.height,
        lockRatio: true, filter: $('cutterFilter').value, boundsMode: 'manual',
        cropLeft: result.frame.left, cropTop: result.frame.top,
        cropWidth: result.frame.width, cropHeight: result.frame.height, trim: false, alphaThreshold: 0
      });
      showTool('positioner');
    } catch (error) { report(error.message, true); }
  });

  function showTool(name) {
    for (const tool of ['positioner', 'cutter', 'twister']) {
      $(tool + 'Panel').hidden = tool !== name;
      $(tool + 'Tab').setAttribute('aria-pressed', String(tool === name));
    }
    requestAnimationFrame(() => {
      if (name === 'cutter') fitView();
      else if (name === 'twister') window.assetTwister?.fitView();
      else window.assetPositioner.fitView();
    });
  }
  $('positionerTab').addEventListener('click', () => showTool('positioner'));
  $('cutterTab').addEventListener('click', () => showTool('cutter'));
  $('twisterTab').addEventListener('click', () => showTool('twister'));
  let initialView = true;
  new ResizeObserver(() => {
    const rect = $('cutterViewport').getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const old = size; size = { width: rect.width, height: rect.height };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
    if (initialView) { fitView(); initialView = false; }
    else { view.x += (size.width - old.width) / 2; view.y += (size.height - old.height) / 2; draw(); }
  }).observe($('cutterViewport'));
  changed();
})();
