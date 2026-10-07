import {
  AmbientLight,
  AnimationMixer,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  OrthographicCamera,
  SRGBColorSpace,
  Scene,
  SkinnedMesh,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Mesh,
} from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { composeAvatarTexture, parseAtlas, type AtlasFile } from './AvatarTexture';
import { ANGLE_PER_DIRECTION, frameTimeSeconds } from './clips';
import { ANIMATION_OBJECT_NAMES, isCustomisableObject, type ResolvedLook } from './wardrobe';

/** Renderizador ortográfico do avatar Collada. O look controla a visibilidade das peças e a composição da textura. */

/** Inclinação do modelo em graus. Com a câmera em +Z, o sinal positivo faz os pontos mais distantes do chão aparecerem mais altos na tela. */

export const AVATAR_PITCH_DEGREES = 30;

/** Correção adicional do eixo vertical. O ColladaLoader já aplica a conversão de Z_UP; uma segunda rotação inverteria o modelo. */

export const UP_AXIS_FIX_DEGREES = 0;

/** Enquadramento constante entre looks: corpo define largura e profundidade; corpo, cabelos e chapéus definem a altura. */

const FRAMING_BODY = ['face0', 'pants01', 'shirt01', 'armleft', 'armright'];

/** Keyframe em que o enquadramento é medido: o primeiro do clipe parado. */
const FRAMING_FRAME = 20;

/** Folga acima da cabeça/chapéus para evitar cortes no topo. */
const FRAMING_HEAD_ROOM = 0.02;

/** Folga total aplicada à altura medida (cobrindo até o chapéu mais alto). */
const FRAMING_MARGIN = 1.10;

/**
 * Juntas usadas para medir o apoio no chão. O Collada nomeia os ossos pelo `sid`,
 * e não pelo nome do Biped: Bone6 é o `Bip01_L_Foot` e Bone9 o `Bip01_R_Foot`.
 */
/** Tratamento da bind_shape_matrix: three conserva a matriz do Collada; none usa identidade para diagnóstico. A matriz posiciona cada peça em relação ao esqueleto. */

export type BindMode = 'three' | 'none';

export const DEFAULT_BIND_MODE: BindMode = 'three';

/** Caixa de uma peça em pixels do quadro renderizado. */
export interface MeshScreenBounds {
  name: string;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const FOOT_LEFT_BONE = 'Bone6';
export const FOOT_RIGHT_BONE = 'Bone9';
export const HEAD_BONE = 'Bone1';

export interface AvatarRendererOptions {
  /** Lado do quadro renderizado, em pixels. */
  size?: number;
  /** Folga em volta do avatar no enquadramento. */
  margin?: number;
  /** Correção do eixo vertical, em graus. Ver UP_AXIS_FIX_DEGREES. */
  upAxisFix?: number;
  /** Inclinação da câmera, em graus. Ver AVATAR_PITCH_DEGREES. */
  pitch?: number;
  /** Inverte a coordenada V para alinhar a textura à malha. */
  flipTextureY?: boolean;
  /** Sem iluminação: isola problema de textura de problema de luz. */
  unlit?: boolean;
  /** Sem animação: mostra a bind pose, para isolar skin de animação. */
  noAnimation?: boolean;
  /** Tratamento do `bind_shape_matrix`. Ver BIND_MODE. */
  bindMode?: BindMode;
  modelUrl: string;
  atlasImage: CanvasImageSource;
  atlas: unknown;
  createCanvas?: () => HTMLCanvasElement;
  /** Mantém o quadro disponível para a textura Pixi usada no guarda-roupa. */
  preserveDrawingBuffer?: boolean;
}

export class AvatarRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  private readonly root = new Group();
  private readonly pivot = new Group();
  private readonly atlas: AtlasFile;
  private readonly atlasImage: CanvasImageSource;
  private readonly textureCanvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private readonly size: number;

  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private model: Object3D | null = null;
  private hairMaterials: Material[] = [];
  private animationCount = 0;
  private readonly margin: number;
  private readonly upAxisFix: number;
  private framing: { half: number; center: Vector3; size: Vector3 } | null = null;
  private readonly pitch: number;
  private readonly unlit: boolean;
  private readonly noAnimation: boolean;
  private readonly bindMode: BindMode;
  private clip: AnimationClip | null = null;

