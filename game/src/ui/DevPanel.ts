import './ui.css';
import './dev-panel.css';

import {
  DEFAULT_LOADING_LAYOUT,
  MEASURED_WINDOW_LAYOUT,
  cloneLayout,
  type LoadingLayout,
} from '../screens/loading/layout';
import { loadStoredLayout, loadStoredLock, saveLayout, saveLock } from './dev-settings';

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  read: (layout: LoadingLayout) => number;
  write: (layout: LoadingLayout, value: number) => void;
}

interface SliderGroup {
  legend: string;
  sliders: SliderSpec[];
}

/** Controles de geometria, tipografia e contorno da tela de carregamento em desenvolvimento. */

const GROUPS: SliderGroup[] = [
  {
    legend: 'Janela dos banners',
    sliders: [
      { label: 'left', min: 0, max: 1200, step: 1, read: (l) => l.banner.left, write: (l, v) => (l.banner.left = v) },
      { label: 'top', min: 0, max: 800, step: 1, read: (l) => l.banner.top, write: (l, v) => (l.banner.top = v) },
      { label: 'largura', min: 200, max: 1920, step: 1, read: (l) => l.banner.width, write: (l, v) => (l.banner.width = v) },
      { label: 'altura', min: 100, max: 1080, step: 1, read: (l) => l.banner.height, write: (l, v) => (l.banner.height = v) },
      { label: 'raio', min: 0, max: 80, step: 1, read: (l) => l.banner.radius, write: (l, v) => (l.banner.radius = v) },
    ],
  },
  {
    legend: 'Barra de progresso',
    sliders: [
      { label: 'left', min: 0, max: 1600, step: 1, read: (l) => l.bar.left, write: (l, v) => (l.bar.left = v) },
      { label: 'top', min: 400, max: 1060, step: 1, read: (l) => l.bar.top, write: (l, v) => (l.bar.top = v) },
      { label: 'largura', min: 100, max: 1800, step: 1, read: (l) => l.bar.width, write: (l, v) => (l.bar.width = v) },
      { label: 'altura', min: 10, max: 140, step: 1, read: (l) => l.bar.height, write: (l, v) => (l.bar.height = v) },
      { label: 'raio', min: 0, max: 70, step: 1, read: (l) => l.bar.radius, write: (l, v) => (l.bar.radius = v) },
    ],
  },
  {
    legend: 'Texto',
    sliders: [
      { label: 'centro y', min: 700, max: 1075, step: 1, read: (l) => l.text.centerY, write: (l, v) => (l.text.centerY = v) },
    ],
  },
  {
    legend: 'Texto (extra)',
    sliders: [
      { label: 'tamanho', min: 20, max: 90, step: 1, read: (l) => l.text.fontSize, write: (l, v) => (l.text.fontSize = v) },
      { label: 'contorno', min: 0, max: 24, step: 1, read: (l) => l.text.strokeWidth, write: (l, v) => (l.text.strokeWidth = v) },
    ],
  },
];

const ICON_SLIDERS = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" />
  <path d="M4 12h4" /><path d="M12 12h8" /><circle cx="10" cy="12" r="2" />
  <path d="M4 17h12" /><path d="M20 17h0" /><circle cx="18" cy="17" r="2" />
