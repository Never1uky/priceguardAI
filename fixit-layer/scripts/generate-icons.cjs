const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(size) {
  const width = size;
  const height = size;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      const cx = x - width / 2;
      const cy = y - height / 2;
      const r = Math.sqrt(cx * cx + cy * cy);
      if (r < width * 0.42) {
        raw[i] = 99;
        raw[i + 1] = 102;
        raw[i + 2] = 241;
        raw[i + 3] = 255;
      } else {
        raw[i] = 0;
        raw[i + 1] = 0;
        raw[i + 2] = 0;
        raw[i + 3] = 0;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
[16, 48, 128].forEach((size) => {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), createPng(size));
});
console.log("Icons written to", outDir);