  private constructor(options: AvatarRendererOptions) {
    this.size = options.size ?? 256;
    this.atlas = parseAtlas(options.atlas);
    this.atlasImage = options.atlasImage;

    const make = options.createCanvas ?? (() => document.createElement('canvas'));
    this.canvas = make();
    this.textureCanvas = make();

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    this.renderer.setSize(this.size, this.size, false);
    this.renderer.setClearColor(0x000000, 0);

    this.texture = new CanvasTexture(this.textureCanvas);
    this.texture.colorSpace = SRGBColorSpace;
    // flipY alinha a orientação vertical da textura às coordenadas do Collada.

    this.texture.flipY = options.flipTextureY ?? true;
    this.unlit = options.unlit ?? false;
    this.noAnimation = options.noAnimation ?? false;
    this.bindMode = options.bindMode ?? DEFAULT_BIND_MODE;

    // Iluminação ambiente e difusa, sem componente especular.
    this.scene.add(new AmbientLight(0xffffff, 0.5));
    const light = new DirectionalLight(0xffffff, 1);
    light.position.set(-100000, 9000, -84000);
    this.scene.add(light);

    this.pivot.add(this.root);
    this.scene.add(this.pivot);

    // O frustum ortográfico é calculado a partir do modelo em frameCamera.

    this.camera = new OrthographicCamera(-1, 1, 1, -1, -1_000_000, 1_000_000);
    this.margin = options.margin ?? 1.05;
    this.upAxisFix = options.upAxisFix ?? UP_AXIS_FIX_DEGREES;
    this.pitch = options.pitch ?? AVATAR_PITCH_DEGREES;
  }

  static async create(options: AvatarRendererOptions): Promise<AvatarRenderer> {
    const instance = new AvatarRenderer(options);
    await instance.load(options.modelUrl);
    return instance;
  }

  private async load(modelUrl: string): Promise<void> {
    const loader = new ColladaLoader();
    const collada = await loader.loadAsync(modelUrl);
    if (!collada?.scene) throw new Error(`Collada sem cena: ${modelUrl}`);

    this.model = collada.scene;
    this.root.add(this.model);

    // Eixo vertical: ver UP_AXIS_FIX_DEGREES.
    this.root.rotation.x = (this.upAxisFix * Math.PI) / 180;

    // Inclinação aplicada no modelo, mantendo a câmera ortográfica.
    this.pivot.rotation.x = (this.pitch * Math.PI) / 180;

    this.applyBindMode();

    this.fixTextureChannel();
    this.applyMaterials();
    this.frameCamera();

    // A animação do Collada é uma trilha de 146 keyframes, subdividida em clipes.

    const animations = this.noAnimation ? [] : (collada.scene.animations ?? []);
    if (animations.length > 0) {
      this.mixer = new AnimationMixer(this.model);
      this.clip = animations[0];
      this.action = this.mixer.clipAction(animations[0]);
      this.action.play();
      this.mixer.setTime(0);
      this.animationCount = animations.length;
    }
  }

  /** Ajusta a bind shape matrix de cada peça. Ver BindMode. */
  private applyBindMode(): void {
    if (this.bindMode === 'three') return;

    this.model?.traverse((node) => {
      const skinned = node as SkinnedMesh;
      if (!skinned.isSkinnedMesh) return;
      skinned.bindMatrix.identity();
      skinned.bindMatrixInverse.identity();
    });
  }

  /** O Collada usa TEXCOORD set=1, convertido pelo loader em uv1. Copiar para uv permite que o material amostre esse canal. */

  private fixTextureChannel(): void {
    this.model?.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh && !(node as SkinnedMesh).isSkinnedMesh) return;

      const geometry = mesh.geometry;
      if (!geometry || geometry.getAttribute('uv')) return;

