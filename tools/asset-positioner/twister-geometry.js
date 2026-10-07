/* Projeção afim de paredes e pisos na geometria 2:1 do jogo. */
'use strict';
(() => {
  function validateSize(width, height) {
    if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192) || width * height > 16000000) {
      throw new Error('Use dimensões inteiras de até 8192 px por lado e 16 milhões de pixels.');
    }
  }

  function floorPlan({ width, height, mode, sizeX, sizeY, tileSize }) {
    if (![sizeX, sizeY].every((n) => Number.isInteger(n) && n >= 1 && n <= 8) ||
        !Number.isInteger(tileSize) || tileSize < 4 || tileSize > 4096 || tileSize % 4 !== 0) {
      throw new Error('Escolha uma pegada válida e uma resolução por tile múltipla de 4, entre 4 e 4096 px.');
    }
    const rectangleWidth = sizeX * tileSize, rectangleHeight = sizeY * tileSize;
    const isoWidth = (sizeX + sizeY) * tileSize / 2, isoHeight = isoWidth / 2;
    const outputWidth = mode === 'project' ? isoWidth : rectangleWidth;
    const outputHeight = mode === 'project' ? isoHeight : rectangleHeight;
    validateSize(outputWidth, outputHeight);
    const sum = sizeX + sizeY;
    // Map the rectangle's corners to back, right, front and left of the footprint.
    // For flattening, first express that footprint in the selected source box.
    const boxWidth = mode === 'project' ? isoWidth : width;
    const boxHeight = mode === 'project' ? isoHeight : height;
    const topX = boxWidth * sizeY / sum;
    const rightX = boxWidth * sizeX / sum;
    const rightY = boxHeight * sizeX / sum;
    const leftY = boxHeight * sizeY / sum;
    const floorPoints = [{ x: topX, y: 0 }, { x: boxWidth, y: rightY },
      { x: rightX, y: boxHeight }, { x: 0, y: leftY }];
    let matrix;
    if (mode === 'project') {
      matrix = [rightX / width, rightY / width, -topX / height, leftY / height, topX, 0];
    } else {
      const a = rightX / rectangleWidth, b = rightY / rectangleWidth;
      const c = -topX / rectangleHeight, d = leftY / rectangleHeight;
      const determinant = a * d - b * c;
      matrix = [d / determinant, -b / determinant, -c / determinant, a / determinant,
        -d * topX / determinant, b * topX / determinant];
    }
    return {
      type: 'floor', width: outputWidth, height: outputHeight, rectangleWidth, rectangleHeight,
      sizeX, sizeY, tileSize, matrix,
      sourcePoints: mode === 'flatten' ? floorPoints : [
        { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
      ],
    };
  }

  function plan({ width, height, mode = 'flatten', side = 'left', type = 'wall', sizeX = 1, sizeY = 1, tileSize = 160 }) {
    validateSize(width, height);
    if (!['flatten', 'project'].includes(mode) || !['wall', 'floor'].includes(type)) {
      throw new Error('Escolha um sentido de conversão e um tipo válidos.');
    }
    if (type === 'floor') return floorPlan({ width, height, mode, sizeX, sizeY, tileSize });
    if (!['left', 'right'].includes(side)) {
      throw new Error('Escolha um sentido de conversão e um lado válidos.');
    }
    const slope = side === 'left' ? .5 : -.5;
    const rise = width / 2;
    const shift = side === 'left' ? 0 : rise;
    // Odd widths need a half-pixel of transparent padding in the PNG's integer box.
    const faceHeight = mode === 'flatten' ? height - Math.ceil(rise) : height;
    if (faceHeight < 1) throw new Error('A caixa isométrica precisa ser mais alta que metade da largura. Ajuste a área de origem.');
    const outputHeight = mode === 'flatten' ? faceHeight : height + Math.ceil(rise);
    validateSize(width, outputHeight);
    const wallPoints = [
      { x: 0, y: shift }, { x: width, y: shift + slope * width },
      { x: width, y: shift + slope * width + faceHeight }, { x: 0, y: shift + faceHeight },
    ];
    return {
      type: 'wall', width, height: outputHeight, faceHeight,
      matrix: mode === 'project' ? [1, slope, 0, 1, 0, shift] : [1, -slope, 0, 1, 0, -shift],
      sourcePoints: mode === 'flatten' ? wallPoints : [
        { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
      ],
    };
  }
  globalThis.AssetTwisterGeometry = Object.freeze({ plan, validateSize });
})();
