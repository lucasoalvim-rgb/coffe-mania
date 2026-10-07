import { AVATAR_URLS, loadAvatarAssets } from '../game/asset-manifest';
import { AvatarRenderer } from './AvatarRenderer';
import { resolveLook } from './wardrobe';

/** Diagnóstico do avatar em oito direções, disponível em desenvolvimento com ?screen=avatar. */

/** Percentual de pixels que mudam entre dois frames da animação. */
function diferencaDePixels(renderer: AvatarRenderer, frameA: number, frameB: number): number {
  const capturar = (frame: number): Uint8ClampedArray => {
    renderer.setFrame(frame);
    renderer.render();
    const copia = document.createElement('canvas');
    copia.width = renderer.canvas.width;
    copia.height = renderer.canvas.height;
    const contexto = copia.getContext('2d');
    if (!contexto) throw new Error('sem contexto 2d');
    contexto.drawImage(renderer.canvas, 0, 0);
    return contexto.getImageData(0, 0, copia.width, copia.height).data;
  };

  const a = capturar(frameA);
  const b = capturar(frameB);

  let diferentes = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      diferentes++;
    }
  }

  return (diferentes / (a.length / 4)) * 100;
}

export async function runAvatarProbe(host: HTMLElement): Promise<void> {
  const { wardrobe, atlas, atlasImage } = await loadAvatarAssets();

  // Mesmo look que o room usa, para a sonda medir o que o jogo mostra.
  const look = resolveLook(wardrobe, wardrobe.defaultLook());

  // Compara combinações de eixo vertical e inclinação após a conversão do ColladaLoader.

  const variantes = [
    { noAnimation: false, frame: 20, bindMode: 'three' as const, rotulo: 'parado f20' },
    { noAnimation: false, frame: 21, bindMode: 'three' as const, rotulo: 'parado f21' },
    { noAnimation: false, frame: 0, bindMode: 'three' as const, rotulo: 'andar f0' },
    { noAnimation: false, frame: 2, bindMode: 'three' as const, rotulo: 'andar f2' },
  ];

  const renderers = [];
  for (const variante of variantes) {
    const renderer = await AvatarRenderer.create({
      modelUrl: AVATAR_URLS.model,
      atlas,
      atlasImage,
      size: 256,
      unlit: true,
      noAnimation: variante.noAnimation,
      bindMode: variante.bindMode,
    });
    renderer.setLook(look);
    renderers.push({ renderer, rotulo: variante.rotulo, frame: variante.frame });
  }

  const renderer = renderers[renderers.length - 1].renderer;
  const faltando = renderer.setLook(look);
  const info = renderer.describe();
  const bounds = renderer.measureBounds();

  console.info('[avatar] malhas', info.meshes, 'skinned', info.skinned, 'bones', info.bones);
  console.info('[avatar] animações', info.animations, 'nós', info.nodes.length);
  console.info('[avatar] look', look.objects.join(', '));
  console.info('[avatar] camadas de textura', look.textureLayers.join(', '));
  if (faltando.length > 0) console.warn('[avatar] símbolos ausentes no atlas', faltando);
  const uv = renderer.describeUv(80);
  const semUv = uv.filter((linha) => linha.includes('sem atributo'));
  console.info('[avatar-uv] malhas sem uv:', semUv.length, 'de', uv.length);
  for (const linha of uv.filter((l) => !l.includes('sem atributo'))) console.info('[avatar-uv]', linha);
  for (const linha of semUv.slice(0, 3)) console.info('[avatar-uv]', linha);

  const animado = renderers.find((r) => r.rotulo !== 'bind pose')?.renderer ?? renderer;
  for (const linha of animado.describeSkin('shirt01', 'Bone2', [0, 2, 20, 22, 60])) {
    console.info('[avatar-skin]', linha);
  }

  // Frames diferentes devem produzir pixels diferentes quando a animação chega ao render.

  console.info('[avatar-diff] frame 0 vs 60:', diferencaDePixels(animado, 0, 60).toFixed(2) + '%');
  console.info('[avatar-diff] frame 20 vs 22:', diferencaDePixels(animado, 20, 22).toFixed(2) + '%');
  console.info('[avatar-skin] ossos:', animado.boneNames().slice(0, 24).join(', '));
  for (const linha of animado.describeTracks(4)) console.info('[avatar-track]', linha);

  const sentido = animado.describeCameraSense();
  if (sentido) {
    console.info(
      '[avatar-camera]',
      sentido.fromAbove ? 'DE CIMA (certo)' : 'DE BAIXO (errado)',
      `pé de trás ${sentido.back}, pé da frente ${sentido.front}`,
    );
  }

  // Bone1 = Bip01_Head, Bone6 = Bip01_L_Foot, Bone2 = Bip01_Spine.
  for (const direcao of [0, 2]) {
    animado.setDirection(direcao);
    const pontos = animado.projectBones(['Bone1', 'Bone2', 'Bone6', 'Bone9'], 20);
    console.info(
      `[avatar-pose] dir ${direcao}`,
      Object.entries(pontos)
        .map(([nome, [x, y]]) => `${nome} (${x}, ${y})`)
        .join('  '),
    );
  }
  // Compara caixas das peças e variantes da bind shape matrix para diagnosticar o enquadramento.

  for (const { renderer: medidor, rotulo, frame } of renderers) {
    medidor.setDirection(0);
    for (const caixa of medidor.projectMeshBounds(frame)) {
      console.info(
        `[avatar-box ${rotulo}]`,
        caixa.name.padEnd(9),
        `y ${caixa.top}..${caixa.bottom}`,
        `x ${caixa.left}..${caixa.right}`,
      );
    }
  }

  const enquadramento = renderer.frame;
  if (enquadramento) {
    console.info(
      '[avatar] enquadramento half',
      enquadramento.half.toFixed(1),
      'centro',
      enquadramento.center.toArray().map((v) => v.toFixed(1)).join(','),
      'tamanho',
      enquadramento.size.toArray().map((v) => v.toFixed(1)).join(','),
    );
  }
  if (bounds) {
    console.info(
      '[avatar] caixa min',
      bounds.min.toArray().map(Math.round).join(','),
      'max',
      bounds.max.toArray().map(Math.round).join(','),
    );
  }

  // Folha de contato: 8 direções na horizontal, uma variante por linha.
  const lado = 256;
  const folha = document.createElement('canvas');
  folha.width = lado * 8;
  folha.height = lado * (renderers.length + 2);
  folha.style.cssText = 'position:fixed;left:0;top:0;width:100%;image-rendering:pixelated;z-index:20';

  const contexto = folha.getContext('2d');
  if (!contexto) throw new Error('sem contexto 2d para a folha de contato');
  contexto.fillStyle = '#20304a';
  contexto.fillRect(0, 0, folha.width, folha.height);

  for (let linha = 0; linha < renderers.length; linha++) {
    const { renderer: atual, rotulo, frame } = renderers[linha];
    for (let direcao = 0; direcao < 8; direcao++) {
      atual.setDirection(direcao);
      atual.setFrame(frame);
      atual.render();
      contexto.drawImage(atual.canvas, direcao * lado, linha * lado);

      contexto.fillStyle = '#8ce052';
      contexto.font = '15px monospace';
      contexto.fillText(`${rotulo} · dir ${direcao}`, direcao * lado + 6, linha * lado + 18);
    }
  }

  // Última linha: a textura 256x256 remontada e um pedaço do atlas, para ver se
  // o problema está na composição ou no mapeamento.
  const baseLinha = renderers.length * lado;
  contexto.drawImage(renderer.textureImage, 0, baseLinha);
  contexto.strokeStyle = '#8ce052';
  contexto.strokeRect(0, baseLinha, lado, lado);
  contexto.fillStyle = '#8ce052';
  contexto.fillText('textura composta', 8, baseLinha + 16);

  contexto.drawImage(atlasImage, 0, 0, 1024, 1024, lado + 8, baseLinha, lado * 2, lado * 2);
  contexto.fillText('atlas (canto superior)', lado + 16, baseLinha + 16);

  host.appendChild(folha);
  Object.assign(window, { __avatarProbe: { renderer, info, bounds, look, faltando } });
}
