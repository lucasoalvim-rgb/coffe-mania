/** Geometria da tela de carregamento em coordenadas de projeto (1920×1080). O recorte da moldura mede 992×585; windowBackdrop cobre a folga superior de 7 px. */

export interface RoundedRect {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

export interface LoadingLayout {
  /** Janela dos banners. */
  banner: RoundedRect;
  /** Barra de progresso listrada. */
  bar: RoundedRect;
  /** Texto de progresso: centro horizontal fixo em 960. */
  text: {
    centerX: number;
    centerY: number;
    fontSize: number;
    fontWeight: number;
    letterSpacing: number;
    strokeWidth: number;
  };
}

/** Geometria real do recorte no frame.png, usada só como fundo opaco. */
export const WINDOW_BACKDROP: RoundedRect = {
  left: 464,
  top: 247,
  width: 992,
  height: 585,
  radius: 27,
};

export const DEFAULT_LOADING_LAYOUT: LoadingLayout = {
  banner: { left: 464, top: 254, width: 992, height: 578, radius: 18 },
  bar: { left: 563, top: 888, width: 788, height: 46, radius: 15 },
  text: {
    centerX: 960,
    centerY: 980,
    fontSize: 50,
    fontWeight: 600,
    letterSpacing: 1.25,
    strokeWidth: 10,
  },
};

/** Preset alternativo: janela colada no recorte medido do frame. */
export const MEASURED_WINDOW_LAYOUT: LoadingLayout = {
  ...DEFAULT_LOADING_LAYOUT,
  banner: { ...WINDOW_BACKDROP },
};

export const COLORS = {
  background: 0x000000,
  backgroundStripeDark: 0xd6d4bf,
  backgroundStripeLight: 0xe5e2cf,
  text: 0x38210e,
  textStroke: 0xffffff,
  barBase: 0x3ea128,
  barStripe: 0x8ce052,
  /** Fundo do recorte da janela, atrás dos banners. */
  windowBackdrop: 0x38210e,
} as const;

/** Faixas verticais do fundo. */
export const BACKGROUND_STRIPE_WIDTH = 134;

export const CSS_COLORS = {
  text: '#38210e',
  panel: '#f4efe2',
  panelHover: '#e5dcc6',
  sliderTrack: '#6d4a2b',
  sliderThumb: '#8ce052',
} as const;

/** Listras: 16px de espessura perpendicular, período de 32px perpendicular. */
export const STRIPE = {
  thickness: 16,
  /** 32 * sqrt(2): deslocamento em x que fecha exatamente um período. */
  cyclePx: 32 * Math.SQRT2,
  cycleMs: 1800,
  /** Folga desenhada além das duas pontas da barra. */
  overscan: 64,
} as const;

export const TIMING = {
  /** Progresso simulado: random()*2 + 0.5 a cada 220ms. */
  progressTickMs: 220,
  progressStepBase: 0.5,
  progressStepRange: 2,
  /** Frases: relógio próprio, independente do progresso. */
  messageIntervalMs: 2200,
  /** Largura da barra: transição de 200ms linear. */
  barTransitionMs: 200,
  /** Banners: troca a cada 5s com crossfade de 700ms. */
  bannerIntervalMs: 5000,
  bannerFadeMs: 700,
  /** Tempo mínimo de exibição da tela. */
  minDisplayMs: 2600,
} as const;

export const cloneLayout = (layout: LoadingLayout): LoadingLayout => ({
  banner: { ...layout.banner },
  bar: { ...layout.bar },
  text: { ...layout.text },
});
