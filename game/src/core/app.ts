import { Application, TextureSource } from 'pixi.js';

// Ativa a geração de mipmaps por padrão na GPU para evitar serrilhado ao reduzir imagens
TextureSource.defaultOptions.autoGenerateMipmaps = true;

/** Cor de fundo da página e da moldura preta do letterbox. */
export const BACKGROUND_COLOR = 0x000000;

/**
 * Cria a Application do Pixi ocupando a janela inteira.
 * WebGL por escolha deliberada (compatibilidade), não WebGPU.
 */
export async function createApplication(host: HTMLElement): Promise<Application> {
  const app = new Application();

  await app.init({
    background: BACKGROUND_COLOR,
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
    preference: 'webgl',
  });

  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Coffe Mania');
  host.appendChild(app.canvas);

  return app;
}