      const alternativo = geometry.getAttribute('uv1') ?? geometry.getAttribute('uv2');
      if (alternativo) geometry.setAttribute('uv', alternativo);
    });
  }

  /** A roupa usa a textura composta; o cabelo usa MeshBasicMaterial para preservar a cor exata da paleta. */

  private applyMaterials(): void {
    this.hairMaterials = [];

    this.model?.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh && !(node as SkinnedMesh).isSkinnedMesh) return;

      const nome = (Array.isArray(mesh.material) ? mesh.material[0]?.name : mesh.material?.name) ?? '';

      if (nome.toLowerCase().includes('hair')) {
        const material = new MeshBasicMaterial({ color: 0xffffff });
        mesh.material = material;
        this.hairMaterials.push(material);
        return;
      }

      mesh.material = this.unlit
        ? new MeshBasicMaterial({ map: this.texture })
        : new MeshPhongMaterial({
            map: this.texture,
            specular: new Color(0x000000),
            shininess: 0,
          });
    });
  }

  /** Nós visíveis, cor da pele e do cabelo. */
  setLook(look: ResolvedLook): string[] {
    const faltando = composeAvatarTexture(this.textureCanvas, this.atlasImage, this.atlas, look);
    this.texture.needsUpdate = true;

    for (const material of this.hairMaterials) {
      (material as MeshBasicMaterial).color.setHex(look.hairColour);
    }

    // Os props de animação começam apagados: quem os acende é o clipe, pela
    // tabela ANIMATION_SHOW_OBJECTS. Sem isso o avatar aparece carregando bandeja,
    // balde, vassoura e ferramenta ao mesmo tempo.
    this.setPropsVisible([]);

    const acesos = new Set(look.objects);
    this.model?.traverse((node) => {
      if (!node.name) return;
      const nome = node.name.replace(/-node$/, '');
      if (!isCustomisableObject(nome)) return;
      node.visible = acesos.has(nome);
    });

    // Peças pedidas que não são customizáveis (`face0`) ficam acesas à força: o
    // laço acima não passa por elas.
    for (const nome of look.objects) {
      if (isCustomisableObject(nome)) continue;
      for (const alvo of [nome, `${nome}-node`]) {
        const node = this.model?.getObjectByName(alvo);
        if (node) node.visible = true;
      }
    }

    return faltando;
  }

  /** Acende um prop de animação (tray, bucket, brush, repair). */
  setPropsVisible(names: readonly string[]): void {
    const acesos = new Set(names);
    for (const prop of ANIMATION_OBJECT_NAMES) {
      for (const nome of [prop, `${prop}-node`, `${prop}_PIVOT`]) {
        const node = this.model?.getObjectByName(nome);
        if (node) node.visible = acesos.has(prop);
      }
    }
  }

  /** Caixa das malhas com skinning no frame solicitado. applyBoneTransform mede os vértices animados, em vez da geometria em bind pose. */

  private skinnedBounds(names: readonly string[], frame: number): Box3 {
    this.setFrame(frame);
    this.scene.updateMatrixWorld(true);

    const caixa = new Box3();
    const ponto = new Vector3();

    for (const name of names) {
      const mesh = this.model?.getObjectByName(name) as SkinnedMesh | undefined;
      if (!mesh?.isSkinnedMesh) continue;

      const posicoes = mesh.geometry?.getAttribute('position');
      if (!posicoes) continue;

      for (let i = 0; i < posicoes.count; i++) {
        ponto.fromBufferAttribute(posicoes, i);
        mesh.applyBoneTransform(i, ponto);
        mesh.localToWorld(ponto);
        caixa.expandByPoint(ponto);
      }
    }

    return caixa;
  }

  /** Nomes das malhas de cabelo, que entram no enquadramento vertical. */
  private hairMeshNames(): string[] {
    const nomes: string[] = [];
    this.model?.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh && node.name.startsWith('hair')) nomes.push(node.name);
    });
    return nomes;
  }

  /** Nomes das malhas de chapéus, para dar folga vertical no enquadramento. */
  private hatMeshNames(): string[] {
    const nomes: string[] = [];
    this.model?.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh && node.name.startsWith('hat')) nomes.push(node.name);
    });
    return nomes;
  }

  /** Calcula um enquadramento único, incluindo corpo, cabelos e chapéus. Trocar o look não altera a escala dos atlas. */

  private frameCamera(): void {
    if (!this.model) return;

    const direcaoOriginal = this.root.rotation.y;
    const pitchOriginal = this.pivot.rotation.x;
    this.root.position.set(0, 0, 0);
    this.root.rotation.y = 0;
    this.pivot.rotation.x = 0;

    const corpo = this.skinnedBounds(FRAMING_BODY, FRAMING_FRAME);
    const comCabeca = this.skinnedBounds(
      [...FRAMING_BODY, ...this.hairMeshNames(), ...this.hatMeshNames()],
      FRAMING_FRAME,
    );

    this.root.rotation.y = direcaoOriginal;
    this.pivot.rotation.x = pitchOriginal;

    if (corpo.isEmpty() || comCabeca.isEmpty()) return;

    const alturaMedida = comCabeca.max.y - comCabeca.min.y;

    // Horizontal e profundidade do corpo; vertical do corpo com cabelos e chapéus.
    // A folga vai para cima da cabeça/chapéus para evitar cortes.
    const centro = new Vector3(
      (corpo.min.x + corpo.max.x) / 2,
      (comCabeca.min.y + comCabeca.max.y) / 2 + alturaMedida * FRAMING_HEAD_ROOM,
      (corpo.min.z + corpo.max.z) / 2,
    );

    const altura = alturaMedida * FRAMING_MARGIN;
    const half = (altura / 2) * this.margin;

    // O modelo passa a girar em torno do centro medido, e a câmera fica na origem.
    this.root.position.set(-centro.x, -centro.y, -centro.z);

    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();

    this.camera.position.set(0, 0, half * 4);
    this.camera.lookAt(0, 0, 0);

    this.framing = {
      half,
      center: centro.clone(),
      size: new Vector3(corpo.max.x - corpo.min.x, alturaMedida, corpo.max.z - corpo.min.z),
    };
  }

  /** Diagnóstico de ossos, pesos e deformação das malhas. */

  describeSkin(meshName: string, boneName: string, frames: readonly number[]): string[] {
    const linhas: string[] = [];

    let mesh: SkinnedMesh | null = null;
    this.model?.traverse((node) => {
      if (node.name === meshName && (node as SkinnedMesh).isSkinnedMesh) mesh = node as SkinnedMesh;
    });

    if (!mesh) return [`${meshName}: não é SkinnedMesh`];

    const alvo = mesh as SkinnedMesh;
    const geometry = alvo.geometry;
    linhas.push(
      `${meshName}: skinIndex ${geometry.getAttribute('skinIndex') ? 'sim' : 'NÃO'}` +
        ` skinWeight ${geometry.getAttribute('skinWeight') ? 'sim' : 'NÃO'}` +
        ` ossos ${alvo.skeleton?.bones.length ?? 0}` +
        ` bindMatrix ${alvo.bindMatrix ? 'sim' : 'NÃO'}` +
        ` bindMode ${String(alvo.bindMode)}`,
    );

    const bone = this.model?.getObjectByName(boneName);
    const posicao = new Vector3();
    const caixa = new Box3();

    for (const frame of frames) {
      this.setFrame(frame);
      this.scene.updateMatrixWorld(true);

      caixa.setFromObject(alvo);
      const centro = caixa.getCenter(new Vector3());

      if (bone) bone.getWorldPosition(posicao);

      linhas.push(
        `  frame ${String(frame).padStart(3)}: ${boneName} em ` +
          `${posicao.toArray().map((v) => v.toFixed(1)).join(', ')}` +
          `  centro da malha ${centro.toArray().map((v) => v.toFixed(1)).join(', ')}`,
      );
    }

    return linhas;
  }

  /** Canvas da textura 256x256 remontada, para conferência visual. */
  get textureImage(): HTMLCanvasElement {
    return this.textureCanvas;
  }

  /** Enquadramento resolvido, para conferência. */
  get frame(): { half: number; center: Vector3; size: Vector3 } | null {
    return this.framing;
  }

  /** Direção 0..7, em passos de 45 graus. */
  setDirection(direction: number): void {
    this.root.rotation.y = (direction * ANGLE_PER_DIRECTION * Math.PI) / 180;
  }

  /** Keyframe da trilha única: setFrame(i) -> update(1/10 * i). */
  setFrame(frame: number): void {
    this.mixer?.setTime(frameTimeSeconds(frame));
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Caixa de cada peça visível em pixels do quadro, calculada com applyBoneTransform para incluir o skinning. */

  projectMeshBounds(frame = 0, step = 3): MeshScreenBounds[] {
    this.setFrame(frame);
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    const linhas: MeshScreenBounds[] = [];
    const ponto = new Vector3();

    this.model?.traverse((node) => {
      const mesh = node as SkinnedMesh;
      if (!mesh.isSkinnedMesh || !node.visible) return;

      const posicoes = mesh.geometry?.getAttribute('position');
      if (!posicoes) return;

      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;

      for (let i = 0; i < posicoes.count; i += step) {
        ponto.fromBufferAttribute(posicoes, i);
        mesh.applyBoneTransform(i, ponto);
        mesh.localToWorld(ponto);
        ponto.project(this.camera);

        const x = ((ponto.x + 1) / 2) * this.size;
        const y = ((1 - ponto.y) / 2) * this.size;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }

      linhas.push({
        name: node.name,
        top: Math.round(top),
        bottom: Math.round(bottom),
        left: Math.round(left),
        right: Math.round(right),
      });
    });

    return linhas.sort((a, b) => a.top - b.top);
  }

  /** Caixa do modelo em unidades do Collada, para enquadrar e para medir. */
  measureBounds(): { min: Vector3; max: Vector3 } | null {
    if (!this.model) return null;
    const box = new Box3().setFromObject(this.model);
    return { min: box.min.clone(), max: box.max.clone() };
  }

  /** Diagnóstico da presença, escala e orientação das coordenadas UV por malha. */

  describeUv(limit = 8): string[] {
    const linhas: string[] = [];

    this.model?.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh && !(node as SkinnedMesh).isSkinnedMesh) return;
      if (linhas.length >= limit) return;

      const uv = mesh.geometry?.getAttribute('uv');
      if (!uv) {
        linhas.push(`${node.name}: sem atributo uv`);
        return;
      }

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }

      linhas.push(
        `${node.name}: uv ${uv.count} pontos, u [${minU.toFixed(3)}, ${maxU.toFixed(3)}]` +
          ` v [${minV.toFixed(3)}, ${maxV.toFixed(3)}]`,
      );
    });

    return linhas;
  }

  /** Diagnóstico das trilhas de animação: nome, tipo e se acham o alvo. */
  describeTracks(limit = 8): string[] {
    if (!this.clip) return ['sem clipe de animação'];

    const linhas = [`clipe "${this.clip.name}" ${this.clip.duration.toFixed(2)}s, ${this.clip.tracks.length} trilhas`];

    for (const track of this.clip.tracks.slice(0, limit)) {
      const alvo = track.name.split('.')[0];
      const achou = this.model?.getObjectByName(alvo) ?? null;
      linhas.push(`  ${track.name} (${track.ValueTypeName}) alvo ${achou ? 'ok' : 'NÃO ENCONTRADO'}`);
    }

    return linhas;
  }

  /** Juntas projetadas em coordenadas normalizadas (-1..1, y para cima), para conferir orientação e postura. */

  projectBones(names: readonly string[], frame: number): Record<string, [number, number]> {
    this.setFrame(frame);
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);

    const resultado: Record<string, [number, number]> = {};
    const posicao = new Vector3();

    for (const name of names) {
      const node = this.model?.getObjectByName(name);
      if (!node) continue;
      node.getWorldPosition(posicao);
      posicao.project(this.camera);
      resultado[name] = [Number(posicao.x.toFixed(3)), Number(posicao.y.toFixed(3))];
    }

    return resultado;
  }

  /** Confere o sinal da inclinação pela altura projetada dos pés: em perfil, o pé mais distante deve aparecer mais alto. */

  describeCameraSense(frame = FRAMING_FRAME): {
    back: number;
    front: number;
    fromAbove: boolean;
  } | null {
    const direcaoOriginal = this.root.rotation.y;
    this.setDirection(2);
    const pontos = this.projectBones([FOOT_LEFT_BONE, FOOT_RIGHT_BONE], frame);
    this.root.rotation.y = direcaoOriginal;

    const atras = pontos[FOOT_LEFT_BONE];
    const frente = pontos[FOOT_RIGHT_BONE];
    if (!atras || !frente) return null;

    // Coordenada normalizada, y para cima: atrás mais alto significa câmera acima.
    return { back: atras[1], front: frente[1], fromAbove: atras[1] > frente[1] };
  }

  /**
   * Ponto de apoio do avatar dentro do quadro, em pixels.
   *
   * É a média dos dois pés projetada na tela. Serve de âncora para assentar o
   * sprite assado no tile: sem isso o personagem flutua ou afunda no chão.
   */
  measureGround(frame: number): { x: number; y: number } {
    const pontos = this.projectBones([FOOT_LEFT_BONE, FOOT_RIGHT_BONE], frame);
    const pes = Object.values(pontos);

    if (pes.length === 0) return { x: this.size / 2, y: this.size };

    const ndcX = pes.reduce((soma, [x]) => soma + x, 0) / pes.length;
    const ndcY = Math.min(...pes.map(([, y]) => y));

    return {
      x: ((ndcX + 1) / 2) * this.size,
      y: ((1 - ndcY) / 2) * this.size,
    };
  }

  /** Nomes das juntas, na ordem em que aparecem na hierarquia. */
  boneNames(): string[] {
    const nomes: string[] = [];
    this.model?.traverse((node) => {
      if (node.type === 'Bone') nomes.push(node.name);
    });
    return nomes;
  }

  /** Diagnóstico: o que veio do Collada. */
  describe(): { meshes: number; skinned: number; bones: number; animations: number; nodes: string[] } {
    let meshes = 0;
    let skinned = 0;
    let bones = 0;
    const nodes: string[] = [];

    this.model?.traverse((node) => {
      if ((node as SkinnedMesh).isSkinnedMesh) skinned++;
      else if ((node as Mesh).isMesh) meshes++;
      if (node.type === 'Bone') bones++;
      if (node.name) nodes.push(node.name);
    });

    return {
      meshes,
      skinned,
      bones,
      animations: this.animationCount,
      nodes,
    };
  }

  destroy(): void {
    this.texture.dispose();
    this.renderer.dispose();
  }
}
