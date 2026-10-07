import { Assets, type Texture } from 'pixi.js';

const base = import.meta.env.BASE_URL ?? '/';
const url = (file: string) => new URL(`assets/loading/${file}`, new URL(base, document.baseURI)).href;

export const LOADING_ASSET_URLS = {
  frame: url('frame-02.png'),
  second: url('loading_screen_2.png'),
  banners: [url('banner-01.png'), url('banner-02.png')],
} as const;

export interface LoadingTextures {
  frame: Texture;
  second: Texture;
  banners: Texture[];
}

/**
 * Assets da própria tela de loading: precisam existir antes de a tela aparecer,
 * então são carregados fora da barra de progresso.
 */
export async function loadLoadingTextures(): Promise<LoadingTextures> {
  const urls = [LOADING_ASSET_URLS.frame, LOADING_ASSET_URLS.second, ...LOADING_ASSET_URLS.banners];
  const loaded: Record<string, Texture> = await Assets.load(urls);

  return {
    frame: loaded[LOADING_ASSET_URLS.frame],
    second: loaded[LOADING_ASSET_URLS.second],
    banners: LOADING_ASSET_URLS.banners.map((url) => loaded[url]),
  };
}
