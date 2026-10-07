import { GAME_VERSION } from '../../core/version';
import {
  Container,
  Graphics,
  Polygon,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Texture,
} from 'pixi.js';

import { FONT_FAMILY } from '../../core/fonts';
import { playRandomSfx } from '../../audio/sfx';
import type { Screen } from '../../core/screen-manager';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { Actor } from '../../world/Actor';
import { CLIP } from '../../avatar/clips';
import { SFX_START_COOKING_URL, type ActionBarButtonTextures, type ActionBarIconTexture, type NpcEmotionTextures, type StoreToolbarTextures } from '../../game/asset-manifest';
import { ActionBarMood } from './ActionBarMood';
import { createActionBarBetaSlots } from './ActionBarBetaSlots';
import { MAIN_ACTION_BAR_SCALE, StoreActionBar } from './StoreActionBar';
import { RoomStoreController } from './RoomStoreController';
import { roomModelItems, type RoomSnapshot, type RoomInventoryClient } from '../../game/room-inventory';
import { RoomRealtime, type RoomEvent, type SharedActor, type SharedWorld } from '../../game/room-realtime';
import { WardrobeScreenModal, type WardrobeScreenTextures } from './WardrobeScreenModal';
import { SettingsModal, type SettingsModalOptions } from '../../ui/SettingsModal';
import { findPath } from '../../world/PathFinder';
import { RoomModel, footprintTiles, type RoomItem } from '../../world/RoomModel';
import {
  CookScreenModal,
  type CookRecipeEvent,
  type CookScreenTextures,
} from './CookScreenModal';
import { CookProgressBar } from './CookProgressBar';
import { CookProgressCallout } from './CookProgressCallout';
import { DoorView } from './DoorView';
import { doorOpeningTile } from '../../world/doorGeometry';
import { StoveActionMenu } from './StoveActionMenu';
import {
  DEPTH_BIAS_ITEM,
  DEPTH_BIAS_WALL_DECOR,
  FLOOR_DRAW_PRIORITY,
  POPUP_DRAW_PRIORITY,
  ROOM_ASSET_SCALE,
  directionFromDelta,
  itemDepth,
  screenToTile,
  tileToScreenX,
  tileToScreenY,
  type Tile,
} from '../../world/iso';
import { bakeAvatars, type AvatarAtlasBundle, type BakedAvatarBundle } from '../../avatar/bake';
import { restoreAppearance } from '../../avatar/appearance';
import { NpcLookPicker } from '../../avatar/NpcLookPicker';
import { releaseNpcAvatar, type NpcAvatarSource } from '../../avatar/NpcAvatarSource';
import { loadAvatarAssets } from '../../game/asset-manifest';
import { saveAppearance } from '../../game/appearance';
import { rotatedArt, type ArtProvider } from '../../game/indoor-art';
import { ActorView } from './ActorView';
import { AvatarActorView } from './AvatarActorView';
import { NpcEmotion } from './NpcEmotion';
import { RoomDepthSorter, setItemOverlayDepth } from './RoomDepthSorter';
import { OutsideNpcManager, type PreparedNpcView } from './OutsideNpcManager';
import { createProceduralWallView, type WallWallpaper } from './ProceduralWallView';
import { TopBars, type TopBarsTextures } from './TopBars';
import type { PlayerState } from '../../game/player-state';
import { cookingTime, type CookingClient, type CookingSnapshot, type StoveCooking } from '../../game/cooking';
import {
  PAN_KEY_STEP,
  RoomCamera,
  ZOOM_KEY_STEP,
  ZOOM_WHEEL_STEP,
  type CameraRect,
} from './RoomCamera';
import {
  TEST_GRID,
  createArtView,
  createFloorViews,
  createItemViews,
  createSceneBackgroundView,
  drawFloor,
  drawTestGrid,
  tileDiamond,
  rotateFloorSprite,
} from './iso-art';

/** Altura máxima de móvel, usada para enquadrar a câmera. */
const MAX_ITEM_HEIGHT = 150 * ROOM_ASSET_SCALE;

/** Folga em volta da sala, para ela não encostar na borda da tela. */
const CAMERA_PADDING = 60 * ROOM_ASSET_SCALE;

/** Mantém as bordas laterais e superior da textura longe do pan habitual. */
const SCENE_CAMERA_INSET = 900;

/** A diagonal até (25,25) usa apenas o terreno verde contínuo abaixo da arte. */
const SCENE_DIAGONAL_PAN_TILE = 25;
const MOBILE_LANDSCAPE_HUD_SCALE = 1.15;
const ACTION_BAR_UI_SCALE = 1.15;
/** Isolated renderer preview only; gameplay duration always comes from the server. */
const LOCAL_COOKING_PREVIEW_MS = 2000;
const LOCAL_COOKING_DURATION_MS = 30_000;
const COOKING_PROGRESS_SCALE = 1.2;
const STOVE_MENU_TOP_DROP = 14;
const TARGET_STOVE_ALPHA = 0.38;

/**
 * Quanto o ponteiro pode andar, em px de stage, antes do gesto deixar de ser
 * clique e virar arraste.
 *
 * O botão esquerdo tem dois papéis: andar até o tile e arrastar a câmera. Sem
 * limiar, todo arraste terminaria mandando o jogador andar para onde o dedo
 * soltou. Com limiar, o toque curto continua sendo clique e o movimento longo
 * cancela o clique.
 */
const DRAG_THRESHOLD = 6;

const NPC_COLORS = [0xd8763f, 0x8e5bb5, 0x3f9e8c, 0xc9515f];


/** Pixels que um dente de roda de mouse costuma reportar. */
const WHEEL_PIXELS_PER_NOTCH = 100;

/** Pixels por unidade quando o navegador reporta em linhas ou páginas. */
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 100;

/** Teto de passos por evento, para um `deltaY` gigante não pular o zoom inteiro. */
const WHEEL_MAX_NOTCHES = 4;

/**
 * Converte o `deltaY` da roda em passos de zoom, com sinal invertido: girar para
 * cima aproxima.
 *
 * Usar só o SINAL do delta parece suficiente e não é: o trackpad manda muitos
 * eventos pequenos, o mouse manda um de ~100 por dente, e um evento sintético
 * pode trazer 3000 de uma vez. Contar em dentes trata os três casos com a mesma
 * conta, e o teto evita que um delta enorme atravesse a faixa de zoom inteira.
 */
export function wheelNotches(deltaY: number, deltaMode = 0): number {
  const escala = deltaMode === 1 ? WHEEL_LINE_PIXELS : deltaMode === 2 ? WHEEL_PAGE_PIXELS : 1;
  const dentes = (-deltaY * escala) / WHEEL_PIXELS_PER_NOTCH;
  return Math.max(-WHEEL_MAX_NOTCHES, Math.min(WHEEL_MAX_NOTCHES, dentes));
}

interface DragState {
  pointerId: number;
  lastX: number;
  lastY: number;
  /** Distância total percorrida, para comparar com DRAG_THRESHOLD. */
  travelled: number;
}

interface PinchState {
  startDistance: number;
  startZoom: number;
  center: { x: number; y: number };
}

/** Vista procedural ou avatar renderizado a partir do mesmo modelo. */
interface ActorRenderer {
  readonly view: Container;
  sync(): void;
  update?(deltaMs: number): void;
  setActionClip?(clip: number | null, elapsedMs?: number): void;
  destroy(): void;
}

interface Wanderer {
  actor: Actor;
  view: ActorRenderer;
  idleMs: number;
}

export interface RoomScreenOptions {
  /** Authenticated server snapshot; absent HUDs stay hidden, never simulated. */
  playerState?: PlayerState;
  roomSnapshot?: RoomSnapshot;
  roomClient?: RoomInventoryClient;
  realtime?: RoomRealtime;
  model?: RoomModel;
  /** Quantos NPCs vagam pela sala, além do jogador. */
  npcCount?: number;
  random?: () => number;
  showHud?: boolean;
  /** Arte dos móveis; entradas ausentes usam o desenho procedural de fallback. */
  artProvider?: ArtProvider;
  /** Símbolo do piso. `FloorTile` é o piso de madeira da sala inicial. */
  floorClassName?: string;
  /** Atlas de aparências. O primeiro pertence ao jogador; os demais compõem o conjunto de NPCs em prévias isoladas. */

  avatars?: readonly BakedAvatarBundle[];
  /** Static white silhouette shared while individual appearances load. */
  placeholderAvatar?: AvatarAtlasBundle;
  /** Normal gameplay generates and bakes one new look before each street spawn. */
  npcAvatarSource?: NpcAvatarSource;
  /** Liga os atalhos de teclado da câmera. Desligado nos testes de unidade. */
  keyboardCamera?: boolean;
  /** Spawna pedestres e clientes autônomos na calçada externa. */
  outsideNpcs?: boolean;
  /** Textura da barra de ações da UI do jogo (inferior central). */
  actionBarTexture?: Texture;
  storeBarTexture?: Texture;
  storeBarIcons?: readonly ActionBarIconTexture[];
  storeTopButtonTexture?: Texture;
  storeToolbarTextures?: StoreToolbarTextures;
  actionBarButtons?: ActionBarButtonTextures;
  actionBarIcons?: readonly ActionBarIconTexture[];
  npcEmotionTextures?: NpcEmotionTextures;
  /** Nome autenticado e preferências locais de música/efeitos. */
  settings?: SettingsModalOptions;
  /** Base das barras de progresso no topo da interface. */
  topBarsTextures?: TopBarsTextures;
  /** Texturas da tela de receitas do fogão (cook screen e food card). */
  cookTextures?: CookScreenTextures;
  /** Sessão de preparo e estado durável retornados pelo servidor. */
  cookingClient?: CookingClient;
  cookingSnapshot?: CookingSnapshot;
  wardrobeTextures?: WardrobeScreenTextures;
  onWardrobeVisibilityChange?: (open: boolean) => void;
}

/** Cena isométrica com câmera e HUD independente do zoom. O mundo contém piso, destaques e objetos ordenados por RoomDepthSorter. A hitbox troca de tile na metade do passo; os sprites continuam interpolados. */

export class RoomScreen implements Screen {
  readonly view = new Container();
  readonly model: RoomModel;

  /** Raiz da cena da sala, em coordenadas de tela isométrica. */
  readonly world = new Container();

  /** Câmera: só números. Quem aplica é `cameraLayer`. */
  readonly camera: RoomCamera;

  /** Modal da tela de receitas aberto ao clicar no fogão. */
  readonly cookModal?: CookScreenModal;
  readonly wardrobeModal?: WardrobeScreenModal;
  readonly settingsModal?: SettingsModal;
  readonly storeBar?: StoreActionBar;

  /** Barras de recursos fora da câmera. */
  readonly topBars?: TopBars;

  private readonly cameraLayer = new Container();
  /** Cidade/estrada atrás do quarto, movida e ampliada pela mesma câmera. */
  private readonly sceneArt = new Container();
  /**
   * Alvo de ponteiro do tamanho da stage, atrás de tudo.
   *
   * Existe para o arraste e a roda funcionarem em qualquer lugar da tela, e não
   * só sobre o losango do piso: fora da sala, sobre um móvel ou sobre a parede.
   */
  private readonly backdrop = new Container();
  private readonly floor = new Graphics();
  private readonly floorArt = new Container();
  private readonly testGrid = new Graphics();
  private readonly highlight = new Graphics();
  private readonly target = new Graphics();
  private readonly hud: Text | null = null;
  private fpsElapsedMs = 0;
  private fpsFrames = 0;
  private fps = 0;

  private readonly random: () => number;
  private readonly artProvider?: ArtProvider;
  private readonly cookProgressTextures?: CookScreenTextures;
  private readonly cookingClient?: CookingClient;
  private readonly occupiedStoves = new Map<string, StoveCooking>();
  private checkingCookScreen = false;
  private startingCook = false;
  private cancellingCook = false;
  private destroyed = false;
  private readonly floorClassName: string;
  private roomSnapshot?: RoomSnapshot;
  private roomStore?: RoomStoreController;
  private readonly realtime?: RoomRealtime;
  private readonly liveActors = new Map<string, { actor: Actor; view: ActorRenderer; state: SharedActor; bundle?: BakedAvatarBundle; appearanceRevision: number; appearanceController?: AbortController }>();
  private readonly mealViews = new Map<string, Sprite>();
  private readonly sharedCookingViews = new Map<string, Sprite>();
  private readonly sharedCookingProgress = new Map<string, { mode: 'cooking' | 'serving'; bar: CookProgressBar }>();
  private readonly liveEmotions = new Map<string, { id: string; effect: NpcEmotion }>();
  private readonly npcEmotionTextures?: NpcEmotionTextures;
  private connectionHint?: Text;
  private networkPending = 0;
  private noticeTimer?: ReturnType<typeof setTimeout>;
  private readonly itemViews = new Map<RoomItem, Container[]>();
  private readonly floorUnitViews = new Map<string, Sprite>();
  private readonly avatars: readonly BakedAvatarBundle[];
  private readonly placeholderAvatar?: AvatarAtlasBundle;
  private readonly npcAvatarSource?: NpcAvatarSource;
  private readonly npcLookPicker: NpcLookPicker;
  private readonly npcAvatarIndices = new Map<Actor, number>();
  private readonly player: Actor;
  private readonly playerView: ActorRenderer;
  private playerAppearance = '';
  private appearanceRevision = 0;
  private appearanceAtlas: BakedAvatarBundle | null = null;
  private readonly wanderers: Wanderer[] = [];
  private readonly outsideNpcManager?: OutsideNpcManager;
  private readonly actionBarMood?: ActionBarMood;
  private readonly actionBarLayer = new Container();
  private readonly actionIconHovers: Array<{ sprite: Sprite; targetY: number }> = [];
  private topBarsBaseWidth = 0;
  private readonly stoveViews = new Map<RoomItem, Array<Sprite | Graphics>>();
  private readonly doorViews: DoorView[] = [];
  private readonly depthSorter = new RoomDepthSorter();
  private selectedStove?: RoomItem;
  private pendingCook?: { stove: RoomItem; recipe: CookRecipeEvent };
  private stoveActions?: StoveActionMenu;
  private stoveActionsStove?: RoomItem;
  private cookCallout?: CookProgressCallout;
  private hoveredStove?: RoomItem;
  private servingProcess?: {
    stove: RoomItem;
    phase: 'walking' | 'requesting' | 'serving' | 'finalizing';
    elapsedMs: number;
    startedAtMs?: number;
    durationMs?: number;
    progress?: CookProgressBar;
  };

