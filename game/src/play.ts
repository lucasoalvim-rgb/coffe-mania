import './styles/base.css';

import { bakeRoomAvatars } from './avatar/bake';
import { createNpcAvatarSource } from './avatar/NpcAvatarSource';
import { loadPlaceholderAvatar } from './avatar/placeholder';
import { createApplication } from './core/app';
import { prefersReducedMotion, readBootFlags } from './core/flags';
import { loadFonts } from './core/fonts';
import { PacedProgress } from './core/paced-progress';
import { ScreenManager } from './core/screen-manager';
import { Stage } from './core/stage';
import { BgmPlayer } from './audio/bgm';
import { DEFAULT_AUDIO_PREFERENCES, loadAudioPreferences, saveAudioPreferences, sanitizeAudioPreferences, type AudioPreferences } from './audio/preferences';
import { setSfxMuted, setSfxVolumePercent } from './audio/sfx';
import {
  BGM_URL,
  indoorTexture,
  loadActionBarButtons,
  loadActionBarIcons,
  loadActionBarTexture,
  loadStoreActionBarTexture,
  loadStoreActionBarIcons,
  loadStoreTopButtonTexture,
  loadStoreToolbarTextures,
  loadNpcEmotionTextures,
  loadTopBarsTextures,
  loadCookScreenTextures,
  loadWardrobeScreenTextures,
  loadGameAssets,
  loadIndoorArt,
} from './game/asset-manifest';
import { loadRoomItemArt, roomModelItems, RoomInventoryClient } from './game/room-inventory';
import { resolveSession } from './game/session';
import { loadPlayerState } from './game/player-state';
import { loadNpcAppearancePolicy } from './game/npc-appearance';
import { CookingClient } from './game/cooking';
import { loadSpiceScreenTextures } from './game/spices';
import { subscribePlayerState } from './game/player-state-realtime';
import { RoomRealtime } from './game/room-realtime';
import { loadBitterMode, saveBitterMode } from './game/zoom-preferences';
import { RoomModel } from './world/RoomModel';
import { RoomScreen } from './screens/room/RoomScreen';
import { LoadingScreen } from './screens/loading/LoadingScreen';
import { SecondLoadingOverlay } from './screens/loading/SecondLoadingOverlay';
import { loadLoadingTextures } from './screens/loading/assets';
import { DEFAULT_LOADING_LAYOUT, TIMING } from './screens/loading/layout';
import { FullscreenButton } from './ui/FullscreenButton';
import { loadStoredLayout } from './ui/dev-settings';
import { renderSessionError } from './auth/LoginPage';

