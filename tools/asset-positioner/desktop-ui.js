/* Layout dos painéis, atalhos de interface e redimensionamento das barras laterais. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, html = '') => {
    const node = document.createElement(tag);
    node.className = className;
    node.innerHTML = html;
    return node;
  };
  const icon = (name) => `<span data-icon="${name}"></span>`;
  const buttonIcon = (id, name) => { $(id).dataset.icon = name; };
  const group = (title, nodes, open = true) => {
    const details = make('details', 'panel-group');
    details.open = open;
    const summary = make('summary', '');
    summary.textContent = title;
    const body = make('div', 'panel-body');
    body.append(...nodes);
    details.append(summary, body);
    return details;
  };
  const help = (paragraph) => {
    const details = make('details', 'field-help', '<summary>Ajuda</summary>');
    paragraph.replaceWith(details);
    details.append(paragraph);
  };
  const sectionGroup = (section, title) => {
    section.querySelector('h2')?.remove();
    section.querySelectorAll(':scope > p.muted:not(.warning)').forEach(help);
    const replacement = group(title, [...section.childNodes]);
    section.replaceWith(replacement);
    return replacement;
  };
  const resizer = (side) => {
    const handle = make('div', 'panel-resizer');
    handle.dataset.resize = side;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side === 'left' ? 'Largura das propriedades' : 'Largura da saída');
    return handle;
  };

  const titlebar = make('header', 'app-titlebar',
    `<div class="app-brand"><span class="brand-mark" data-icon="box"></span><strong>Asset Studio</strong><span class="brand-project">Coffe Mania</span></div><div class="local-badge">${icon('shield-check')}Local e offline</div>`);
  document.body.prepend(titlebar);
  const tabs = document.querySelector('nav');
  tabs.className = 'workspace-tabs';
  tabs.append(make('span', 'workspace-spec', 'Tile 160 × 80 px <span>Isométrico 2:1</span>'));
  buttonIcon('positionerTab', 'move');
  buttonIcon('cutterTab', 'crop');
  buttonIcon('twisterTab', 'image-plus');
  $('positionerTab').setAttribute('aria-controls', 'positionerPanel');
  $('cutterTab').setAttribute('aria-controls', 'cutterPanel');
  $('twisterTab').setAttribute('aria-controls', 'twisterPanel');

  for (const mode of ['positioner', 'cutter']) {
    const cutter = mode === 'cutter';
    const main = $(cutter ? 'cutterPanel' : 'positionerPanel');
    main.classList.add('workspace');
    const left = main.querySelector('aside');
    const stage = main.querySelector('.stage');
    const sections = [...left.querySelectorAll(':scope > section')];
    const source = $(cutter ? 'cutterSourceInfo' : 'imageInfo');
    const title = left.querySelector('h1');
    title.textContent = 'Propriedades';
    const leftTitle = make('div', 'panel-title', icon('sliders-horizontal'));
    leftTitle.append(title);
    left.querySelector(':scope > .muted')?.remove();
    left.prepend(leftTitle);
    left.className = 'property-panel';
    left.setAttribute('aria-label', cutter ? 'Propriedades do recorte' : 'Propriedades do asset');

    const toolbar = make('div', 'workspace-toolbar');
    const importButton = $(cutter ? 'cutterImport' : 'importImage');
    importButton.classList.remove('primary');
    importButton.dataset.icon = 'image-plus';
    toolbar.append(importButton, $(cutter ? 'cutterFile' : 'imageFile'));
    toolbar.append(make('span', 'toolbar-divider'));
    if (cutter) {
      const dragField = $('cutterDragMode').closest('label');
      dragField.classList.add('toolbar-field');
      toolbar.append(dragField);
    } else {
      buttonIcon('openProject', 'folder-open');
      buttonIcon('saveProject', 'save');
      toolbar.append($('openProject'), $('saveProject'), $('projectFile'));
      sections[4].remove();
    }
    toolbar.append(make('span', 'toolbar-note', cutter ? 'Recorte não destrutivo' : 'A imagem original é preservada'));

    const viewToolbar = stage.querySelector('header');
    viewToolbar.className = 'view-toolbar';
    viewToolbar.querySelector(':scope > .muted')?.remove();
    const zoom = viewToolbar.querySelector('label');
    zoom.className = 'zoom-control';
    [...zoom.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).forEach((node) => node.remove());
    zoom.prepend(make('span', 'sr-only', 'Zoom de visualização'));
    zoom.prepend(make('span', '', icon('zoom-in')));
    buttonIcon(cutter ? 'cutterFit' : 'fitView', 'scan');
    if (cutter) buttonIcon('cutterFocus', 'scan-eye');

    source.className = 'document-name';
    source.textContent = cutter ? 'Nenhuma folha de assets aberta' : 'Nenhuma imagem aberta';
    const strip = make('div', 'document-strip', icon(cutter ? 'crop' : 'box'));
    strip.append(source, make('span', 'document-format', cutter ? 'Image Cutter' : 'PNG / imagem'));
    viewToolbar.after(strip);

    const empty = cutter ? make('div', 'empty-state') : $('empty');
    if (cutter) { empty.id = 'cutterEmpty'; $('cutterViewport').append(empty); }
    empty.className = 'empty-state';
    empty.innerHTML = `<span class="empty-art" data-icon="${cutter ? 'crop' : 'box'}"></span>
      <h2>${cutter ? 'Encontre o recorte certo' : 'Seu próximo asset começa aqui'}</h2>
      <p>${cutter ? 'Solte uma folha de assets e posicione<br>a máscara sobre o item desejado.' : 'Solte uma imagem na área de trabalho<br>ou importe um arquivo para posicionar.'}</p>
      <button class="primary" data-action="${importButton.id}" data-icon="image-plus">Importar imagem</button>
      <span class="empty-caption">${cutter ? 'Pisos, papéis de parede e itens altos' : '1 × 1, 2 × 1, 1 × 2 e 2 × 2'}</span>`;
    const legend = make('div', 'guide-legend', cutter
      ? '<span><i class="guide-crop"></i>Máscara</span><span><i class="guide-origin"></i>Origem do tile</span><span class="legend-note">Ângulo 26,565°</span>'
      : '<span><i class="guide-floor"></i>Chão</span><span><i class="guide-height"></i>Altura</span><span><i class="guide-origin"></i>Origem</span><span><i class="guide-crop"></i>Recorte</span><span class="legend-note">Guias não entram no PNG</span>');

    const status = $(cutter ? 'cutterStatus' : 'status');
    status.setAttribute('role', 'status');
    const statusbar = make('div', 'statusbar', '<span class="status-indicator"></span>');
    statusbar.append(status, make('span', 'status-tail', cutter ? 'Resolução nativa' : '160 × 80 px'));
    stage.append(legend);

    const right = make('aside', 'output-panel');
    right.setAttribute('aria-label', cutter ? 'Prévia e exportação' : 'Recorte e exportação');
    right.append(make('div', 'panel-title', `${icon('download')}<h2>Saída</h2>`));
    const actions = make('div', 'export-actions');
    const pngButton = $(cutter ? 'cutterExport' : 'exportPng');
    const jsonButton = $(cutter ? 'cutterJson' : 'exportJson');
    pngButton.textContent = cutter ? 'Exportar recorte PNG' : 'Exportar PNG';
    pngButton.dataset.icon = 'download'; jsonButton.dataset.icon = 'braces';
    if (!cutter) actions.append($('exportBackground').closest('label'));
    actions.append(pngButton, jsonButton);
    if (cutter) {
      const preview = $('cutterPreviewBox');
      right.append(group('Prévia transparente', [preview, make('p', 'preview-caption', 'Somente os pixels dentro da máscara')]));
      $('cutterInfo').className = 'data-readout';
      right.append(group('Dimensões e offsets', [$('cutterInfo')]));
      $('cutterSend').dataset.icon = 'move';
      $('cutterSend').classList.add('send-action');
      actions.append($('cutterSend'));
      const explanation = sections[3].querySelector('p.muted');
      if (explanation) { actions.append(explanation); help(explanation); }
      sections[3].remove();
    } else {
      $('metadata').className = 'data-readout';
      $('metadata').setAttribute('aria-live', 'polite');
      const metadata = group('Dimensões e offsets', [$('metadata'), $('clipWarning')]);
      right.append(sectionGroup(sections[3], 'Área de recorte'), metadata);
      const backgroundHint = make('p', 'muted', 'Fundo transparente, em resolução nativa.<br>Não altera os assets do jogo.');
      backgroundHint.id = 'exportBackgroundHint';
      actions.append(backgroundHint);
    }
    right.append(actions);
    sectionGroup(sections[0], 'Documento');
    sectionGroup(sections[1], cutter ? 'Máscara isométrica' : 'Gabarito e pegada');
    sectionGroup(sections[2], cutter ? 'Transformação da imagem' : 'Transformação');
    // Nested notes also fold away, while every original input remains accessible.
    left.querySelectorAll('.panel-body div > p.muted').forEach(help);
    left.querySelectorAll('button').forEach((button) => button.classList.add('full-width'));
    const shortcuts = make('div', 'shortcut-list', '<p><span>Mover 1 px</span><kbd>Setas</kbd></p><p><span>Mover 10 px</span><kbd>Shift + setas</kbd></p><p><span>Zoom</span><span>Scroll</span></p><p><span>Inverter</span><span>Clique direito</span></p><p><span>Mover visão</span><span>Arraste direito</span></p>');
    left.append(group('Controles e atalhos', [shortcuts], false));
    main.replaceChildren(toolbar, left, resizer('left'), stage, resizer('right'), right, statusbar);
  }

  document.querySelectorAll('button[style]').forEach((button) => button.removeAttribute('style'));
  document.querySelectorAll('input[type=checkbox]').forEach((input) => input.closest('label').classList.add('check-field'));
  document.querySelectorAll('[data-icon]').forEach((element) => {
    const svg = globalThis.AssetStudioIcons.create(element.dataset.icon);
    if (svg) element.prepend(svg);
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => $(button.dataset.action)?.click());
  });

  const syncDocument = () => {
    $('cutterEmpty').hidden = /\d+ × \d+ px$/.test($('cutterSourceInfo').textContent);
    document.querySelectorAll('.document-name').forEach((label) => { label.title = label.textContent; });
  };
  for (const id of ['imageInfo', 'cutterSourceInfo']) {
    new MutationObserver(syncDocument).observe($(id), { childList: true, characterData: true, subtree: true });
  }
  syncDocument();

  const root = document.documentElement;
  const panelValue = (side) => parseFloat(getComputedStyle(root).getPropertyValue(`--${side}-panel-width`)) || (side === 'left' ? 280 : 250);
  const resize = (side, width) => {
    const other = panelValue(side === 'left' ? 'right' : 'left');
    const maximum = Math.max(200, Math.min(420, window.innerWidth - other - 268));
    const next = Math.max(200, Math.min(maximum, width));
    root.style.setProperty(`--${side}-panel-width`, `${next}px`);
    document.querySelectorAll(`[data-resize="${side}"]`).forEach((handle) => {
      handle.setAttribute('aria-valuemin', '200'); handle.setAttribute('aria-valuemax', String(Math.round(maximum)));
      handle.setAttribute('aria-valuenow', String(Math.round(next)));
    });
  };
  document.querySelectorAll('[data-resize]').forEach((handle) => {
    const side = handle.dataset.resize;
    let drag = null;
    handle.setAttribute('aria-valuemin', '200'); handle.setAttribute('aria-valuemax', '420');
    handle.setAttribute('aria-valuenow', String(panelValue(side)));
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = { x: event.clientX, width: panelValue(side), pointerId: event.pointerId };
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('is-resizing'); event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      resize(side, drag.width + (event.clientX - drag.x) * (side === 'left' ? 1 : -1));
    });
    const finish = () => { drag = null; document.body.classList.remove('is-resizing'); };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => handle.addEventListener(name, finish));
    handle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const direction = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
      resize(side, panelValue(side) + direction * (event.shiftKey ? 30 : 10));
    });
    handle.addEventListener('dblclick', () => {
      root.style.removeProperty(`--${side}-panel-width`);
      document.querySelectorAll(`[data-resize="${side}"]`).forEach((separator) => separator.setAttribute('aria-valuenow', String(panelValue(side))));
    });
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 800) return;
    resize('left', panelValue('left')); resize('right', panelValue('right'));
  });
})();