  private hovered: Tile | null = null;
  private drag: DragState | null = null;
  private readonly touchPoints = new Map<number, { x: number; y: number }>();
  private pinch: PinchState | null = null;
  /** Ligado quando o arraste passou do limiar: o `pointertap` seguinte é ignorado. */
  private dragCancelledTap = false;
  private pinchCancelledTap = false;
  private readonly keyboardCamera: boolean;
  /** Pixels físicos por pixel de stage. Vem de `setStageScale`. */
  private outerScale = 1;

  /** Processo de cozimento atual no fogão (estágio 1 - ingredientes -> estágio 2 - prato pronto). */
  private cookingProcess?: {
    stove: RoomItem;
    recipeId: string;
    recipeName: string;
    stage: 1 | 2;
    phase: 'walking' | 'preparing' | 'cooking' | 'ready';
    stage1Texture: Texture;
    stage2Texture: Texture;
    elapsedMs: number;
    durationMs: number;
    preparingAtMs?: number;
    startedAtMs?: number;
    readyAtMs?: number;
    placementActive: boolean;
    view: Sprite;
    progress?: CookProgressBar;
  };

  /** Dados do cozimento atual para consulta e testes. */
  get cooking(): { stage: 1 | 2; recipeName: string; view: Sprite } | undefined {
    if (!this.cookingProcess) return undefined;
    return {
      stage: this.cookingProcess.stage,
      recipeName: this.cookingProcess.recipeName,
      view: this.cookingProcess.view,
    };
  }