</svg>`;

export interface DevPanelOptions {
  onLayoutChange: (layout: LoadingLayout) => void;
  onLockChange: (locked: boolean) => void;
  storage?: Storage;
}

/** Painel de calibragem. Instanciado apenas dentro de `import.meta.env.DEV`. */
export class DevPanel {
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly storage?: Storage;
  private readonly options: DevPanelOptions;
  private readonly inputs: { spec: SliderSpec; input: HTMLInputElement; value: HTMLElement }[] = [];
  private readonly lockCheckbox: HTMLInputElement;

  private layout: LoadingLayout;
  private open = false;

  constructor(host: HTMLElement, options: DevPanelOptions) {
    this.options = options;
    this.storage = options.storage ?? safeStorage();
    this.layout = loadStoredLayout(this.storage);

    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'ui-button dev-toggle';
    this.toggle.innerHTML = ICON_SLIDERS;
    this.toggle.setAttribute('aria-label', 'Abrir painel de ajustes');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));

    this.panel = document.createElement('div');
    this.panel.className = 'dev-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'group');
    this.panel.setAttribute('aria-label', 'Ajustes da tela de loading');

    const title = document.createElement('h2');
    title.textContent = 'Ajustes (dev)';
    this.panel.appendChild(title);

    this.lockCheckbox = document.createElement('input');
    this.lockCheckbox.type = 'checkbox';
    this.lockCheckbox.id = 'dev-lock-100';
    this.lockCheckbox.checked = loadStoredLock(this.storage);
    this.lockCheckbox.addEventListener('change', () => {
      saveLock(this.storage, this.lockCheckbox.checked);
      this.options.onLockChange(this.lockCheckbox.checked);
    });

    const lockLabel = document.createElement('label');
    lockLabel.className = 'dev-check';
    lockLabel.htmlFor = this.lockCheckbox.id;
    lockLabel.appendChild(this.lockCheckbox);
    lockLabel.appendChild(document.createTextNode('Travar em 100%'));
    this.panel.appendChild(lockLabel);

    for (const group of GROUPS) this.panel.appendChild(this.buildGroup(group));

    const actions = document.createElement('div');
    actions.className = 'dev-actions';
    actions.appendChild(
      this.buildAction('Restaurar padrão', () => this.replaceLayout(DEFAULT_LOADING_LAYOUT)),
    );
    actions.appendChild(
      this.buildAction('Colar na janela medida', () => this.replaceLayout(MEASURED_WINDOW_LAYOUT)),
    );
    actions.appendChild(this.buildAction('Copiar como JSON', () => this.copyJson()));
    this.panel.appendChild(actions);

    host.appendChild(this.toggle);
    host.appendChild(this.panel);
  }

  /** Layout inicial (já com o que estava salvo), para aplicar antes do 1º frame. */
  get initialLayout(): LoadingLayout {
    return cloneLayout(this.layout);
  }

  get initialLock(): boolean {
    return this.lockCheckbox.checked;
  }

  private buildGroup(group: SliderGroup): HTMLFieldSetElement {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = group.legend;
    fieldset.appendChild(legend);

    for (const spec of group.sliders) {
      const field = document.createElement('div');
      field.className = 'dev-field';

      const head = document.createElement('div');
      head.className = 'dev-field-head';
      const name = document.createElement('span');
      name.textContent = spec.label;
      const value = document.createElement('span');
      value.className = 'dev-field-value';
      head.append(name, value);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      input.value = String(spec.read(this.layout));
      input.setAttribute('aria-label', `${group.legend}: ${spec.label}`);
      value.textContent = input.value;

      input.addEventListener('input', () => {
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) return;
        spec.write(this.layout, parsed);
        value.textContent = input.value;
        this.commit();
      });

      field.append(head, input);
      fieldset.appendChild(field);
      this.inputs.push({ spec, input, value });
    }

    return fieldset;
  }

  private buildAction(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dev-action';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private replaceLayout(next: LoadingLayout): void {
    this.layout = cloneLayout(next);
    for (const entry of this.inputs) {
      const value = String(entry.spec.read(this.layout));
      entry.input.value = value;
      entry.value.textContent = value;
    }
    this.commit();
  }

  private copyJson(): void {
    const json = JSON.stringify(this.layout, null, 2);
    void navigator.clipboard?.writeText(json).catch(() => console.log(json));
  }

  private commit(): void {
    saveLayout(this.storage, this.layout);
    this.options.onLayoutChange(cloneLayout(this.layout));
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.toggle.setAttribute('aria-label', open ? 'Fechar painel de ajustes' : 'Abrir painel de ajustes');
    this.toggle.dataset.pressed = String(open);
  }

  destroy(): void {
    this.toggle.remove();
    this.panel.remove();
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
