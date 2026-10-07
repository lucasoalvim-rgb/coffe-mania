'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const geometry = globalThis.AssetTwisterGeometry;
  const canvas = $('twisterCanvas'), ctx = canvas.getContext('2d');
  const viewport = $('twisterViewport');
  const regionIds = ['twisterX', 'twisterY', 'twisterWidth', 'twisterHeight'];
  let source = null, result = null, loadSequence = 0, pending = null, drag = null;
  let size = { width: 1, height: 1 }, view = { x: 30, y: 45, scale: 1 };
  const sourceWidth = () => source?.naturalWidth || source?.width || 0;
  const sourceHeight = () => source?.naturalHeight || source?.height || 0;
  const region = () => Object.fromEntries(['x', 'y', 'width', 'height'].map((key, i) => [key, Number($(regionIds[i]).value)]));
  const filename = () => ($('twisterName').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '') || 'minha-parede') +
    ($('twisterMode').value === 'flatten' ? '-retangular.png' : '-isometrica.png');
  function report(message, error = false) {
    $('twisterStatus').textContent = message;
    $('twisterStatus').style.color = error ? '#ffd08a' : '';
  }
  function enableOutput(enabled) {
    $('twisterExport').disabled = $('twisterReuse').disabled = !enabled;
  }
  function setRegion(x, y, width, height) {
    [x, y, width, height].forEach((value, i) => { $(regionIds[i]).value = value; });
  }
  function syncType() {
    const floor = $('twisterType').value === 'floor';
    $('twisterWallOptions').hidden = floor;
    $('twisterFloorOptions').hidden = !floor;
    $('twisterProjectionHint').textContent = floor
      ? 'Arestas a ±26,565°. Com resolução 160, um piso 1 × 1 converte entre retângulo 160 × 160 px e losango 160 × 80 px. A textura é ajustada à pegada e à resolução escolhidas.'
      : 'Arestas a ±26,565°. A largura horizontal e a altura vertical da face são preservadas. Cada 80 px de largura acrescenta 40 px de desnível ao PNG isométrico.';
    $('twisterSelectionHint').textContent = floor
      ? 'Para um piso isométrico, selecione a caixa inteira do losango ou paralelogramo, incluindo os cantos transparentes, e escolha a pegada correspondente. Para uma imagem retangular, selecione a textura desejada. Arraste a seleção ou ajuste os valores acima.'
      : 'Para uma parede isométrica, selecione a caixa que contém uma única face, incluindo os cantos transparentes. Para uma imagem retangular, selecione o retângulo desejado. Arraste a seleção na origem ou ajuste os valores acima.';
  }
  function update() {
    clearTimeout(pending);
    result = null; enableOutput(false);
    if (!source) { draw(); return; }
    try {
      const r = region();
      if (![r.x, r.y].every((n) => Number.isInteger(n) && n >= 0) ||
          r.x + r.width > sourceWidth() || r.y + r.height > sourceHeight()) {
        throw new Error('A área de origem precisa estar dentro da imagem. Ajuste X, Y, largura e altura.');
      }
      const [sizeX, sizeY] = $('twisterFootprint').value.split(',').map(Number);
      const plan = geometry.plan({ width: r.width, height: r.height, mode: $('twisterMode').value, side: $('twisterSide').value,
        type: $('twisterType').value, sizeX, sizeY, tileSize: Number($('twisterTileSize').value) });
      const output = document.createElement('canvas');
      output.width = plan.width; output.height = plan.height;
      const context = output.getContext('2d');
      context.imageSmoothingEnabled = $('twisterFilter').value === 'smooth';
      context.imageSmoothingQuality = 'high';
      context.setTransform(...plan.matrix);
      // Restrict sampling to the selected region before transforming a larger asset sheet.
      const crop = document.createElement('canvas');
      crop.width = r.width; crop.height = r.height;
      crop.getContext('2d').drawImage(source, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      context.drawImage(crop, 0, 0);
      result = { canvas: output, plan };
      enableOutput(true);
      const details = plan.type === 'floor'
        ? `Pegada: ${plan.sizeX} × ${plan.sizeY}\nRetângulo: ${plan.rectangleWidth} × ${plan.rectangleHeight} px\nProjeção: 2:1 (±26,565°)`
        : `Altura da face: ${plan.faceHeight} px\nInclinação: ${$('twisterSide').value === 'left' ? '+' : '−'}26,565°`;
      $('twisterInfo').textContent = `Origem: ${r.width} × ${r.height} px\nResultado: ${plan.width} × ${plan.height} px\n${details}`;
      report('Prévia atualizada. O PNG usa as dimensões indicadas, independentemente do zoom.');
    } catch (error) {
      $('twisterInfo').textContent = error.message;
      report(error.message, true);
    }
    draw();
  }
  function changed() {
    syncType();
    clearTimeout(pending);
    result = null; enableOutput(false);
    $('twisterInfo').textContent = source ? 'Atualizando prévia…' : 'Importe uma imagem para começar.';
    draw(); pending = setTimeout(update, 60);
  }
  for (const id of [...regionIds, 'twisterType', 'twisterMode', 'twisterSide', 'twisterFootprint', 'twisterTileSize', 'twisterFilter']) {
    $(id).addEventListener('input', changed);
    if ($(id).type === 'number') $(id).addEventListener('blur', () => {
      const previous = $(id).value;
      const value = Number($(id).value);
      $(id).value = Math.max(Number($(id).min), Math.min(Number($(id).max), Math.round(Number.isFinite(value) ? value : 0)));
      if ($(id).value !== previous) changed();
    });
  }

  function acceptSource(image, name) {
    source = image;
    $('twisterSourceInfo').textContent = `${name} · ${sourceWidth()} × ${sourceHeight()} px`;
    $('twisterSourceInfo').title = $('twisterSourceInfo').textContent;
    $('twisterEmpty').hidden = true;
    $('twisterFull').disabled = $('twisterTrim').disabled = false;
    setRegion(0, 0, sourceWidth(), sourceHeight());
    update(); fitView();
  }
  async function importFile(file) {
    if (!file) return;
    const sequence = ++loadSequence;
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível abrir a imagem. Use PNG, JPEG ou WebP.'));
        img.src = url;
      });
      if (sequence !== loadSequence) return;
      geometry.validateSize(image.naturalWidth, image.naturalHeight);
      $('twisterName').value = file.name.replace(/\.[^.]+$/, '') || 'minha-parede';
      acceptSource(image, file.name);
    } catch (error) {
      if (sequence === loadSequence) report(error.message, true);
    } finally { URL.revokeObjectURL(url); }
  }
  $('twisterImport').addEventListener('click', () => $('twisterFile').click());
  $('twisterFile').addEventListener('change', () => {
    const file = $('twisterFile').files[0]; $('twisterFile').value = ''; importFile(file);
  });
  viewport.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  viewport.addEventListener('drop', (event) => { event.preventDefault(); importFile(event.dataTransfer.files[0]); });
  $('twisterFull').addEventListener('click', () => {
    if (!source) return;
    setRegion(0, 0, sourceWidth(), sourceHeight()); update(); fitView();
  });
  $('twisterTrim').addEventListener('click', () => {
    if (!source) return;
    try {
      const scan = document.createElement('canvas'); scan.width = sourceWidth(); scan.height = sourceHeight();
      const context = scan.getContext('2d', { willReadFrequently: true }); context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, scan.width, scan.height).data;
      let left = scan.width, top = scan.height, right = -1, bottom = -1;
      for (let y = 0; y < scan.height; y++) for (let x = 0; x < scan.width; x++) {
        if (pixels[(y * scan.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (right < 0) { report('A imagem está completamente transparente.', true); return; }
      setRegion(left, top, right - left + 1, bottom - top + 1); update(); fitView();
    } catch (error) { report(error.message, true); }
  });
  $('twisterReuse').addEventListener('click', () => {
    if (!result) return;
    const next = result.canvas, name = filename();
    ++loadSequence;
    $('twisterMode').value = $('twisterMode').value === 'flatten' ? 'project' : 'flatten';
    acceptSource(next, name);
    report('Resultado carregado como entrada. O sentido da conversão foi invertido.');
  });
  $('twisterExport').addEventListener('click', () => {
    if (!result) return;
    const name = filename();
    result.canvas.toBlob((blob) => {
      if (!blob) { report('Não foi possível gerar o PNG.', true); return; }
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(`PNG exportado: ${name}.`);
    }, 'image/png');
  });

  function checker(x, y, width, height) {
    ctx.fillStyle = '#e2e5ea'; ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#f4f5f7';
    const tile = Math.max(1, 14 / view.scale);
    // Clip the pattern to the preview and avoid loops proportional to source resolution.
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    const firstX = Math.max(0, Math.floor((-view.x / view.scale - x) / tile));
    const firstY = Math.max(0, Math.floor((-view.y / view.scale - y) / tile));
    const lastX = Math.min(Math.ceil(width / tile), Math.ceil(((size.width - view.x) / view.scale - x) / tile));
    const lastY = Math.min(Math.ceil(height / tile), Math.ceil(((size.height - view.y) / view.scale - y) / tile));
    for (let iy = firstY; iy < lastY; iy++) for (let ix = firstX; ix < lastX; ix++) {
      if ((ix + iy) % 2) ctx.fillRect(x + ix * tile, y + iy * tile, tile, tile);
    }
    ctx.restore();
  }
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.width, size.height);
    if (!source) return;
    ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.scale, view.scale);
    ctx.imageSmoothingEnabled = $('twisterFilter').value === 'smooth';
    const w = sourceWidth(), h = sourceHeight(), rightX = w + 60 / view.scale;
    checker(0, 0, w, h); ctx.drawImage(source, 0, 0);
    ctx.fillStyle = '#c8d3df'; ctx.font = `${12 / view.scale}px system-ui`;
    ctx.fillText('Origem', 0, -12 / view.scale);
    const r = region();
    if ([r.x, r.y, r.width, r.height].every(Number.isFinite)) {
      ctx.strokeStyle = '#e8a318'; ctx.lineWidth = 2 / view.scale;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      if (result) {
        ctx.beginPath();
        result.plan.sourcePoints.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](r.x + p.x, r.y + p.y));
        ctx.closePath(); ctx.stroke();
      }
    }
    if (result) {
      checker(rightX, 0, result.canvas.width, result.canvas.height); ctx.drawImage(result.canvas, rightX, 0);
      ctx.fillStyle = '#c8d3df'; ctx.fillText('Resultado', rightX, -12 / view.scale);
    }
    ctx.restore();
  }
  function syncZoom() {
    $('twisterZoom').value = Math.round(view.scale * 100);
    $('twisterZoomLabel').textContent = `${Math.round(view.scale * 100)}%`;
  }
  function fitView() {
    if (!source) { draw(); return; }
    const width = sourceWidth() + (result?.canvas.width || 0);
    const height = Math.max(sourceHeight(), result?.canvas.height || 0);
    view.scale = Math.max(.05, Math.min(12, Math.max(1, size.width - 100) / width, Math.max(1, size.height - 80) / height));
    view.x = (size.width - width * view.scale - (result ? 60 : 0)) / 2;
    view.y = (size.height - height * view.scale) / 2 + 12;
    syncZoom(); draw();
  }
  function zoomAt(scale, x = size.width / 2, y = size.height / 2) {
    const wx = (x - view.x) / view.scale, wy = (y - view.y) / view.scale;
    view.scale = Math.max(.05, Math.min(12, scale)); view.x = x - wx * view.scale; view.y = y - wy * view.scale;
    syncZoom(); draw();
  }
  const point = (event) => {
    const bounds = canvas.getBoundingClientRect(); return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  $('twisterFit').addEventListener('click', fitView);
  $('twisterZoom').addEventListener('input', () => zoomAt(Number($('twisterZoom').value) / 100));
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const p = point(event); zoomAt(view.scale * Math.exp(-event.deltaY * .0015), p.x, p.y);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    if (!source || ![0, 2].includes(event.button)) return;
    const p = point(event), r = region(), x = (p.x - view.x) / view.scale, y = (p.y - view.y) / view.scale;
    const selection = event.button === 0 && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
    drag = { id: event.pointerId, p, selection, region: r, view: { ...view } };
    canvas.focus(); canvas.setPointerCapture(event.pointerId); event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const p = point(event), dx = p.x - drag.p.x, dy = p.y - drag.p.y;
    if (drag.selection) {
      const r = drag.region;
      setRegion(Math.max(0, Math.min(sourceWidth() - r.width, Math.round(r.x + dx / view.scale))),
        Math.max(0, Math.min(sourceHeight() - r.height, Math.round(r.y + dy / view.scale))), r.width, r.height);
      changed();
    } else { view.x = drag.view.x + dx; view.y = drag.view.y + dy; draw(); }
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
  new ResizeObserver(() => {
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const previous = size; size = { width: rect.width, height: rect.height };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
    view.x += (size.width - previous.width) / 2; view.y += (size.height - previous.height) / 2; draw();
  }).observe(viewport);
  window.assetTwister = Object.freeze({ fitView });
  draw();
})();