  constructor(options: RoomScreenOptions = {}) {
    this.model = options.model ?? new RoomModel();
    this.random = options.random ?? Math.random;
    this.artProvider = options.artProvider;
    this.cookProgressTextures = options.cookTextures;
    this.cookingClient = options.cookingClient;
    this.floorClassName = options.floorClassName ?? 'FloorTile';
    this.roomSnapshot = options.roomSnapshot;
    this.realtime = options.realtime;
    this.npcEmotionTextures = options.npcEmotionTextures;
    this.avatars = options.avatars ?? [];
    this.placeholderAvatar = options.placeholderAvatar;
    this.npcAvatarSource = options.npcAvatarSource;
    this.npcLookPicker = new NpcLookPicker(this.avatars.slice(1).map((bundle, offset) => bundle.lookKey ?? `atlas:${offset + 1}`), this.random);
    this.playerAppearance = options.playerState?.appearance ?? '';
    this.keyboardCamera = options.keyboardCamera ?? true;

    this.view.label = 'room-screen';
    this.world.sortableChildren = true;
    this.cameraLayer.label = 'room-camera';
    this.sceneArt.label = 'room-city-layer';

    // hitArea cobre a stage sem criar geometria de fundo.

    this.backdrop.label = 'room-backdrop';
    this.backdrop.eventMode = 'static';
    this.backdrop.hitArea = new Rectangle(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    this.floor.label = 'room-floor';
    this.floor.zIndex = FLOOR_DRAW_PRIORITY;
    this.floor.eventMode = 'static';
    this.floor.cursor = 'pointer';
    this.floor.on('pointermove', this.onPointerMove);
    this.floor.on('pointertap', this.onPointerTap);

    this.floorArt.label = 'room-floor-art';
    this.floorArt.zIndex = FLOOR_DRAW_PRIORITY + 1;
    this.testGrid.label = 'room-test-grid';
    this.testGrid.zIndex = FLOOR_DRAW_PRIORITY - 1;
    this.highlight.zIndex = FLOOR_DRAW_PRIORITY + 2;
    this.target.zIndex = FLOOR_DRAW_PRIORITY + 3;

    this.world.addChild(this.floor, this.floorArt, this.highlight, this.target);
    this.buildFloor();
    this.buildSceneBackground();
    drawTestGrid(this.testGrid, this.model);
    for (const item of this.model.items) this.addItem(item);

    const start = this.pickFreeTile({ tx: 4, ty: 4 });
    this.player = new Actor('player');
    this.player.setTilePosition(start.tx, start.ty);
    this.playerView = this.createActorView(this.player, 0, 0x4f7fd0);
    this.world.addChild(this.playerView.view);

    // Normal play uses street customers only. Explicit indoor actors remain a
    // deterministic renderer/test fixture, never mixed into the street flow.
    const npcCount = options.outsideNpcs || options.realtime ? 0 : options.npcCount ?? 0;
    for (let i = 0; i < npcCount; i++) {
      const tile = this.pickFreeTile(this.spreadTile(i));
      const actor = new Actor(`npc-${i + 1}`);
      actor.setTilePosition(tile.tx, tile.ty);
      const view = this.createActorView(actor, i + 1, NPC_COLORS[i % NPC_COLORS.length]);
      this.world.addChild(view.view);
      this.wanderers.push({ actor, view, idleMs: 200 + this.random() * 1200 });
    }

    if (options.outsideNpcs && !options.realtime) {
      this.outsideNpcManager = new OutsideNpcManager({
        model: this.model,
        world: this.world,
        createView: (actor, index, color) => this.createActorView(actor, index, color),
        prepareView: this.npcAvatarSource ? () => this.prepareNpcView() : undefined,
        random: this.random,
        emotionTextures: options.npcEmotionTextures,
      });
    }

    this.cameraLayer.addChild(this.sceneArt, this.testGrid, this.world);
    this.view.addChild(this.backdrop, this.cameraLayer);

    this.camera = new RoomCamera(this.contentBounds(), {
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    });
    this.camera.setBitterMode(options.settings?.getBitterMode?.() ?? false);
    this.centerCameraOnScene();
    this.applyCamera();

    /** Gestos são registrados no piso e no fundo interativos. Um ancestral passivo não recebe a notificação; torná-lo static altera o alvo dos sprites descendentes. */

    for (const alvo of [this.floor, this.backdrop]) {
      alvo.on('pointerdown', this.onDragStart);
      alvo.on('pointerup', this.onDragEnd);
      alvo.on('pointerupoutside', this.onDragEnd);
      alvo.on('wheel', this.onWheel);
    }

    // `globalpointermove` é o único que não borbulha nem depende de acerto: o Pixi
    // o entrega à lista de elementos interativos. O fundo sempre está nela.
    this.backdrop.on('globalpointermove', this.onDragMove);
    if (options.roomSnapshot) this.backdrop.on('pointertap', (event) => {
      if (this.storeBar?.isOpen) this.onPointerTap(event);
    });

    if (this.keyboardCamera && typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    if (options.showHud ?? true) {
      this.hud = new Text({
        text: '',
        style: new TextStyle({
          fontFamily: [FONT_FAMILY, 'sans-serif'],
          fontSize: 16,
          fontWeight: '600',
          fill: 0x000000,
          lineHeight: 19,
        }),
      });
      this.hud.anchor.set(0, 1);
      this.hud.position.set(16, STAGE_HEIGHT - 12);
      this.hud.eventMode = 'none';
      this.view.addChild(this.hud);
      this.updateHud();
    }

    if (options.topBarsTextures) {
      this.topBars = new TopBars(options.topBarsTextures, options.playerState);
      this.topBarsBaseWidth = options.topBarsTextures.back.width;
      this.view.addChild(this.topBars.view);
    }

    if (options.actionBarTexture) {
      this.actionBarLayer.label = 'room-action-bar-layer';
      this.actionBarLayer.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      this.actionBarLayer.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      this.view.addChild(this.actionBarLayer);
      const growth = 1.15;
      const scale = MAIN_ACTION_BAR_SCALE;
      const bar = new Sprite(options.actionBarTexture);
      bar.label = 'room-action-bar';
      bar.anchor.set(0.5, 1);
      bar.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
      bar.scale.set(scale); 
      bar.eventMode = 'none'; 
      this.actionBarLayer.addChild(bar);

      const left = bar.x - bar.width / 2;
      const top = bar.y - bar.height;
      if (options.topBarsTextures) {
        const betaSlots = createActionBarBetaSlots(options.topBarsTextures.icons);
        betaSlots.position.set(left, top);
        betaSlots.scale.set(scale);
        this.actionBarLayer.addChild(betaSlots);
      }
      if (options.npcEmotionTextures) {
        this.actionBarMood = new ActionBarMood(
          options.npcEmotionTextures, scale, options.playerState?.satisfaction, options.playerState?.cafeName,
        );
        this.actionBarMood.view.position.set(left, top);
        this.actionBarLayer.addChild(this.actionBarMood.view);
      }
      options.actionBarIcons?.forEach(({ name, texture }, index) => {
        const isTrophy = name === 'trophy';
        const isMail = name === 'mail';
        const holder = new Container();
        const icon = new Sprite(texture);
        holder.label = `room-action-bar-icon-${name}`;
        icon.anchor.set(0.5);
        const baseScale = 68 * scale * (isTrophy ? 1.1 : 1) / texture.height;
        icon.scale.set(baseScale);
        icon.eventMode = 'none';
        if (!isTrophy) {
          const shadow = new Graphics();
          const shadowRadius = Math.max(19 * growth, icon.width * 0.4);
          const shadowY = icon.height / 2 - 4 * growth;
          shadow.ellipse(0, shadowY, shadowRadius + 8 * growth, 6 * growth)
            .fill({ color: 0x17202a, alpha: 0.12 });
          shadow.ellipse(0, shadowY, shadowRadius, 4 * growth)
            .fill({ color: 0x17202a, alpha: 0.19 });
          shadow.eventMode = 'none';
          holder.addChild(shadow);
        }
        holder.addChild(icon);
        holder.position.set(
          left + (isTrophy ? 470 : isMail ? 1300 : 552 + (index - 1) * 86) * scale,
          top + (isTrophy ? 710 : 730) * scale,
        );
        holder.hitArea = new Rectangle(
          -icon.width / 2, -icon.height / 2 - 4 * growth,
          icon.width, icon.height + 14 * growth,
        );
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        if (isTrophy) {
          holder.on('pointerover', () => { icon.scale.set(baseScale * 1.1); });
          holder.on('pointerout', () => { icon.scale.set(baseScale); });
        } else {
          const hover = { sprite: icon, targetY: 0 };
          holder.on('pointerover', () => { hover.targetY = -6 * growth; });
          holder.on('pointerout', () => { hover.targetY = 0; });
          this.actionIconHovers.push(hover);
        }
        holder.on('pointerdown', (event) => { event.stopPropagation(); });
        holder.on('pointertap', (event) => {
          event.stopPropagation();
          if (name === 'shirt') this.openWardrobeScreen();
          if (name === 'house') this.openStoreBar();
        });
        this.actionBarLayer.addChild(holder);
      });

      if (options.actionBarButtons) {
        const buttons = options.actionBarButtons;
        // Coordenadas na imagem original: abaixo da divisória e fora dos quadrados.
        const placements = [
          { name: 'left-arrow', texture: buttons.leftArrow, x: 289, y: 816 },
          { name: 'left-edge-arrow', texture: buttons.leftEdgeArrow, x: 289, y: 888 },
          { name: 'right-arrow', texture: buttons.rightArrow, x: 1395, y: 816 },
          { name: 'right-edge-arrow', texture: buttons.rightEdgeArrow, x: 1395, y: 888 },
          { name: 'settings', texture: buttons.settings, x: 1380, y: 730 },
        ];
        for (const placement of placements) {
          const button = new Sprite(placement.texture);
          const baseScale = 62 * 0.95 * (placement.name === 'settings' ? 1.15 : 1) * scale
            / placement.texture.height;
          let hovered = false;
          let pressed = false;
          const syncFeedback = () => {
            button.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
            button.tint = pressed ? 0xd7ebff : 0xffffff;
          };
          button.label = `room-action-bar-${placement.name}`;
          button.anchor.set(0.5);
          button.scale.set(baseScale);
          button.position.set(left + placement.x * scale, top + placement.y * scale);
          button.eventMode = 'static';
          button.cursor = 'pointer';
          button.on('pointerover', () => { hovered = true; syncFeedback(); });
          button.on('pointerout', () => { hovered = false; pressed = false; syncFeedback(); });
          button.on('pointerdown', (event) => {
            event.stopPropagation();
            pressed = true;
            syncFeedback();
          });
          button.on('pointerup', (event) => {
            event.stopPropagation();
            pressed = false;
            syncFeedback();
          });
          button.on('pointerupoutside', () => { pressed = false; syncFeedback(); });
          button.on('pointertap', (event) => {
            event.stopPropagation();
            if (placement.name === 'settings') this.openSettings();
          });
          this.actionBarLayer.addChild(button);
        }
      }
    }

    if (options.storeBarTexture && options.actionBarTexture) {
      if (options.roomClient && options.roomSnapshot && this.artProvider) {
        this.roomStore = new RoomStoreController({ snapshot: options.roomSnapshot, client: options.roomClient,
          model: this.model, world: this.world, art: this.artProvider,
          apply: (snapshot) => this.applyRoomSnapshot(snapshot),
          alpha: (id, alpha) => this.setUnitAlpha(id, alpha),
          isOverUI: (event) => {
            if (this.storeBar?.containsGlobalPoint(event.global) || this.topBars?.containsGlobalPoint(event.global)) return true;
            return [this.hud, this.connectionHint].some((layer) => {
              if (!layer?.visible || !layer.renderable) return false;
              const bounds = layer.getBounds();
              return event.global.x >= bounds.x && event.global.y >= bounds.y
                && event.global.x <= bounds.x + bounds.width && event.global.y <= bounds.y + bounds.height;
            });
          },
          canPlace: (item, tile, rotation, id) => {
            if (!this.realtime) return true;
            if (!this.realtime.connected) return false;
            for (const state of this.realtime.actors.values()) if (id && (state.chairId === id || state.tableId === id)) return false;
            if (item.type < 2 || item.kind === 'window' || item.kind === 'panel') return true;
            const sx = rotation % 2 ? item.sizeY : item.sizeX, sy = rotation % 2 ? item.sizeX : item.sizeY;
            return ![...this.realtime.actors.values()].some((state) => [state, ...(state.move ? [state.move.from, state.move.to] : [])].some((position) => position.tx >= tile.tx && position.ty >= tile.ty && position.tx < tile.tx + sx && position.ty < tile.ty + sy));
          },
        });
      }
      this.storeBar = new StoreActionBar(
        options.storeBarTexture, options.actionBarTexture, options.actionBarButtons,
        options.actionBarButtons?.confirm,
        (open) => {
          this.actionBarLayer.visible = !open;
          this.playerView.view.renderable = !open;
          this.wanderers.forEach(({ view }) => { view.view.renderable = !open; });
          this.outsideNpcManager?.setRenderingEnabled(!open);
          this.liveActors.forEach(({ view }) => { view.view.renderable = !open; });
          this.mealViews.forEach((view) => { view.renderable = !open; });
          this.liveEmotions.forEach(({ effect }) => { effect.view.renderable = !open; });
          this.sharedCookingViews.forEach((view) => { view.renderable = !open; });
          this.sharedCookingProgress.forEach(({ bar }) => { bar.view.renderable = !open; });
          if (open) this.roomStore?.onOpen(); else this.roomStore?.onClose();
        },
        () => this.openSettings(),
        options.storeBarIcons,
        this.roomStore ? {
          onSelect: (entry) => this.roomStore!.select(entry),
          onCategory: () => this.roomStore!.onCategory(),
          onInventoryToggle: () => this.roomStore!.toggleInventory(),
          onDragStart: (entry, event) => {
            if (this.roomStore!.beginEntryDrag(entry, event)) { this.drag = null; this.dragCancelledTap = true; }
          },
          onDragEnd: (event) => this.onDragEnd(event),
        } : undefined,
        options.storeTopButtonTexture,
        options.actionBarIcons?.find(({ name }) => name === 'house')?.texture,
        options.storeToolbarTextures,
      );
      this.roomStore?.attach(this.storeBar);
      this.view.addChild(this.storeBar.view);
      if (this.roomStore) this.view.addChild(this.roomStore.cursorView);
    }

    if (options.cookTextures) {
      if (options.cookTextures.progressCallout) {
        this.cookCallout = new CookProgressCallout(options.cookTextures.progressCallout, options.cookTextures.calloutClock);
        this.cookCallout.view.scale.set(0.6);
        this.cookCallout.view.zIndex = POPUP_DRAW_PRIORITY + 2;
        this.world.addChild(this.cookCallout.view);
      }
      this.cookModal = new CookScreenModal({
        textures: options.cookTextures,
        onCookRecipe: (recipe) => this.startCooking(recipe),
      });
      this.view.addChild(this.cookModal.view);
    }
    if (options.wardrobeTextures) {
      const coveredLayers = [this.backdrop, this.cameraLayer, this.actionBarLayer];
      if (this.topBars) coveredLayers.push(this.topBars.view);
      let coveredVisibility: boolean[] | null = null;
      this.wardrobeModal = new WardrobeScreenModal({
        ...options.wardrobeTextures,
        ...(options.cookTextures?.closeButton ? { closeButton: options.cookTextures.closeButton } : {}),
        ...(options.actionBarButtons ? { pageButtons: options.actionBarButtons } : {}),
      }, (open) => {
        // A tela é opaca: a simulação continua, mas não desenhamos o quarto coberto.
        if (open) {
          coveredVisibility = coveredLayers.map((layer) => layer.visible);
          coveredLayers.forEach((layer) => { layer.visible = false; });
        } else if (coveredVisibility) {
          coveredLayers.forEach((layer, index) => { layer.visible = coveredVisibility![index]; });
          coveredVisibility = null;
        }
        options.onWardrobeVisibilityChange?.(open);
      }, {
        appearance: this.playerAppearance,
        onConfirm: async (look) => {
          const state = await saveAppearance(look);
          if (!this.destroyed) this.setPlayerState(state);
          return state.appearance ?? '';
        },
      });
      this.view.addChild(this.wardrobeModal.view);

      if (this.hud) this.view.addChild(this.hud);
    }
    this.settingsModal = new SettingsModal({
      ...options.settings,
      getBitterMode: () => this.camera.bitterMode,
      onBitterModeChange: (enabled) => {
        this.camera.setBitterMode(enabled);
        this.applyCamera();
        this.updateHud();
        options.settings?.onBitterModeChange?.(enabled);
      },
    });
    this.view.addChild(this.settingsModal.view);
    this.updateMobileHudLayout();
    if (options.cookingSnapshot) this.acceptCookingSnapshot(options.cookingSnapshot, true);
    if (this.realtime) {
      this.connectionHint = new Text({ text: 'Conectando ao quarto…', style: new TextStyle({ fontFamily: FONT_FAMILY, fontSize: 23, fill: 0xffffff, stroke: { color: 0x25304a, width: 4 } }) });
      this.connectionHint.position.set(25, STAGE_HEIGHT - 50); this.view.addChild(this.connectionHint);
      this.realtime.onStatus((connected) => {
        if (this.connectionHint) { this.connectionHint.visible = !connected; this.connectionHint.text = 'Conexão interrompida. Reconectando…'; }
      });
      this.realtime.onEvent((event) => this.acceptRoomEvent(event));
      void this.realtime.connect();
    }
  }

  private acceptRoomEvent(event: RoomEvent): void {
    if (this.destroyed || !this.realtime) return;
    if (event.type === 'welcome') {
      for (const [id, entry] of this.liveActors) if (id !== event.selfId) this.removeLiveActor(id, entry);
      this.liveActors.clear();
      if (event.world) this.acceptSharedWorld(event.world);
    }
    for (const update of event.actors ?? []) {
      const state = this.realtime.actors.get(update.id); if (!state) continue;
      let entry = this.liveActors.get(state.id);
      const previousAction = entry?.state.action;
      if (!entry) {
        const own = state.id === this.realtime.selfId;
        const actor = own ? this.player : new Actor(state.id);
        actor.setTilePosition(state.tx, state.ty);
        const view = own ? this.playerView : this.createPlaceholderView(actor);
        if (!own) this.world.addChild(view.view);
        entry = { actor, view, state, appearanceRevision: 0 }; this.liveActors.set(state.id, entry);
        if (!own) void this.refreshLiveAppearance(state.id, state.appearance ?? '');
      } else {
        const changed = entry.state.appearance !== state.appearance; entry.state = state;
        if (changed && state.id !== this.realtime.selfId) void this.refreshLiveAppearance(state.id, state.appearance ?? '');
      }
      entry.state = state;
      entry.view.view.renderable = !this.storeBar?.isOpen;
      if (event.type !== 'welcome' && state.action?.kind === 'cooking' &&
          previousAction?.startedAt !== state.action.startedAt &&
          this.realtime.serverNowMs() < state.action.startedAt + state.action.duration) {
        playRandomSfx([SFX_START_COOKING_URL]);
      }
    }
    for (const id of event.removed ?? []) { const entry = this.liveActors.get(id); if (entry) { this.removeLiveActor(id, entry); this.liveActors.delete(id); } }
    if (event.type === 'world' && this.roomSnapshot && event.revision !== undefined && event.revision >= this.roomSnapshot.revision) {
      const units = new Map(this.roomSnapshot.inventory.map((unit) => [unit.unitId, unit]));
      for (const unit of event.units ?? []) {
        if (this.roomSnapshot.canEdit !== false || unit.placed) units.set(unit.unitId, unit); else units.delete(unit.unitId);
      }
      if ((event.units?.length ?? 0) > 0) this.applyRoomSnapshot({ ...this.roomSnapshot, revision: event.revision, inventory: [...units.values()] }, false);
    }
    if (event.cooking) this.acceptSharedCooking(event.cooking);
    if (event.type === 'error') {
      this.target.clear();
      if (this.connectionHint) { clearTimeout(this.noticeTimer); this.connectionHint.text = event.message ?? 'Ação recusada.'; this.connectionHint.visible = true;
        this.noticeTimer = setTimeout(() => { if (this.connectionHint && this.realtime?.connected) this.connectionHint.visible = false; }, 3000);
      }
    }
  }

  private acceptSharedWorld(world: SharedWorld): void {
    if (!this.roomSnapshot) return;
    const units = new Map(this.roomSnapshot.inventory.map((unit) => [unit.unitId, { ...unit, placed: false }]));
    for (const unit of world.units) units.set(unit.unitId, unit);
    this.applyRoomSnapshot({ ...this.roomSnapshot, revision: world.revision, inventory: [...units.values()].filter((unit) => this.roomSnapshot!.canEdit !== false || unit.placed) }, false);
    if (world.cooking) this.acceptSharedCooking(world.cooking);
  }

  private acceptSharedCooking(snapshot: CookingSnapshot): void {
    this.cookingClient?.accept(snapshot);
    const current = this.cookingProcess;
    if (current && !snapshot.stoves.some((stove) => stove.id === current.stove.instanceId && stove.cooking?.id === this.occupiedStoves.get(stove.id)?.id)) this.clearCookingProcess();
    // Shared dishes are drawn for every stove; only local input controls the owner's modal.
    this.acceptCookingSnapshot(snapshot, false);
  }

  private removeLiveActor(id: string, entry: { actor: Actor; view: ActorRenderer; bundle?: BakedAvatarBundle; appearanceRevision: number; appearanceController?: AbortController }): void {
    entry.appearanceRevision++;
    entry.appearanceController?.abort();
    if (entry.actor !== this.player) { entry.view.destroy(); if (entry.bundle) releaseNpcAvatar(entry.bundle); }
    this.mealViews.get(id)?.destroy(); this.mealViews.delete(id);
    this.liveEmotions.get(id)?.effect.destroy(); this.liveEmotions.delete(id);
  }

  private async refreshLiveAppearance(id: string, appearance: string): Promise<void> {
    const entry = this.liveActors.get(id); if (!entry || !this.npcAvatarSource?.bakeAppearance) return;
    const revision = ++entry.appearanceRevision;
    entry.appearanceController?.abort();
    const controller = new AbortController(); entry.appearanceController = controller;
    try {
      const bundle = await this.npcAvatarSource.bakeAppearance(appearance, entry.state.kind === 'human', controller.signal);
      if (this.destroyed || this.liveActors.get(id) !== entry || entry.appearanceRevision !== revision) { releaseNpcAvatar(bundle); return; }
      if (entry.view instanceof AvatarActorView) {
        entry.view.setAppearance(bundle.baked, bundle.texture);
      } else {
        const renderer = new AvatarActorView(entry.actor, bundle.baked, bundle.texture);
        renderer.view.renderable = !this.storeBar?.isOpen;
        entry.view.destroy(); entry.view = renderer; this.world.addChild(renderer.view);
      }
      if (entry.bundle) releaseNpcAvatar(entry.bundle);
      entry.bundle = bundle;
    } catch (error) { if (!this.destroyed && !controller.signal.aborted) console.warn('[room] Não foi possível desenhar o visual do personagem.', error); }
  }

  private updateLiveActors(deltaMs: number): void {
    const now = this.realtime!.serverNowMs();
    for (const [id, entry] of this.liveActors) {
      const state = entry.state;
      if (this.realtime!.connected) entry.actor.syncAuthoritative(state.tx, state.ty, state.direction, state.outside, state.move, now);
      else { entry.actor.speedX = 0; entry.actor.speedY = 0; }
      if (state.state === 'entering' && entry.actor.tileX >= 1 && entry.actor.tileY >= 1) entry.actor.outside = false;
      const action = state.state === 'eating' ? CLIP.EAT : state.state === 'seated' ? CLIP.SIT :
        state.state === 'cooking' || state.state === 'serving' ? CLIP.COOKING : null;
      entry.view.setActionClip?.(action, state.action ? now - state.action.startedAt : undefined);
      this.advanceActorView(entry.view, deltaMs);
      this.updateLiveEmotion(id, state, entry.view.view, now);
      const table = state.tableId && this.model.items.find((item) => item.inventoryUnitId === state.tableId);
      if (state.food && table && this.cookProgressTextures?.cakeStage2) {
        let meal = this.mealViews.get(id);
        if (!meal) { meal = new Sprite(this.cookProgressTextures.cakeStage2); meal.label = 'meal:' + state.food.id; meal.anchor.set(.5, .72); meal.width = 64; meal.height = 64; this.mealViews.set(id, meal); this.world.addChild(meal); }
        meal.position.set(tileToScreenX(table.tx, table.ty), tileToScreenY(table.tx, table.ty) - 30);
        meal.zIndex = itemDepth(table.tx, table.ty) + 1; meal.renderable = !this.storeBar?.isOpen;
        setItemOverlayDepth(meal, table);
      } else { this.mealViews.get(id)?.destroy(); this.mealViews.delete(id); }
    }
    this.updateSharedStoves(now);
  }

  private updateLiveEmotion(id: string, state: SharedActor, actorView: Container, now: number): void {
    const emotion = state.emotion;
    let current = this.liveEmotions.get(id);
    if (!emotion || now >= emotion.startedAt + emotion.duration || current && current.id !== emotion.id) {
      current?.effect.destroy(); this.liveEmotions.delete(id); current = undefined;
    }
    if (!emotion || now >= emotion.startedAt + emotion.duration) return;
    const frames = this.npcEmotionTextures?.[emotion.kind];
    if (!current && frames?.length) {
      const effect = new NpcEmotion(frames);
      current = { id: emotion.id, effect }; this.liveEmotions.set(id, current); this.world.addChild(effect.view);
    }
    if (current) {
      current.effect.seek(now - emotion.startedAt, actorView);
      current.effect.view.renderable = !this.storeBar?.isOpen;
    }
  }

  private updateSharedStoves(now: number): void {
    const stoveIds = new Set<string>();
    if (this.cookingProcess?.progress) this.cookingProcess.progress.view.renderable = !this.storeBar?.isOpen;
    if (this.servingProcess?.progress) this.servingProcess.progress.view.renderable = !this.storeBar?.isOpen;
    const servingByStove = new Map([...this.liveActors.values()].flatMap(({ state }) =>
      state.action?.kind === 'serving' && state.action.stoveId && now < state.action.startedAt + state.action.duration
        ? [[state.action.stoveId, state.action] as const] : []));
    for (const stove of this.model.items) {
      if (stove.kind !== 'stove' || !stove.instanceId) continue;
      stoveIds.add(stove.instanceId);
      const job = this.occupiedStoves.get(stove.instanceId);
      const preparing = cookingTime(job?.preparingAt ?? job?.startedAt ?? '');
      const start = cookingTime(job?.startedAt ?? '');
      const serving = servingByStove.get(stove.instanceId);
      const mode = serving ? 'serving' : job && now < start ? 'cooking' : undefined;
      const elapsed = serving ? now - serving.startedAt : now - preparing;
      const duration = serving?.duration ?? start - preparing;
      const pending = this.pendingCook?.stove === stove || this.servingProcess?.stove === stove && this.servingProcess.phase === 'walking';
      this.stoveViews.get(stove)?.forEach((view) => { view.alpha = mode || pending ? TARGET_STOVE_ALPHA : 1; });
      const localProgress = this.servingProcess?.stove === stove && this.servingProcess.progress?.view.visible ||
        this.cookingProcess?.stove === stove && this.cookingProcess.progress?.view.visible;
      let progress = this.sharedCookingProgress.get(stove.instanceId);
      if (!mode || localProgress || !job) {
        progress?.bar.destroy(); this.sharedCookingProgress.delete(stove.instanceId);
      } else {
        if (progress?.mode !== mode) {
          progress?.bar.destroy(); this.sharedCookingProgress.delete(stove.instanceId);
          const bar = this.makeStoveProgress(stove, mode);
          if (bar) { progress = { mode, bar }; this.sharedCookingProgress.set(stove.instanceId, progress); }
        }
        if (progress) { progress.bar.setProgress(elapsed / Math.max(1, duration)); progress.bar.view.renderable = !this.storeBar?.isOpen; }
      }
      const texture = now >= cookingTime(job?.readyAt ?? '') ? this.cookProgressTextures?.cakeStage2 : this.cookProgressTextures?.cakeStage1;
      if (!job || !texture || this.cookingProcess?.stove === stove) { this.sharedCookingViews.get(stove.instanceId)?.destroy(); this.sharedCookingViews.delete(stove.instanceId); continue; }
      let view = this.sharedCookingViews.get(stove.instanceId);
      if (!view) { view = new Sprite(texture); view.anchor.set(.5, .72); view.width = 92; view.height = 92; view.label = 'shared-stove:' + stove.instanceId; this.sharedCookingViews.set(stove.instanceId, view); this.world.addChild(view); }
      view.texture = texture; view.alpha = mode === 'serving' ? TARGET_STOVE_ALPHA : 1;
      view.renderable = !this.storeBar?.isOpen;
      view.position.set(tileToScreenX(stove.tx, stove.ty), tileToScreenY(stove.tx, stove.ty) - 11); view.zIndex = itemDepth(stove.tx, stove.ty) + 1;
      setItemOverlayDepth(view, stove);
    }
    for (const [id, view] of this.sharedCookingViews) if (!stoveIds.has(id)) { view.destroy(); this.sharedCookingViews.delete(id); }
    for (const [id, { bar }] of this.sharedCookingProgress) if (!stoveIds.has(id)) { bar.destroy(); this.sharedCookingProgress.delete(id); }
  }

  private movePlayerAlong(path: readonly Tile[]): void {
    if (!this.realtime) { this.player.setMovePath(path); return; }
    const destination = path.at(-1); if (!destination) return;
    this.networkPending++;
    void this.realtime.command('walk', destination).catch((error: unknown) => {
      console.info('[room]', error); this.pendingCook = undefined; this.startingCook = false;
      if (this.servingProcess?.phase === 'walking') this.clearServingProcess();
    }).finally(() => { this.networkPending--; });
  }

  /** Inicia o processo de cozimento de uma receita no fogão da sala. */
  startCooking(recipe: CookRecipeEvent): void {
    if (this.roomSnapshot?.canEdit === false || this.realtime && !this.realtime.connected) return;
    const stove = this.selectedStove ?? this.model.items.find((item) => item.kind === 'stove');
    if (!stove) return;
    if (this.startingCook || this.cancellingCook || this.servingProcess || this.cookingProcess?.stove === stove || (stove.instanceId && this.occupiedStoves.has(stove.instanceId))) return;
    const approach = this.findCookingApproach(stove);
    if (!approach) return;

    if (this.cookingClient) {
      if (!stove.instanceId) return;
      this.startingCook = true;
      this.pendingCook = { stove, recipe };
      this.stoveViews.get(stove)?.forEach((view) => { view.alpha = TARGET_STOVE_ALPHA; });
      if (approach.path.length > 0) {
        this.movePlayerAlong(approach.path);
        this.drawTarget(approach.destination);
      } else {
        this.beginServerPlacement();
      }
      return;
    }
    // Isolated room tests can still exercise the renderer without an HTTP server.
    this.showCooking(recipe, stove, undefined, false, approach);
  }

  private beginServerPlacement(): void {
    const pending = this.pendingCook;
    if (!pending || !this.cookingClient || !pending.stove.instanceId) return;
    this.pendingCook = undefined;
    this.target.clear();
    void this.cookingClient.start(pending.stove.instanceId, pending.recipe.id).then((snapshot) => {
        this.startingCook = false;
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        const job = this.occupiedStoves.get(pending.stove.instanceId!);
        if (job) this.showCooking(pending.recipe, pending.stove, job);
        else this.stoveViews.get(pending.stove)?.forEach((view) => { view.alpha = 1; });
      }).catch((error: unknown) => {
        this.startingCook = false;
        this.stoveViews.get(pending.stove)?.forEach((view) => { view.alpha = 1; });
        console.warn('[cooking] preparo rejeitado', error);
        void this.cookingClient!.refresh().then((snapshot) => {
          if (!this.destroyed) this.acceptCookingSnapshot(snapshot, true);
        }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogões', refreshError));
      });
  }

  /** Aplica um snapshot autenticado; ao reentrar, reconstitui o prato sem repetir som/caminhada. */
  private acceptCookingSnapshot(snapshot: CookingSnapshot, restore: boolean): void {
    this.occupiedStoves.clear();
    for (const stove of snapshot.stoves) {
      if (stove.cooking) this.occupiedStoves.set(stove.id, stove.cooking);
    }
    if (!restore || this.cookingProcess) return;
    const textures = this.cookProgressTextures;
    if (!textures?.cakeStage1 || !textures.cakeStage2) return;
    for (const stove of this.model.items) {
      if (stove.kind !== 'stove' || !stove.instanceId) continue;
      const job = this.occupiedStoves.get(stove.instanceId);
      if (!job || job.recipeId !== 'cake_1') continue;
      this.showCooking({ id: 'cake_1', name: 'bolo beta', stage1: textures.cakeStage1, stage2: textures.cakeStage2 }, stove, job, true);
      break;
    }
  }

  private showCooking(
    recipe: CookRecipeEvent,
    stove: RoomItem,
    job?: StoveCooking,
    restore = false,
    approach?: { destination: Tile; path: Tile[] },
  ): void {
    const parsedPrepare = job ? cookingTime(job.preparingAt ?? job.startedAt) : NaN;
    const parsedStart = job ? cookingTime(job.startedAt) : NaN;
    const parsedReady = job ? cookingTime(job.readyAt) : NaN;
    const preparingAtMs = Number.isFinite(parsedPrepare) ? parsedPrepare : undefined;
    const startedAtMs = Number.isFinite(parsedStart) ? parsedStart : undefined;
    const readyAtMs = Number.isFinite(parsedReady) ? parsedReady : undefined;
    const nowMs = this.cookingClient?.serverNowMs() ?? 0;
    const ready = readyAtMs !== undefined && nowMs >= readyAtMs;
    const cooking = !ready && startedAtMs !== undefined && nowMs >= startedAtMs;
    const phase = ready ? 'ready' : cooking ? 'cooking' : restore ? 'preparing'
      : approach?.path.length ? 'walking' : 'preparing';
    const durationMs = cooking && readyAtMs !== undefined && startedAtMs !== undefined
      ? Math.max(1, readyAtMs - startedAtMs)
      : preparingAtMs !== undefined && startedAtMs !== undefined
        ? Math.max(1, startedAtMs - preparingAtMs) : LOCAL_COOKING_PREVIEW_MS;
    const elapsedMs = phase === 'cooking' && startedAtMs !== undefined
      ? Math.max(0, Math.min(durationMs, nowMs - startedAtMs))
      : phase === 'preparing' && preparingAtMs !== undefined
        ? Math.max(0, Math.min(durationMs, nowMs - preparingAtMs)) : 0;

    this.clearCookingProcess();
    this.selectedStove = stove;
    this.stoveViews.get(stove)?.forEach((view) => { view.alpha = phase === 'walking' || phase === 'preparing' ? TARGET_STOVE_ALPHA : 1; });

    const sx = tileToScreenX(stove.tx, stove.ty);
    const sy = tileToScreenY(stove.tx, stove.ty);

    // pink_stove.png: queimador em (80, 36), com offsets da arte (-80, -47).
    const burnerX = sx;
    const burnerY = sy - 11;

    const sprite = new Sprite(ready ? recipe.stage2 : recipe.stage1);
    sprite.label = `stove-cooking-${recipe.id}`;
    sprite.anchor.set(0.5, 0.72);
    sprite.width = 92;
    sprite.height = 92;
    sprite.position.set(burnerX, burnerY);
    sprite.zIndex = itemDepth(stove.tx, stove.ty, DEPTH_BIAS_ITEM) + 1;
    setItemOverlayDepth(sprite, stove);
    sprite.visible = restore || phase === 'cooking' || phase === 'ready';
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    this.bindStoveHover(sprite, stove);
    sprite.on('pointertap', (e) => {
      if (this.dragCancelledTap) return;
      e.stopPropagation();
      this.openCookScreen(stove);
    });

    this.world.addChild(sprite);

    const progress = this.makeStoveProgress(stove, 'cooking');
    if (progress) {
      progress.view.visible = restore && phase === 'preparing';
      if (restore && phase === 'preparing') progress.setProgress(elapsedMs / durationMs);
    }

    this.cookingProcess = {
      stove,
      recipeId: recipe.id,
      recipeName: recipe.name,
      stage: ready ? 2 : 1,
      phase,
      stage1Texture: recipe.stage1,
      stage2Texture: recipe.stage2,
      elapsedMs,
      durationMs,
      preparingAtMs,
      startedAtMs,
      readyAtMs,
      placementActive: !restore,
      view: sprite,
      progress,
    };
    if (restore || phase === 'cooking' || phase === 'ready') return;
    if (approach && approach.path.length > 0) {
      this.movePlayerAlong(approach.path);
      this.drawTarget(approach.destination);
    } else {
      this.beginPreparing();
    }
  }

  private makeStoveProgress(stove: RoomItem, mode: 'cooking' | 'serving'): CookProgressBar | undefined {
    const textures = this.cookProgressTextures;
    if (!textures?.progressBack || !textures.progressFront) return undefined;
    const progress = new CookProgressBar(textures.progressBack, textures.progressFront, mode);
    const stoveWidth = Math.max(160, ...((this.stoveViews.get(stove) ?? []).map((view) => view.width)));
    progress.view.scale.set(((stoveWidth + 20) / 456) * COOKING_PROGRESS_SCALE);
    progress.view.position.set(tileToScreenX(stove.tx, stove.ty), tileToScreenY(stove.tx, stove.ty) - 95);
    progress.view.zIndex = POPUP_DRAW_PRIORITY;
    this.world.addChild(progress.view);
    return progress;
  }

  private updateCookingCallout(): void {
    const callout = this.cookCallout;
    if (!callout) return;
    const stove = this.hoveredStove;
    if (!stove || this.isModalOpen || this.storeBar?.isOpen || this.stoveActions || this.drag ||
        this.servingProcess?.stove === stove) {
      callout.view.visible = false;
      return;
    }
    const process = this.cookingProcess?.stove === stove ? this.cookingProcess : undefined;
    const job = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
    let progress: number;
    let remainingMs: number;
    if (job && this.cookingClient) {
      const start = cookingTime(job.startedAt);
      const end = cookingTime(job.readyAt);
      const now = this.cookingClient.serverNowMs();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start || now >= end) {
        callout.view.visible = false;
        return;
      }
      progress = (now - start) / (end - start);
      remainingMs = end - now;
    } else if (process?.phase === 'cooking') {
      progress = process.elapsedMs / process.durationMs;
      remainingMs = process.durationMs - process.elapsedMs;
    } else {
      callout.view.visible = false;
      return;
    }
    const readyDish = process?.stage2Texture ?? (job?.recipeId === 'cake_1' ? this.cookProgressTextures?.cakeStage2 : undefined);
    if (!readyDish) {
      callout.view.visible = false;
      return;
    }
    callout.setRecipe(process?.recipeName ?? 'bolo beta', readyDish);
    callout.setProgress(progress);
    callout.setRemaining(remainingMs);
    const stoveSprite = this.stoveViews.get(stove)?.find((view): view is Sprite => view instanceof Sprite);
    callout.view.position.set(
      Math.round(stoveSprite ? stoveSprite.x + stoveSprite.width / 2 : tileToScreenX(stove.tx, stove.ty)),
      Math.round(stoveSprite ? stoveSprite.y + 6 : tileToScreenY(stove.tx, stove.ty) - 41),
    );
    callout.view.visible = true;
  }

  /** Escolhe um lado alcançável da pegada, priorizando a face cardinal do fogão. */
  private findCookingApproach(stove: RoomItem): { destination: Tile; path: Tile[] } | null {
    const candidates: Array<{ destination: Tile; path: Tile[]; diagonal: boolean }> = [];
    for (const tile of footprintTiles(stove)) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const destination = { tx: tile.tx + dx, ty: tile.ty + dy };
        if (!this.model.isWalkable(destination.tx, destination.ty)) continue;
        const route = findPath({
          start: { tx: this.player.tileX, ty: this.player.tileY },
          dest: destination,
          isWalkable: this.model.isWalkable,
          maxTilesX: this.model.tilesX,
          maxTilesY: this.model.tilesY,
        });
        // O hitbox pode já estar neste tile na metade do passo, enquanto a arte
        // ainda chega nele. A ação só começa quando o movimento visual termina.
        const path = route && route.length === 0 && this.player.moving ? [destination] : route;
        if (path) candidates.push({ destination, path, diagonal: dx !== 0 && dy !== 0 });
      }
    }
    candidates.sort((a, b) => Number(a.diagonal) - Number(b.diagonal) || a.path.length - b.path.length);
    return candidates[0] ?? null;
  }