async function boot(): Promise<void> {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app não encontrado no index.html');

  const flags = readBootFlags(window.location.search);
  const reducedMotion = prefersReducedMotion() || flags.forceReducedMotion;

  const app = await createApplication(host);

  // As coordenadas de projeto permanecem em 1920×1080; a stage aplica o letterbox.
  const stage = new Stage(() => ({ width: window.innerWidth, height: window.innerHeight }));
  app.stage.addChild(stage.root);

  const screens = new ScreenManager(stage.root);

  const uiLayer = document.createElement('div');
  uiLayer.className = 'ui-layer';
  document.body.appendChild(uiLayer);
  const fullscreen = new FullscreenButton(uiLayer);

  // Carrega a fonte antes de rasterizar qualquer Text do Pixi.

  await loadFonts();

  const paced = new PacedProgress(TIMING.minDisplayMs);
  let loading: LoadingScreen | null = null;
  let secondLoading: SecondLoadingOverlay | null = null;
  const bgm = new BgmPlayer(BGM_URL);
  let soundPreferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  let soundPlayerId: string | null = null;
  const applySoundPreferences = (): void => {
    bgm.setVolumePercent(soundPreferences.musicPercent);
    setSfxVolumePercent(soundPreferences.effectsPercent);
    bgm.setMuted(soundPreferences.muted);
    setSfxMuted(soundPreferences.muted);
  };
  const updateSoundPreferences = (preferences: AudioPreferences): void => {
    soundPreferences = sanitizeAudioPreferences(preferences);
    applySoundPreferences();
    if (soundPlayerId) saveAudioPreferences(safeStorage(), soundPlayerId, soundPreferences);
  };

  async function goToGame(): Promise<void> {
    // Revalide depois do loading, inclusive se a sessão expirou durante a carga.
    const session = await resolveSession();
    if (!session) {
      window.location.replace('/');
      return;
    }
    soundPlayerId = session.playerId;
    soundPreferences = loadAudioPreferences(safeStorage(), soundPlayerId);
    saveAudioPreferences(safeStorage(), soundPlayerId, soundPreferences);
    applySoundPreferences();
    console.info('[session]', session.displayName);
    const roomId = new URLSearchParams(window.location.search).get('room') ?? session.playerId;
    const roomAddress = new URL(window.location.href); roomAddress.searchParams.set('room', roomId); window.history.replaceState(null, '', roomAddress);
    const cookingClient = new CookingClient(roomId);
    const roomClient = new RoomInventoryClient(roomId);
    const roomSnapshot = await roomClient.refresh();

    // Catálogo fornece comportamento e pegada; manifesto fornece geometria visual.
    const [playerState, cookingSnapshot, art, actionBarTexture, actionBarButtons, actionBarIcons, npcEmotionTextures, topBarsTextures, cookTextures, wardrobeTextures, storeBarTexture, storeBarIcons, npcAppearancePolicy, placeholderAvatar, storeTopButtonTexture, storeToolbarTextures, spiceTextures] = await Promise.all([
      loadPlayerState(),
      cookingClient.refresh(),
      loadIndoorArt().catch((error) => {
        console.warn('[arte] indisponível, seguindo com as caixas', error);
        return null;
      }),
      loadActionBarTexture().catch((error) => {
        console.warn('[action-bar] indisponível', error);
        return undefined;
      }),
      loadActionBarButtons().catch((error) => {
        console.warn('[action-bar-buttons] indisponíveis', error);
        return undefined;
      }),
      loadActionBarIcons().catch((error) => {
        console.warn('[action-bar-icons] indisponíveis', error);
        return undefined;
      }),
      loadNpcEmotionTextures().catch((error) => {
        console.warn('[npc-emotions] indisponíveis', error);
        return undefined;
      }),
      loadTopBarsTextures().catch((error) => {
        console.warn('[top-bars] indisponível', error);
        return undefined;
      }),
      loadCookScreenTextures().catch((error) => {
        console.warn('[cook-screen] indisponível', error);
        return undefined;
      }),
      loadWardrobeScreenTextures().catch((error) => {
        console.warn('[wardrobe-screen] indisponível', error);
        return undefined;
      }),
      loadStoreActionBarTexture().catch((error) => {
        console.warn('[store-bar] indisponível', error);
        return undefined;
      }),
      loadStoreActionBarIcons().catch((error) => {
        console.warn('[store-icons] indisponíveis', error);
        return undefined;
      }),
      loadNpcAppearancePolicy(safeStorage()),
      loadPlaceholderAvatar(),
      loadStoreTopButtonTexture().catch((error) => {
        console.warn('[store-top-button] indisponível', error);
        return undefined;
      }),
      loadStoreToolbarTextures().catch((error) => {
        console.warn('[store-toolbar-icons] indisponíveis', error);
        return undefined;
      }),
      loadSpiceScreenTextures(),
    ]);

    // Only the player is baked at boot. NPC looks are generated per spawn.
    const avatars = await bakeRoomAvatars(1, { playerAppearance: playerState.appearance }).catch((error) => {
      console.warn('[avatar] indisponível, usando o placeholder branco', error);
      return [];
    });
    const npcAvatarSource = await createNpcAvatarSource(npcAppearancePolicy);

    // Expõe os atlas apenas em desenvolvimento para diagnóstico do renderizador.
    if (import.meta.env.DEV) Object.assign(window, { __avatarBake: avatars[0], __avatarBakes: avatars });

    const artProvider = await loadRoomItemArt(roomSnapshot, art ? { art, textureFor: indoorTexture } : undefined);
    const model = new RoomModel({ items: roomModelItems(roomSnapshot, artProvider.art), walls: false, tilesX: roomSnapshot.tilesX, tilesY: roomSnapshot.tilesY });
    const room = new RoomScreen({
      playerState,
      cookingClient,
      cookingSnapshot,
      spiceTextures,
      model,
      roomSnapshot,
      ...(roomSnapshot.canEdit !== false ? { roomClient } : {}),
      realtime: new RoomRealtime(roomId),
      npcCount: 0,
      artProvider,
      avatars,
      placeholderAvatar,
      npcAvatarSource,
      outsideNpcs: true,
      ...(actionBarTexture ? { actionBarTexture } : {}),
      ...(storeBarTexture && roomSnapshot.canEdit !== false ? { storeBarTexture } : {}),
      ...(storeBarIcons ? { storeBarIcons } : {}),
      ...(storeTopButtonTexture ? { storeTopButtonTexture } : {}),
      ...(storeToolbarTextures ? { storeToolbarTextures } : {}),
      ...(actionBarButtons ? { actionBarButtons } : {}),
      ...(actionBarIcons ? { actionBarIcons } : {}),
      ...(npcEmotionTextures ? { npcEmotionTextures } : {}),
      settings: {
        playerName: session.displayName,
        getPreferences: () => ({ ...soundPreferences }),
        onChange: updateSoundPreferences,
        getBitterMode: () => loadBitterMode(safeStorage(), session.playerId),
        onBitterModeChange: (enabled) => saveBitterMode(safeStorage(), session.playerId, enabled),
      },
      ...(topBarsTextures ? { topBarsTextures } : {}),
      ...(cookTextures ? { cookTextures } : {}),
      ...(wardrobeTextures ? { wardrobeTextures } : {}),
      onWardrobeVisibilityChange: (open) => {
        fullscreen.setWardrobeOpen(open);
      },
    });
    room.bindWheelElement(app.canvas);
    screens.show(room);
    const stopPlayerState = subscribePlayerState((state) => room.setPlayerState(state));
    room.view.once('destroyed', stopPlayerState);
    if (import.meta.hot) import.meta.hot.dispose(stopPlayerState);

    bgm.play();
  }

  if (flags.startScreen === 'avatar' && import.meta.env.DEV) {

    const { runAvatarProbe } = await import('./avatar/probe');
    await runAvatarProbe(document.body);
    return;
  }

  if (flags.startScreen === 'room') {
    // Atalho de desenvolvimento: entra direto no room, sem passar pelo loading.
    await goToGame();
  } else {
    const textures = await loadLoadingTextures();
    const storedLayout = import.meta.env.DEV ? loadStoredLayout(safeStorage()) : DEFAULT_LOADING_LAYOUT;

    loading = new LoadingScreen({
      textures,
      layout: storedLayout,
      reducedMotion,
      progressSource: () => paced.value(),
      isComplete: () => paced.complete,
      onComplete: () => {
        secondLoading = new SecondLoadingOverlay({
          texture: textures.second,
          reducedMotion,
          onFinished: () => {
            secondLoading?.destroy();
            secondLoading = null;
          },
        });
        secondLoading.setViewport(window.innerWidth, window.innerHeight, stage.currentTransform);
        app.stage.addChild(secondLoading.view);
        void goToGame().then(() => secondLoading?.setGameReady()).catch((error: unknown) => {
          app.stop();
          secondLoading?.destroy();
          secondLoading = null;
          uiLayer.remove();
          renderSessionError(host, error);
        });
      },
    });
    loading.setLocked(flags.lock100);
    loading.setViewportBackground(window.innerWidth, window.innerHeight, stage.currentTransform);
    app.stage.addChildAt(loading.viewportBackground, 0);
    screens.show(loading);

    void loadGameAssets((progress) => paced.setReal(progress));
  }

  stage.onResize((transform) => {
    fullscreen.setStageScale(transform.scale);
    screens.setStageScale(transform.scale);
    if (loading && screens.active === loading) {
      loading.setViewportBackground(window.innerWidth, window.innerHeight, transform);
    }
    secondLoading?.setViewport(window.innerWidth, window.innerHeight, transform);
  });

  app.ticker.add((ticker) => {
    paced.advance(ticker.deltaMS);
    screens.update(ticker.deltaMS);
    secondLoading?.update(ticker.deltaMS);
  });

  if (flags.grid) {
    const { createStageMarkers } = await import('./core/stage-markers');
    const markers = createStageMarkers();
    markers.zIndex = 1000; 
    stage.root.sortableChildren = true;
    stage.root.addChild(markers);
  }

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __coffeMania: {
        app, stage, screens, loading, fullscreen, paced, bgm,
        get secondLoading() { return secondLoading; },
      },
    });
  }
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

void boot().catch((error: unknown) => {
  const host = document.getElementById('app');
  if (host) renderSessionError(host, error);
});
