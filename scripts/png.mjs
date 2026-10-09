// Leitura e gravação de PNG em RGBA de 8 bits, sem dependências. Aceita tons de cinza, RGB, paleta (com tRNS)
// e as variantes com alfa, sem entrelaçamento; grava sempre RGBA com o filtro de cada linha escolhido pelo
// menor resíduo.
import fs from 'node:fs';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function readPng(file) {
  const buffer = fs.readFileSync(file);
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file}: não é um PNG.`);
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0, palette = null, transparency = null;
  const idat = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (depth !== 8 || !channels || interlace !== 0 || (colorType === 3 && !palette)) {
    throw new Error(`${file}: use PNG de 8 bits por canal, sem entrelaçamento.`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      if (predictor === undefined) throw new Error(`${file}: filtro PNG desconhecido.`);
      pixels[y * stride + x] = (line[x] + predictor) & 0xff;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, (i + 1) * channels), o = i * 4;
    if (colorType === 6) data.set(p, o);
    else if (colorType === 2) { data.set(p, o); data[o + 3] = 255; }
    else if (colorType === 4) { data[o] = data[o + 1] = data[o + 2] = p[0]; data[o + 3] = p[1]; }
    else if (colorType === 0) { data[o] = data[o + 1] = data[o + 2] = p[0]; data[o + 3] = 255; }
    else {
      data.set(palette.subarray(p[0] * 3, p[0] * 3 + 3), o);
      data[o + 3] = transparency && p[0] < transparency.length ? transparency[p[0]] : 255;
    }
  }
  return { width, height, data };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function writePng(file, { width, height, data }) {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height), candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    let bestFilter = 0, bestScore = Infinity, best = null;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? data[y * stride + x - 4] : 0, b = y > 0 ? data[(y - 1) * stride + x] : 0;
        const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
        const value = (data[y * stride + x] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 0xff;
        candidate[x] = value; score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) { bestScore = score; bestFilter = filter; best = Buffer.from(candidate); }
    }
    raw[y * (stride + 1)] = bestFilter;
    best.copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  fs.writeFileSync(file, Buffer.concat([SIGNATURE, chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
