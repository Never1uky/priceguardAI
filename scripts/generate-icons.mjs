import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

function createPng(size) {
  const row = Buffer.alloc(1 + size * 4);
  const raw = Buffer.alloc((1 + size * 4) * size);

  for (let y = 0; y < size; y += 1) {
    const offset = y * (1 + size * 4);
    raw[offset] = 0;
    for (let x = 0; x < size; x += 1) {
      const px = offset + 1 + x * 4;
      const center = Math.hypot(x - size / 2, y - size / 2) < size * 0.38;
      raw[px] = center ? 37 : 59;
      raw[px + 1] = center ? 99 : 130;
      raw[px + 2] = center ? 235 : 246;
      raw[px + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });

for (const size of sizes) {
  const filePath = join(outDir, `icon${size}.png`);
  await writeFile(filePath, createPng(size));
  console.log(`Created ${filePath}`);
}