  private beginPreparing(): void {
    const process = this.cookingProcess;
    if (!process || process.phase === 'ready' || process.phase === 'cooking' || process.view.visible) return;
    if (process.preparingAtMs !== undefined && this.cookingClient) {
      process.elapsedMs = Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.preparingAtMs));
      if (process.elapsedMs >= process.durationMs) {
        process.view.visible = true;
        this.finishPlacement();
        return;
      }
    }
    process.phase = 'preparing';
    process.view.visible = true;
    if (process.progress) {
      process.progress.view.visible = true;
      process.progress.setProgress(process.elapsedMs / process.durationMs);
      if (!this.realtime) playRandomSfx([SFX_START_COOKING_URL]);
    }
    this.target.clear();
    const deltaX = tileToScreenX(process.stove.tx, process.stove.ty) - this.player.x;
    const deltaY = tileToScreenY(process.stove.tx, process.stove.ty) - this.player.y;
    const facing = directionFromDelta(deltaX, deltaY);
    // O clipe COOKING tem apenas as quatro vistas diagonais.
    if (!this.realtime) {
      this.player.direction = facing % 2 === 1 ? facing : (facing + (deltaY < 0 ? 1 : 7)) % 8;
      this.playerView.setActionClip?.(CLIP.COOKING);
    }
  }

  private finishPlacement(): void {
    const process = this.cookingProcess;
    if (!process || process.phase === 'cooking' || process.phase === 'ready') return;
    process.phase = 'cooking';
    process.elapsedMs = 0;
    process.durationMs = process.startedAtMs !== undefined && process.readyAtMs !== undefined
      ? Math.max(1, process.readyAtMs - process.startedAtMs) : LOCAL_COOKING_DURATION_MS;
    process.progress?.setProgress(1);
    if (process.progress) process.progress.view.visible = false;
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (process.placementActive) this.playerView.setActionClip?.(null);
    process.placementActive = false;
    this.target.clear();
  }

  private finishCooking(): void {
    const process = this.cookingProcess;
    if (!process) return;
    process.phase = 'ready';
    process.stage = 2;
    process.elapsedMs = process.durationMs;
    process.view.texture = process.stage2Texture;
    process.progress?.setProgress(1);
    if (process.progress) process.progress.view.visible = false;
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (process.placementActive) this.playerView.setActionClip?.(null);
    process.placementActive = false;
  }

  private clearCookingProcess(): void {
    const process = this.cookingProcess;
    if (!process) return;
    this.playerView.setActionClip?.(null);
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    process.view.destroy();
    process.progress?.destroy();
    this.cookingProcess = undefined;
  }

  private closeStoveActions(): void {
    this.stoveActions?.destroy();
    this.stoveActions = undefined;
    this.stoveActionsStove = undefined;
  }

  private showStoveActions(stove: RoomItem): void {
    if (this.stoveActionsStove === stove) {
      this.closeStoveActions();
      return;
    }
    this.closeStoveActions();
    const menu = new StoveActionMenu(() => {
      if (!this.cookingClient) return;
      void this.cookingClient.refresh().then((snapshot) => {
        if (!this.destroyed) this.acceptCookingSnapshot(snapshot, true);
      }).catch((error: unknown) => console.warn('[cooking] falha ao consultar tempo', error));
    }, () => this.cancelStoveCooking(stove));
    const stoveSprite = this.stoveViews.get(stove)?.find((view): view is Sprite => view instanceof Sprite);
    const stoveTopX = stoveSprite ? stoveSprite.x + stoveSprite.width / 2 : tileToScreenX(stove.tx, stove.ty);
    const stoveTopY = stoveSprite ? stoveSprite.y : tileToScreenY(stove.tx, stove.ty) - 47;
    // O primeiro botão é o de cima; a referência do ápice recebe uma pequena
    // correção vertical uniforme para qualquer arte de fogão.
    menu.view.position.set(Math.round(stoveTopX), Math.round(stoveTopY + STOVE_MENU_TOP_DROP));
    menu.view.zIndex = POPUP_DRAW_PRIORITY + 1;
    this.world.addChild(menu.view);
    this.stoveActions = menu;
    this.stoveActionsStove = stove;
    this.updateStoveActionTime();
  }

  private updateStoveActionTime(): void {
    const stove = this.stoveActionsStove;
    if (!stove || !this.stoveActions) return;
    const job = stove.instanceId ? this.occupiedStoves.get(stove.instanceId) : undefined;
    const process = this.cookingProcess?.stove === stove ? this.cookingProcess : undefined;
    const remaining = job && this.cookingClient
      ? cookingTime(job.readyAt) - this.cookingClient.serverNowMs()
      : process ? process.phase === 'ready' ? 0 : process.phase === 'cooking'
        ? process.durationMs - process.elapsedMs : LOCAL_COOKING_DURATION_MS : 0;
    this.stoveActions.setRemaining(remaining);
  }

  private cancelStoveCooking(stove: RoomItem): void {
    if (this.cancellingCook) return;
    this.closeStoveActions();
    if (!this.cookingClient || !stove.instanceId) {
      if (this.cookingProcess?.stove === stove && this.cookingProcess.phase !== 'ready') this.clearCookingProcess();
      return;
    }
    this.cancellingCook = true;
    void this.cookingClient.cancel(stove.instanceId).then((snapshot) => {
      this.cancellingCook = false;
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      if (this.cookingProcess?.stove === stove) this.clearCookingProcess();
    }).catch((error: unknown) => {
      this.cancellingCook = false;
      console.warn('[cooking] não foi possível cancelar', error);
      if (this.destroyed) return;
      void this.cookingClient!.refresh().then((snapshot) => {
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        if (!this.occupiedStoves.has(stove.instanceId!) && this.cookingProcess?.stove === stove) this.clearCookingProcess();
      }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogão', refreshError));
    });
  }

  private startServing(stove: RoomItem): void {
    if (this.servingProcess) return;
    const approach = this.findCookingApproach(stove);
    if (!approach) return;
    this.closeStoveActions();
    const progress = this.makeStoveProgress(stove, 'serving');
    if (progress) progress.view.visible = false;
    this.servingProcess = { stove, phase: 'walking', elapsedMs: 0, progress };
    this.stoveViews.get(stove)?.forEach((view) => { view.alpha = TARGET_STOVE_ALPHA; });
    if (this.cookingProcess?.stove === stove) this.cookingProcess.view.alpha = TARGET_STOVE_ALPHA;
    if (approach.path.length) {
      this.movePlayerAlong(approach.path);
      this.drawTarget(approach.destination);
    } else {
      this.beginServing();
    }
  }

  private beginServing(): void {
    const process = this.servingProcess;
    if (!process || process.phase !== 'walking') return;
    if (this.realtime) {
      if (!process.stove.instanceId) { this.clearServingProcess(); return; }
      process.phase = 'requesting';
      void this.realtime.command('serve_prepare', { stoveId: process.stove.instanceId }).then(() => {
        if (this.destroyed || this.servingProcess !== process) return;
        const action = this.realtime!.actors.get(this.realtime!.selfId)?.action;
        process.startedAtMs = action?.startedAt ?? this.realtime!.serverNowMs();
        process.durationMs = action?.duration ?? LOCAL_COOKING_PREVIEW_MS;
        this.showServingAnimation(process);
      }).catch((error: unknown) => {
        if (this.destroyed || this.servingProcess !== process) return;
        console.info('[cooking] Serviço recusado.', error); this.clearServingProcess();
      });
      return;
    }
    this.showServingAnimation(process);
  }

  private showServingAnimation(process: NonNullable<RoomScreen['servingProcess']>): void {
    process.phase = 'serving';
    process.progress?.setProgress(0);
    if (process.progress) process.progress.view.visible = true;
    this.target.clear();
    const dx = tileToScreenX(process.stove.tx, process.stove.ty) - this.player.x;
    const dy = tileToScreenY(process.stove.tx, process.stove.ty) - this.player.y;
    const facing = directionFromDelta(dx, dy);
    if (!this.realtime) {
      this.player.direction = facing % 2 === 1 ? facing : (facing + (dy < 0 ? 1 : 7)) % 8;
      this.playerView.setActionClip?.(CLIP.COOKING);
    }
  }

  private finishServing(): void {
    const process = this.servingProcess;
    if (!process || process.phase === 'finalizing') return;
    process.phase = 'finalizing';
    process.progress?.setProgress(1);
    if (!this.cookingClient) {
      this.clearServingProcess();
      this.clearCookingProcess();
      return;
    }
    if (!process.stove.instanceId) {
      console.warn('[cooking] fogão sem ID persistido; prato não removido');
      this.clearServingProcess();
      return;
    }
    void this.cookingClient.serve(process.stove.instanceId).then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, false);
      this.clearServingProcess();
      this.clearCookingProcess();
    }).catch((error: unknown) => {
      console.warn('[cooking] não foi possível servir', error);
      if (this.destroyed) return;
      this.clearServingProcess();
      void this.cookingClient!.refresh().then((snapshot) => {
        if (this.destroyed) return;
        this.acceptCookingSnapshot(snapshot, false);
        if (!this.occupiedStoves.has(process.stove.instanceId!) && this.cookingProcess?.stove === process.stove) {
          this.clearCookingProcess();
        }
      }).catch((refreshError: unknown) => console.warn('[cooking] falha ao atualizar fogão', refreshError));
    });
  }

  private clearServingProcess(): void {
    const process = this.servingProcess;
    if (!process) return;
    process.progress?.destroy();
    this.stoveViews.get(process.stove)?.forEach((view) => { view.alpha = 1; });
    if (this.cookingProcess?.stove === process.stove) this.cookingProcess.view.alpha = 1;
    this.playerView.setActionClip?.(null);
    this.servingProcess = undefined;
  }

  /** Abre a janela do Livro de Receitas do fogão. */
  openCookScreen(stove?: RoomItem): void {
    if (this.isModalOpen || this.storeBar?.isOpen) return;
    const requested = stove ?? this.selectedStove ?? this.model.items.find((item) => item.kind === 'stove');
    const selected = requested?.instanceId
      ? this.model.items.find((item) => item.kind === 'stove' && item.instanceId === requested.instanceId) ?? requested
      : requested;
    if (!selected || this.servingProcess || this.startingCook || this.cancellingCook) return;
    const process = this.cookingProcess?.stove === selected ? this.cookingProcess : undefined;
    const job = selected.instanceId ? this.occupiedStoves.get(selected.instanceId) : undefined;
    if (process || job) {
      const ready = process?.phase === 'ready' || (job && this.cookingClient && this.cookingClient.serverNowMs() >= cookingTime(job.readyAt));
      if (ready) {
        if (process && process.phase !== 'ready') this.finishCooking();
        this.startServing(selected);
      } else {
        this.showStoveActions(selected);
      }
      return;
    }
    if (!this.cookingClient) {
      this.selectedStove = selected;
      this.cookModal?.open();
      return;
    }
    if (!selected.instanceId || this.checkingCookScreen) return;
    this.checkingCookScreen = true;
    void this.cookingClient.refresh().then((snapshot) => {
      if (this.destroyed) return;
      this.acceptCookingSnapshot(snapshot, true);
      if (this.isModalOpen || this.storeBar?.isOpen) return;
      const currentJob = this.occupiedStoves.get(selected.instanceId!);
      if (currentJob) {
        if (this.cookingClient!.serverNowMs() >= cookingTime(currentJob.readyAt)) this.startServing(selected);
        else this.showStoveActions(selected);
        return;
      }
      this.selectedStove = selected;
      this.cookModal?.open();
    }).catch((error: unknown) => console.warn('[cooking] fogão indisponível', error))
      .finally(() => { this.checkingCookScreen = false; });
  }

  /** Fecha a janela do Livro de Receitas do fogão. */
  closeCookScreen(): void {
    this.cookModal?.close();
  }

  openWardrobeScreen(): void {
    if (!this.wardrobeModal || this.isModalOpen || this.storeBar?.isOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.floor.cursor = 'pointer';
    this.wardrobeModal.open();
  }

  closeWardrobeScreen(): void {
    this.wardrobeModal?.close();
  }

  openStoreBar(): void {
    if (this.roomSnapshot?.canEdit === false) return;
    if (!this.storeBar || this.isModalOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.target.clear();
    this.floor.cursor = 'pointer';
    this.storeBar.open();
  }

  closeStoreBar(): void { this.storeBar?.close(); }

  private bindStoreItem(view: Container, unitId: () => string | undefined): void {
    const existingTap = view.listenerCount('pointertap') > 0;
    view.eventMode = 'static'; view.cursor = 'pointer';
    view.on('pointerdown', (event) => {
      if (this.storeBar?.isOpen && (event.ctrlKey || event.shiftKey) && !event.altKey) {
        event.stopPropagation(); this.drag = null; this.dragCancelledTap = false; return;
      }
      if (this.storeBar?.isOpen && this.roomStore?.beginDrag(event, unitId())) {
        this.drag = null; this.dragCancelledTap = true; return;
      }
      if (this.storeBar?.isOpen || !existingTap) this.onDragStart(event);
    });
    view.on('pointerup', this.onDragEnd); view.on('pointerupoutside', this.onDragEnd);
    view.on('pointertap', (event) => {
      if (this.storeBar?.isOpen && !this.dragCancelledTap && this.roomStore?.interact(event, unitId())) return;
      if (this.storeBar?.isOpen) { event.stopPropagation(); this.onPointerTap(event); }
      else if (!existingTap) this.onPointerTap(event);
    });
    view.on('wheel', this.onWheel);
  }

  private setUnitAlpha(id: string, alpha: number): void {
    const floor = this.floorUnitViews.get(id); if (floor) floor.alpha = alpha;
    for (const [item, views] of this.itemViews) {
      if (item.inventoryUnitId === id) views.forEach((view) => { view.alpha = alpha; });
      else if (item.wallpaperUnitId === id) for (const view of views) for (const child of view.children) {
        if (child.label?.includes(':paper:')) child.alpha = alpha;
      }
    }
  }

  private applyRoomSnapshot(snapshot: RoomSnapshot, updatePlayerState = true): void {
    if (this.destroyed) return;
    if (this.roomSnapshot && snapshot.revision < this.roomSnapshot.revision) return;
    this.roomSnapshot = snapshot; if (updatePlayerState) this.setPlayerState(snapshot.playerState);
    const old = new Map(this.model.items.map((item) => [item.inventoryUnitId, item]));
    const items = roomModelItems(snapshot, this.artProvider?.art).map((item) => {
      const previous = old.get(item.inventoryUnitId);
      if (!previous) return item;
      previous.wallpaperClassName = item.wallpaperClassName; previous.wallpaperUnitId = item.wallpaperUnitId;
      return Object.assign(previous, item);
    });
    this.closeStoveActions();
    this.doorViews.splice(0).forEach((door) => door.destroy());
    for (const views of this.itemViews.values()) for (const view of views) if (!view.destroyed) view.destroy({ children: true });
    this.itemViews.clear(); this.stoveViews.clear(); this.floorUnitViews.clear();
    this.floorArt.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.model.replaceItems(items); this.buildFloor();
    for (const item of this.model.items) this.addItem(item);
    this.roomStore?.acceptShared(snapshot);
    if (!this.realtime) this.player.clearPath();
  }

  openSettings(): void {
    if (this.isModalOpen) return;
    this.drag = null;
    this.pinch = null;
    this.touchPoints.clear();
    this.hovered = null;
    this.highlight.clear();
    this.closeStoveActions();
    if (this.cookCallout) this.cookCallout.view.visible = false;
    this.settingsModal?.open();
  }

  private get isModalOpen(): boolean {
    return Boolean(this.cookModal?.isOpen || this.wardrobeModal?.isOpen || this.settingsModal?.isOpen);
  }

  /** Atores em cena, o jogador primeiro. Usado nos testes. */
  get actors(): Actor[] {
    if (this.realtime) return [this.player, ...[...this.liveActors.values()].filter((entry) => entry.actor !== this.player).map((entry) => entry.actor)];
    const outsideActors = this.outsideNpcManager ? this.outsideNpcManager.actors : [];
    return [this.player, ...this.wanderers.map((w) => w.actor), ...outsideActors];
  }

  get hoveredTile(): Tile | null {
    return this.hovered;
  }

  /**
   * Avatar definitivo quando disponível; atlas branco durante o carregamento.
   *
   * Index 0 is exclusively the player; NPCs draw from the randomized NPC pool.
   * Missing NPC atlases never reuse the player's personal appearance.
   */
  private createActorView(actor: Actor, index: number, bodyColor: number): ActorRenderer {
    let atlasIndex = 0;
    if (index !== 0) {
      const active = new Set(this.actors);
      for (const previous of this.npcAvatarIndices.keys()) {
        if (!active.has(previous)) this.npcAvatarIndices.delete(previous);
      }
      atlasIndex = this.npcLookPicker.pick(this.npcAvatarIndices.values());
      if (atlasIndex > 0) this.npcAvatarIndices.set(actor, atlasIndex);
    }
    const assado = this.avatars[atlasIndex];
    if (assado) return new AvatarActorView(actor, assado.baked, assado.texture);
    return this.createPlaceholderView(actor, bodyColor);
  }

  private createPlaceholderView(actor: Actor, bodyColor = 0xffffff): ActorRenderer {
    const atlas = this.placeholderAvatar;
    if (atlas) return new AvatarActorView(actor, atlas.baked, atlas.texture);
    return new ActorView(actor, { bodyColor });
  }

  private async prepareNpcView(): Promise<PreparedNpcView> {
    const bundle = await this.npcAvatarSource!.next();
    let ownedByView = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseNpcAvatar(bundle);
    };
    return {
      createView: (actor) => {
        const renderer = new AvatarActorView(actor, bundle.baked, bundle.texture);
        ownedByView = true;
        return {
          view: renderer.view,
          sync: () => renderer.sync(),
          update: (deltaMs) => renderer.update(deltaMs),
          destroy: () => { renderer.destroy(); release(); },
        };
      },
      destroy: () => { if (!ownedByView) release(); },
    };
  }

  private addItem(item: RoomItem): void {
    const previous = new Set(this.world.children);
    this.paintItem(item);
    const views = this.world.children.filter((view) => !previous.has(view));
    this.itemViews.set(item, views);
    if (this.roomSnapshot) for (const view of views) this.bindStoreItem(view, () => item.wallpaperUnitId ?? item.inventoryUnitId);
    if (this.realtime && item.kind === 'chair' && item.inventoryUnitId) for (const view of views) view.on('pointertap', (event: FederatedPointerEvent) => {
      if (this.storeBar?.isOpen || this.dragCancelledTap || this.isModalOpen) return;
      event.stopPropagation(); void this.realtime!.command('sit', { chairId: item.inventoryUnitId }).catch((error: unknown) => console.info('[room]', error));
    });
  }

  private paintItem(item: RoomItem): void {
    if (item.kind === 'wall') {
      const paper = this.artProvider?.art.get(item.wallpaperClassName);
      let wallpaper: WallWallpaper | undefined;
      if (paper) {
        // One canonical face for both walls: mirror the sprite, not the PNG asset.
        const frame = paper.frames[0];
        const texture = this.artProvider?.textureFor(frame.file);
        if (texture) wallpaper = { frame, texture, sourceRotation: paper.wallpaperRotation ?? 0 };
      }
      const door = this.model.items.find((candidate) => candidate.kind === 'door' &&
        doorOpeningTile(candidate).tx === item.tx && doorOpeningTile(candidate).ty === item.ty);
      const nextTile = item.rotation % 2 === 0
        ? { tx: item.tx, ty: item.ty + 1 }
        : { tx: item.tx + 1, ty: item.ty };
      const nextWall = this.model.items.some((candidate) => candidate.kind === 'wall' &&
        candidate.tx === nextTile.tx && candidate.ty === nextTile.ty);
      const nextIsDoorOpening = this.model.items.some((candidate) => candidate.kind === 'door' &&
        doorOpeningTile(candidate).tx === nextTile.tx && doorOpeningTile(candidate).ty === nextTile.ty);
      // A parede termina visualmente no vão, mesmo que a verga do próximo tile
      // continue: sua espessura sombreada precisa aparecer ao lado da porta.
      const showEnd = !nextWall || nextIsDoorOpening;
      this.world.addChild(createProceduralWallView(item, wallpaper, door ? door.doorLintelRatio ?? 0.1 : undefined, showEnd));
      return;
    }
    const entry = this.artProvider?.art.get(item.className);
    if (entry) {
      const rotated = rotatedArt(entry, item.rotation);
      const texture = this.artProvider?.textureFor(rotated.frame.file);
      if (texture) {
        if (item.kind === 'door') {
          const door = new DoorView(item, rotated.frame, texture, entry.door);
          this.doorViews.push(door);
          this.world.addChild(door.view);
          return;
        }
        let bias = DEPTH_BIAS_ITEM;
        if (item.kind === 'window' || item.kind === 'panel') {
          bias = DEPTH_BIAS_WALL_DECOR;
        }
        const sprite = createArtView(item, rotated.frame, texture, { bias, occlusionAnchor: item.occlusionAnchor });
        if (item.kind === 'stove') {
          this.stoveViews.set(item, [sprite]);
          this.bindStoveTap(sprite, item);
        }
        this.world.addChild(sprite);
        return;
      }
    }

    // Sem arte: um pedaço de caixa por tile da pegada, cada um com sua
    // própria profundidade.
    for (const graphics of createItemViews(item)) {
      if (item.kind === 'stove') {
        const views = this.stoveViews.get(item) ?? [];
        views.push(graphics);
        this.stoveViews.set(item, views);
        this.bindStoveTap(graphics, item);
      }
      this.world.addChild(graphics);
    }
  }

  /** O fogão participa do mesmo gesto do piso: um toque novo limpa arrastes antigos. */
  private bindStoveTap(target: Sprite | Graphics, stove: RoomItem): void {
    target.eventMode = 'static';
    target.cursor = 'pointer';
    this.bindStoveHover(target, stove);
    target.on('pointerdown', this.onDragStart);
    target.on('pointerup', this.onDragEnd);
    target.on('pointerupoutside', this.onDragEnd);
    target.on('pointertap', (event) => {
      if (this.roomSnapshot?.canEdit === false) return;
      if (this.dragCancelledTap) return;
      event.stopPropagation();
      this.openCookScreen(stove);
    });
  }

  private bindStoveHover(target: Sprite | Graphics, stove: RoomItem): void {
    target.on('pointerover', (event: FederatedPointerEvent) => {
      if (event.pointerType === 'touch') return;
      this.hoveredStove = stove;
      this.updateCookingCallout();
    });
    target.on('pointerout', () => {
      if (this.hoveredStove !== stove) return;
      this.hoveredStove = undefined;
      if (this.cookCallout) this.cookCallout.view.visible = false;
    });
  }

  /** Piso texturizado ou desenho procedural de fallback. */
  private buildFloor(): void {
    if (this.roomSnapshot) {
      drawFloor(this.floor, this.model); this.floor.alpha = 1;
      for (const unit of this.roomSnapshot.inventory) {
        const item = this.roomSnapshot.catalog.find((item) => item.id === unit.itemId);
        if (!unit.placed || item?.type !== 0) continue;
        const frame = this.artProvider?.art.get(item.classname)?.frames[0];
        const texture = frame ? this.artProvider?.textureFor(frame.file) : undefined;
        if (!frame || !texture) continue;
        const sprite = new Sprite(texture);
        sprite.label = `floor:${unit.tx},${unit.ty}`; sprite.roundPixels = true;
        sprite.position.set(tileToScreenX(unit.tx, unit.ty) + frame.left, tileToScreenY(unit.tx, unit.ty) + frame.top);
        sprite.hitArea = new Polygon(tileDiamond(0, 0).flatMap(({ x, y }) => [x - frame.left, y - frame.top]));
        rotateFloorSprite(sprite, frame, unit.rotation);
        this.floorArt.addChild(sprite); this.floorUnitViews.set(unit.unitId, sprite);
        this.bindStoreItem(sprite, () => unit.unitId);
      }
      return;
    }
    const entry = this.artProvider?.art.get(this.floorClassName);
    const texture = entry ? this.artProvider?.textureFor(entry.frames[0].file) : undefined;

    // O losango sempre existe: é ele que faz o hit test do clique. Com arte
    // real ele fica invisível, mas continua recebendo o ponteiro.
    drawFloor(this.floor, this.model);

    if (entry && texture) {
      this.floor.alpha = 0;
      for (const sprite of createFloorViews(this.model, entry.frames[0], texture)) {
        this.floorArt.addChild(sprite);
      }
    }
  }

  /** Cenário externo fica fora do sorter, mas dentro da câmera, compartilhando pan e zoom com o quarto. */

  private buildSceneBackground(): void {
    const background = this.artProvider?.art.sceneBackground;
    if (!background) return;
    const tiles = background.tiles ?? [background];
    const rendered = tiles.map((tile, index) => ({
      tile,
      index,
      texture: this.artProvider?.textureFor(tile.file),
    }));
    if (rendered.every((entry) => entry.texture === undefined)) return;

    // Terreno contínuo sob o cenário externo, inclusive nas áreas livres de sprites.
    const ground = new Graphics();
    ground.label = 'room-scene-ground';
    ground.rect(-12000, -12000, 24000, 24000).fill(0xa2c957);
    this.sceneArt.addChild(ground);
    for (const { tile, index, texture } of rendered) {
      if (!texture) continue;
      this.sceneArt.addChild(createSceneBackgroundView(
        tile,
        texture,
        index === 0 ? 'room-city-background' : `room-city-background-${index + 1}`,
      ));
    }
  }

  /** Espalha os pontos de partida sem depender de sorteio. */
  private spreadTile(index: number): Tile {
    const spots: Tile[] = [
      { tx: 1, ty: 6 },
      { tx: 6, ty: 1 },
      { tx: 5, ty: 3 },
      { tx: 2, ty: 7 },
      { tx: 7, ty: 4 },
      { tx: 4, ty: 6 },
    ];
    return spots[index % spots.length];
  }

  /** Primeiro tile livre a partir de uma preferência. */
  private pickFreeTile(preferred: Tile): Tile {
    if (this.model.isWalkable(preferred.tx, preferred.ty)) return preferred;
    const free = this.model.walkableTiles();
    return free[0] ?? { tx: 0, ty: 0 };
  }

  /** Limites de pan derivados da geometria da sala e do cenário para acompanhar expansões sem expor áreas vazias. */

  private contentBounds(): CameraRect {
    const bg = this.artProvider?.art.sceneBackground;
    if (bg) {
      return {
        left: bg.left + SCENE_CAMERA_INSET,
        right: bg.left + bg.width - SCENE_CAMERA_INSET,
        top: bg.top + SCENE_CAMERA_INSET,
        bottom: Math.max(
          bg.top + bg.height - SCENE_CAMERA_INSET,
          tileToScreenY(SCENE_DIAGONAL_PAN_TILE, SCENE_DIAGONAL_PAN_TILE),
        ),
      };
    }
    return {
      left: tileToScreenX(0, this.model.tilesY) - CAMERA_PADDING,
      right: tileToScreenX(this.model.tilesX, 0) + CAMERA_PADDING,
      top: -MAX_ITEM_HEIGHT - CAMERA_PADDING,
      bottom: tileToScreenY(this.model.tilesX, this.model.tilesY) + CAMERA_PADDING,
    };
  }

  /** Preserva o enquadramento da sala ao ampliar só a área de pan inferior. */
  private centerCameraOnScene(): void {
    const bg = this.artProvider?.art.sceneBackground;
    if (!bg) return;
    this.camera.centerOn({ x: bg.left + bg.width / 2, y: bg.top + bg.height / 2 });
  }

  /** Alinha a câmera inteira à grade física, preservando a distância entre objetos estáticos. Os atores interpolados usam roundPixels individualmente. */

  private applyCamera(): void {
    this.cameraLayer.scale.set(this.camera.zoom);

    const grade = this.outerScale;
    this.cameraLayer.position.set(
      Math.round(this.camera.x * grade) / grade,
      Math.round(this.camera.y * grade) / grade,
    );
  }

  /** Retorna ao zoom mínimo selecionado, com a sala centrada. */
  resetCamera(): void {
    this.camera.reset();
    this.centerCameraOnScene();
    this.applyCamera();
    this.updateHud();
  }

  /** Desloca a câmera em px de stage. */
  panCameraBy(deltaX: number, deltaY: number): void {
    this.camera.panBy(deltaX, deltaY);
    this.applyCamera();
    this.updateHud();
  }

  /**
   * Multiplica o zoom, mantendo fixo o ponto de stage em `focus`. Sem `focus`,
   * o centro da tela.
   */
  zoomCameraBy(factor: number, focus?: { x: number; y: number }): void {
    this.camera.zoomBy(factor, focus);
    this.applyCamera();
    this.updateHud();
  }

  private onDragStart = (event: FederatedPointerEvent): void => {
    if (this.isModalOpen) return;
    if (this.roomStore?.beginDrag(event)) { this.drag = null; this.dragCancelledTap = true; return; }
    const local = this.view.toLocal(event.global);
    if (event.pointerType === 'touch') {
      this.touchPoints.set(event.pointerId, { x: local.x, y: local.y });
      if (this.touchPoints.size >= 2) {
        this.startPinch();
        return;
      }
    }
    this.drag = { pointerId: event.pointerId, lastX: local.x, lastY: local.y, travelled: 0 };
    this.dragCancelledTap = false;
    this.pinchCancelledTap = false;
  };

  private startPinch(): void {
    const [first, second] = [...this.touchPoints.values()];
    if (!first || !second) return;
    this.pinch = {
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      startZoom: this.camera.zoom,
      center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
    this.drag = null;
    this.dragCancelledTap = true;
    this.pinchCancelledTap = true;
  }

  private onDragMove = (event: FederatedPointerEvent): void => {
    if (this.isModalOpen) return;
    this.roomStore?.hover(event);

    // `globalpointermove` também chega quando o ponteiro está sobre o vazio
    // estrutural das paredes, onde o Graphics do piso deliberadamente não tem
    // geometria. Isso garante que o hover anterior seja removido ao sair do piso.
    this.updateHoveredTile(event);

    if (event.pointerType === 'touch' && this.touchPoints.has(event.pointerId)) {
      const local = this.view.toLocal(event.global);
      this.touchPoints.set(event.pointerId, { x: local.x, y: local.y });
      if (this.pinch) {
        const [first, second] = [...this.touchPoints.values()];
        if (!first || !second) return;
        const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        this.camera.setZoom(this.pinch.startZoom * distance / this.pinch.startDistance, this.pinch.center);
        this.camera.panBy(center.x - this.pinch.center.x, center.y - this.pinch.center.y);
        this.pinch.center = center;
        this.dragCancelledTap = true;
        this.applyCamera();
        this.updateHud();
        return;
      }
    }

    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const local = this.view.toLocal(event.global);
    const deltaX = local.x - drag.lastX;
    const deltaY = local.y - drag.lastY;
    drag.lastX = local.x;
    drag.lastY = local.y;
    drag.travelled += Math.hypot(deltaX, deltaY);

    if (drag.travelled < DRAG_THRESHOLD) return;

    this.dragCancelledTap = true;
    this.floor.cursor = 'grabbing';
    this.panCameraBy(deltaX, deltaY);
  };

  private onDragEnd = (event: FederatedPointerEvent): void => {
    if (this.roomStore?.endDrag(event)) { this.drag = null; this.dragCancelledTap = true; return; }
    if (event.pointerType === 'touch' && this.touchPoints.delete(event.pointerId)) {
      if (this.touchPoints.size >= 2) this.startPinch();
      else {
        this.pinch = null;
        const [pointerId, point] = [...this.touchPoints.entries()][0] ?? [];
        this.drag = point ? { pointerId, lastX: point.x, lastY: point.y, travelled: DRAG_THRESHOLD } : null;
      }
      this.floor.cursor = 'pointer';
      return;
    }
    if (this.drag && event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.floor.cursor = 'pointer';
  };

  /**
   * `ctrlKey` fica de fora de propósito: é o gesto de pinça do trackpad, e o
   * navegador já dá zoom na página com ele. O Pixi registra o listener de roda
   * como `passive`, então não há como cancelar o gesto nativo — competir com ele
   * daria zoom duplo.
   */
  private onWheel = (event: FederatedWheelEvent): void => {
    if (this.isModalOpen) return;
    if (event.ctrlKey) return;

    const passos = wheelNotches(event.deltaY, event.deltaMode);
    if (passos === 0) return;

    const focus = this.view.toLocal(event.global);
    this.zoomCameraBy(ZOOM_WHEEL_STEP ** passos, { x: focus.x, y: focus.y });
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.isModalOpen) return;

    // O painel de desenvolvimento tem campos de texto; digitar neles não é câmera.
    const alvo = event.target as HTMLElement | null;
    if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
    if (this.roomStore?.key(event)) { event.preventDefault(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape' && this.storeBar?.isOpen) {
      event.preventDefault();
      this.closeStoreBar();
      return;
    }

    const passo = event.shiftKey ? PAN_KEY_STEP * 3 : PAN_KEY_STEP;

    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        this.panCameraBy(passo, 0);
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        this.panCameraBy(-passo, 0);
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        this.panCameraBy(0, passo);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        this.panCameraBy(0, -passo);
        break;
      case '+':
      case '=':
        this.zoomCameraBy(ZOOM_KEY_STEP);
        break;
      case '-':
      case '_':
        this.zoomCameraBy(1 / ZOOM_KEY_STEP);
        break;
      case '0':
        this.resetCamera();
        break;
      default:
        return;
    }

    event.preventDefault();
  };

  private onPointerMove = (event: FederatedPointerEvent): void => {
    this.updateHoveredTile(event);
  };

  private updateHoveredTile(event: FederatedPointerEvent): void {
    const local = this.world.toLocal(event.global);
    const tile = screenToTile(local.x, local.y);

    // Parede estrutural sem piso não recebe hover nem destino
    if (this.model.isWallTile(tile.tx, tile.ty) && !this.model.hasFloor(tile.tx, tile.ty)) {
      this.hovered = null;
      this.highlight.clear();
      return;
    }

    const insideGrid =
      tile.tx >= TEST_GRID.minTx &&
      tile.tx <= TEST_GRID.maxTx &&
      tile.ty >= TEST_GRID.minTy &&
      tile.ty <= TEST_GRID.maxTy;

    if (!insideGrid) {
      this.hovered = null;
      this.highlight.clear();
      return;
    }
    if (this.hovered && this.hovered.tx === tile.tx && this.hovered.ty === tile.ty) return;

    this.hovered = tile;
    const isRoomFloor = this.model.hasFloor(tile.tx, tile.ty);
    const walkable = isRoomFloor && this.model.isWalkable(tile.tx, tile.ty);

    this.highlight.clear();
    if (isRoomFloor) {
      this.highlight
        .poly(tileDiamond(tile.tx, tile.ty))
        .fill({ color: walkable ? 0xffffff : 0xd23b3b, alpha: 0.22 })
        .stroke({ color: walkable ? 0xffffff : 0xd23b3b, width: 2, alpha: 0.7 });
    } else {
      // Fora da sala: destaque ciano para inspecionar calçada/rua
      this.highlight
        .poly(tileDiamond(tile.tx, tile.ty))
        .fill({ color: 0x38bdf8, alpha: 0.28 })
        .stroke({ color: 0x38bdf8, width: 2, alpha: 0.85 });
    }
    this.updateHud();
  }

  private onPointerTap = (event: FederatedPointerEvent): void => {
    if (this.storeBar?.isOpen) {
      if (this.dragCancelledTap) { this.dragCancelledTap = false; return; }
      this.roomStore?.tap(event); return;
    }
    if (this.isModalOpen || this.storeBar?.isOpen) return;

    // Arraste longo não manda ninguém andar. O `pointerup` roda antes do
    // `pointertap`, então o sinal já está posto quando chegamos aqui.
    if (this.dragCancelledTap) {
      if (!this.pinchCancelledTap) this.dragCancelledTap = false;
      return;
    }

    const local = this.world.toLocal(event.global);
    const clicked = screenToTile(local.x, local.y);

    const clickedStove = this.model.items.find(
      (item) => item.kind === 'stove' && footprintTiles(item).some((t) => t.tx === clicked.tx && t.ty === clicked.ty),
    );
    if (clickedStove) {
      this.openCookScreen(clickedStove);
      return;
    }

    this.closeStoveActions();
    this.sendPlayerTo(clicked);
  };

  /**
   * Manda o jogador até o tile pedido. Se o tile estiver ocupado, vai para o
   * vizinho livre mais próximo — é o que faz sentido ao clicar numa mesa.
   */
  sendPlayerTo(tile: Tile): Tile[] | null {
    if (this.realtime && !this.realtime.connected) return null;
    const chair = this.model.itemAt(tile.tx, tile.ty);
    if (this.realtime && chair?.kind === 'chair' && chair.inventoryUnitId) {
      void this.realtime.command('sit', { chairId: chair.inventoryUnitId }).catch((error: unknown) => console.info('[room]', error)); return [];
    }
    if (this.startingCook || this.servingProcess || (this.cookingProcess?.placementActive && this.cookingProcess.phase !== 'cooking' && this.cookingProcess.phase !== 'ready')) return null;
    // A porta é atravessável pela navegação dos NPCs, mas não tem piso nem
    // recebe clique como destino do jogador.
    if (!this.model.hasFloor(tile.tx, tile.ty)) return null;

    const destination = this.model.isWalkable(tile.tx, tile.ty) ? tile : this.nearestFreeNeighbour(tile);
    if (!destination) return null;

    const path = findPath({
      start: { tx: this.player.tileX, ty: this.player.tileY },
      dest: destination,
      isWalkable: this.model.isWalkable,
      maxTilesX: this.model.tilesX,
      maxTilesY: this.model.tilesY,
    });

    if (!path) return null;
    if (path.length === 0) {
      if (this.player.moving) {
        const current = this.player.currentDestination;
        if (this.realtime) this.movePlayerAlong([destination]);
        else if (current?.tx === destination.tx && current.ty === destination.ty) this.player.clearPath();
        else this.movePlayerAlong([destination]);
        this.drawTarget(destination);
      }
      return path;
    }

    this.movePlayerAlong(path);
    this.drawTarget(destination);
    this.updateHud();
    return path;
  }

  private nearestFreeNeighbour(tile: Tile): Tile | null {
    const candidates: Tile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const candidate = { tx: tile.tx + dx, ty: tile.ty + dy };
        if (this.model.isWalkable(candidate.tx, candidate.ty)) candidates.push(candidate);
      }
    }
    if (candidates.length === 0) return null;

    const from = { tx: this.player.tileX, ty: this.player.tileY };
    candidates.sort(
      (a, b) =>
        Math.abs(a.tx - from.tx) +
        Math.abs(a.ty - from.ty) -
        (Math.abs(b.tx - from.tx) + Math.abs(b.ty - from.ty)),
    );
    return candidates[0];
  }

  private drawTarget(tile: Tile): void {
    this.target.clear();
    this.target
      .poly(tileDiamond(tile.tx, tile.ty))
      .stroke({ color: 0x8ce052, width: 3, alpha: 0.95 });
  }

  private updateHud(): void {
    if (!this.hud) return;
    let tileDesc = '--';
    if (this.hovered) {
      const isRoomFloor = this.model.hasFloor(this.hovered.tx, this.hovered.ty);
      tileDesc = `${this.hovered.tx},${this.hovered.ty}${isRoomFloor ? '' : ' (fora)'}`;
    }
    this.hud.text =
      `room ${this.model.tilesX}x${this.model.tilesY}  ` +
      `atores ${this.actors.length}  ` +
      `cursor ${tileDesc}\n` +
      `passos ${this.player.remainingPath.length}  ` +
      `zoom ${Math.round((this.camera.zoom / this.camera.baseZoom()) * 100)}%  ` +
      // Pixels físicos por pixel de arte. Inteiro significa sem reamostragem.
      `px ${this.camera.netScale.toFixed(2)}${this.camera.pixelPerfect ? ' exato' : ''}  ` +
      `fps ${this.fps}  ` +
      `ping ${this.realtime?.pingMs ?? '--'} ms\n` +
      GAME_VERSION;
  }

  private wander(wanderer: Wanderer, deltaMs: number): void {
    if (!wanderer.actor.reachedPathEnd()) return;

    wanderer.idleMs -= deltaMs;
    if (wanderer.idleMs > 0) return;
    wanderer.idleMs = 600 + this.random() * 2200;

    const free = this.model.walkableTiles();
    if (free.length === 0) return;
    const dest = free[Math.min(free.length - 1, Math.floor(this.random() * free.length))];

    const path = findPath({
      start: { tx: wanderer.actor.tileX, ty: wanderer.actor.tileY },
      dest,
      isWalkable: this.model.isWalkable,
      maxTilesX: this.model.tilesX,
      maxTilesY: this.model.tilesY,
    });
    if (path && path.length > 0) wanderer.actor.setMovePath(path);
  }

  /** Apply an authenticated snapshot to both HUDs without rebuilding the room. */
  setPlayerState(state: PlayerState): void {
    if (this.roomSnapshot) this.roomSnapshot.playerState = state;
    this.topBars?.setState(state);
    this.actionBarMood?.setSatisfaction(state.satisfaction);
    this.actionBarMood?.setCafeName(state.cafeName);
    const appearance = state.appearance ?? '';
    this.wardrobeModal?.setSavedAppearance(appearance);
    if (appearance !== this.playerAppearance) {
      this.playerAppearance = appearance;
      void this.refreshPlayerAppearance(appearance);
    }
  }

  private async refreshPlayerAppearance(appearance: string): Promise<void> {
    const revision = ++this.appearanceRevision;
    if (!(this.playerView instanceof AvatarActorView)) return;
    let bundle: BakedAvatarBundle | undefined;
    try {
      const { wardrobe } = await loadAvatarAssets();
      if (this.destroyed || revision !== this.appearanceRevision) return;
      [bundle] = await bakeAvatars({ looks: [restoreAppearance(wardrobe, appearance)] });
      if (!bundle) return;
      if (this.destroyed || revision !== this.appearanceRevision) {
        bundle.texture.destroy(true);
        return;
      }
      this.playerView.setAppearance(bundle.baked, bundle.texture);
      // Initial atlases may be shared with NPCs; only replacements are owned here.
      this.appearanceAtlas?.texture.destroy(true);
      this.appearanceAtlas = bundle;
    } catch (error) {
      console.warn('[appearance] visual salvo; não foi possível atualizar o avatar da sala', error);
    }
  }

  update(deltaMs: number): void {
    this.fpsElapsedMs += Math.max(0, deltaMs);
    this.fpsFrames++;
    if (this.fpsElapsedMs >= 500) {
      this.fps = Math.round(this.fpsFrames * 1000 / this.fpsElapsedMs);
      this.fpsElapsedMs = 0;
      this.fpsFrames = 0;
    }
    if (this.hud) this.hud.visible = !this.cookModal?.isOpen;
    this.cookModal?.update(deltaMs);
    this.wardrobeModal?.update(deltaMs);
    this.storeBar?.update(deltaMs);
    this.topBars?.update(deltaMs);

    const hoverStep = 1 - Math.exp(-Math.max(0, deltaMs) / 38);
    for (const hover of this.actionIconHovers) {
      hover.sprite.y += (hover.targetY - hover.sprite.y) * hoverStep;
      if (Math.abs(hover.targetY - hover.sprite.y) < 0.05) hover.sprite.y = hover.targetY;
    }

    if (this.realtime) this.updateLiveActors(deltaMs); else this.player.tick(deltaMs);
    this.updateStoveActionTime();
    if (this.pendingCook && this.networkPending === 0 && this.realtime?.connected !== false && this.player.reachedPathEnd()) this.beginServerPlacement();
    if (this.cookingProcess?.phase === 'walking' && this.player.reachedPathEnd()) {
      this.beginPreparing();
    } else if (this.cookingProcess?.phase === 'preparing') {
      const process = this.cookingProcess;
      process.elapsedMs = process.preparingAtMs !== undefined && this.cookingClient
        ? Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.preparingAtMs))
        : Math.min(process.durationMs, process.elapsedMs + Math.max(0, deltaMs));
      process.progress?.setProgress(process.elapsedMs / process.durationMs);
      if (process.elapsedMs >= process.durationMs) this.finishPlacement();
    } else if (this.cookingProcess?.phase === 'cooking') {
      const process = this.cookingProcess;
      process.elapsedMs = process.startedAtMs !== undefined && this.cookingClient
        ? Math.max(0, Math.min(process.durationMs, this.cookingClient.serverNowMs() - process.startedAtMs))
        : Math.min(process.durationMs, process.elapsedMs + Math.max(0, deltaMs));
      if (process.elapsedMs >= process.durationMs) this.finishCooking();
    }
    this.updateCookingCallout();
    if (this.servingProcess?.phase === 'walking' && this.networkPending === 0 && this.realtime?.connected !== false && this.player.reachedPathEnd()) {
      this.beginServing();
    } else if (this.servingProcess?.phase === 'serving') {
      const process = this.servingProcess;
      const duration = process.durationMs ?? LOCAL_COOKING_PREVIEW_MS;
      process.elapsedMs = process.startedAtMs !== undefined && this.realtime
        ? Math.max(0, Math.min(duration, this.realtime.serverNowMs() - process.startedAtMs))
        : Math.min(duration, process.elapsedMs + Math.max(0, deltaMs));
      process.progress?.setProgress(process.elapsedMs / duration);
      if (process.elapsedMs >= duration) this.finishServing();
    }
    if (!this.realtime) this.advanceActorView(this.playerView, deltaMs);

    for (const wanderer of this.wanderers) {
      this.wander(wanderer, deltaMs);
      wanderer.actor.tick(deltaMs);
      this.advanceActorView(wanderer.view, deltaMs);
    }

    this.outsideNpcManager?.update(deltaMs);
    if (this.doorViews.length) {
      const actors = this.actors;
      for (const door of this.doorViews) door.update(deltaMs, actors);
    }
    this.depthSorter.sync(this.world);
    for (const [id, emotion] of this.liveEmotions) {
      const actor = this.liveActors.get(id);
      if (actor) emotion.effect.sync(actor.view.view);
    }
    for (const npc of this.outsideNpcManager?.npcs ?? []) npc.emotion?.sync(npc.view.view);

    if (this.hud) this.updateHud();
  }

  private advanceActorView(view: ActorRenderer, deltaMs: number): void {
    if (view.update) view.update(deltaMs);
    else view.sync();
  }

  private get isMobileLandscape(): boolean {
    return typeof window !== 'undefined' &&
      window.innerWidth > window.innerHeight &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
  }

  private updateMobileHudLayout(): void {
    const scale = this.isMobileLandscape ? MOBILE_LANDSCAPE_HUD_SCALE : 1;
    if (this.topBars) {
      this.topBars.view.scale.set(scale);
      this.topBars.view.x = (STAGE_WIDTH - this.topBarsBaseWidth * scale) / 2;
    }
    // Scale complete toolbars around their bottom-center pivots, including all contents.
    const actionBarScale = scale * ACTION_BAR_UI_SCALE;
    this.actionBarLayer.scale.set(actionBarScale);
    this.storeBar?.setHudScale(actionBarScale);
  }

  /**
   * Escala do letterbox. Serve para duas coisas: reamostrar o texto do HUD e
   * dizer à câmera quantos pixels físicos existem por pixel de stage, que é o que
   * permite ela desfazer a reamostragem da arte.
   */
  setStageScale(scale: number): void {
    this.wardrobeModal?.setStageScale(scale);
    this.settingsModal?.setStageScale(scale);
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

    this.outerScale = scale * dpr;
    this.camera.setPixelScale(this.outerScale);
    const background = this.artProvider?.art.sceneBackground;
    if (this.isMobileLandscape && background) {
      const tiles = background.tiles ?? [background];
      const overhang = scale > 0 ? Math.max(0, (window.innerWidth / scale - STAGE_WIDTH) / 2) : 0;
      this.camera.setHorizontalCover({
        left: Math.min(...tiles.map((tile) => tile.left)),
        right: Math.max(...tiles.map((tile) => tile.left + tile.width)),
        viewportLeft: -overhang,
        viewportRight: STAGE_WIDTH + overhang,
      });
    } else {
      this.camera.setHorizontalCover(null);
    }
    this.applyCamera();
    this.updateMobileHudLayout();

    if (this.hud) {
      this.hud.resolution = Math.min(4, Math.max(1, this.outerScale));
      this.updateHud();
    }
  }

  destroy(): void {
    clearTimeout(this.noticeTimer);
    this.realtime?.destroy();
    for (const [id, entry] of this.liveActors) this.removeLiveActor(id, entry);
    this.liveActors.clear(); this.mealViews.clear();
    this.sharedCookingViews.forEach((view) => view.destroy()); this.sharedCookingViews.clear();
    this.sharedCookingProgress.forEach(({ bar }) => bar.destroy()); this.sharedCookingProgress.clear();
    this.liveEmotions.forEach(({ effect }) => effect.destroy()); this.liveEmotions.clear();
    this.roomStore?.destroy();
    this.destroyed = true;
    this.closeStoveActions();
    this.cookCallout?.destroy();
    this.clearServingProcess();
    this.storeBar?.destroy();
    this.topBars?.destroy();
    this.clearCookingProcess();
    this.cookModal?.destroy();
    this.wardrobeModal?.destroy();
    this.settingsModal?.destroy();
    this.outsideNpcManager?.destroy();
    this.npcAvatarSource?.destroy();
    this.npcAvatarIndices.clear();
    this.playerView.destroy();
    this.appearanceAtlas?.texture.destroy(true);
    this.floor.off('pointermove', this.onPointerMove);
    this.floor.off('pointertap', this.onPointerTap);
    for (const alvo of [this.floor, this.backdrop]) {
      alvo.off('pointerdown', this.onDragStart);
      alvo.off('pointerup', this.onDragEnd);
      alvo.off('pointerupoutside', this.onDragEnd);
      alvo.off('wheel', this.onWheel);
    }
    this.backdrop.off('globalpointermove', this.onDragMove);
    if (this.keyboardCamera && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.view.destroy({ children: true });
  }
}
