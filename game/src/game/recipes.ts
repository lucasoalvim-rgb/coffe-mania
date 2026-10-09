import { Assets, type Texture } from 'pixi.js';

/**
 * Receitas do Livro. A fonte é game/public/assets/foods/<id>/recipe.json; npm run assets:room
 * gera foods/catalog.json para o cliente e shared/recipecatalog para os servidores, que validam
 * custo, tempo, porções, lucro e XP. O cliente só apresenta esses valores.
 */
export interface Recipe {
  id: string;
  name: string;
  level: number;
  durationSeconds: number;
  portions: number;
  /** caféOuros pagos ao dono por porção servida a um cliente. */
  profitGold: number;
  /** caféOuros pagos ao iniciar o preparo. */
  costGold: number;
  /** XP ganho ao iniciar o preparo, como no original. */
  xp: number;
  /** Receitas fora do livro só resolvem preparos e porções já salvos. */
  inBook: boolean;
  source: string;
}

/** Receita com os dois estágios do prato: ingredientes no fogão e prato pronto. */
export interface RecipeArt extends Recipe {
  stage1: Texture;
  stage2: Texture;
}

const base = import.meta.env.BASE_URL ?? '/';
const foodsUrl = (file: string) => new URL(`assets/foods/${file}`, new URL(base, document.baseURI)).href;

export const RECIPE_CATALOG_URL = foodsUrl('catalog.json');

export async function loadRecipeArt(): Promise<RecipeArt[]> {
  const catalog = await Assets.load<{ recipes: Recipe[] }>(RECIPE_CATALOG_URL);
  if (!Array.isArray(catalog?.recipes)) throw new Error('Catálogo de receitas inválido.');
  return Promise.all(catalog.recipes.map(async (recipe) => {
    const [stage1, stage2] = await Promise.all([
      Assets.load<Texture>(foodsUrl(`${recipe.id}/stage_1.png`)),
      Assets.load<Texture>(foodsUrl(`${recipe.id}/stage_2.png`)),
    ]);
    stage1.source.autoGenerateMipmaps = true;
    stage2.source.autoGenerateMipmaps = true;
    return { ...recipe, stage1, stage2 };
  }));
}

/** Tempo no formato do Livro de Receitas original: "35 min", "6.0 hs". */
export function recipeTimeLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${seconds} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} hs`;
}
