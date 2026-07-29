/**
 * Brand icons & CWS promo banners from master PNG (shield + P + AI).
 * Usage: npm run icons
 *
 * Master: docs/store-assets/icons/brand-master-source.png
 * Outputs:
 *   docs/store-assets/icons/brand-master-1024.png
 *   public/icons/icon{16,32,48,128}.png
 *   docs/store-assets/icons/store-icon-128.png
 *   docs/store-assets/icons/small-promo-440x280.png
 *   docs/store-assets/icons/marquee-1400x560.png
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const uiOutDir = join(root, 'public', 'icons');
const storeOutDir = join(root, 'docs', 'store-assets', 'icons');
const masterSource = join(storeOutDir, 'brand-master-source.png');
const master1024 = join(storeOutDir, 'brand-master-1024.png');
const uiSizes = [16, 32, 48, 128];

/** Tighter center crop for toolbar readability */
const CROP_BY_SIZE = {
  16: 0.86,
  32: 0.9,
  48: 0.94,
  128: 1,
};

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function buildMaster1024() {
  if (!(await fileExists(masterSource))) {
    throw new Error(
      `Missing ${masterSource}. Add brand-master-source.png (shield + P + AI reference).`,
    );
  }

  await sharp(masterSource)
    .resize(1024, 1024, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toFile(master1024);

  console.log(`Created ${master1024}`);
}

async function createSquareIcon(size) {
  const crop = CROP_BY_SIZE[size] ?? 1;
  let pipeline = sharp(master1024);

  if (crop < 1) {
    const meta = await sharp(master1024).metadata();
    const w = meta.width ?? 1024;
    const h = meta.height ?? 1024;
    const cw = Math.round(w * crop);
    const ch = Math.round(h * crop);
    pipeline = sharp(master1024).extract({
      left: Math.round((w - cw) / 2),
      top: Math.round((h - ch) / 2),
      width: cw,
      height: ch,
    });
  }

  return pipeline
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function createPromoBanner(width, height) {
  const isWide = width >= 1000;
  const logoSize = Math.round(height * (isWide ? 0.72 : 0.64));
  const logoX = isWide ? 64 : 18;
  const logoY = Math.round((height - logoSize) / 2);
  const textX = logoX + logoSize + (isWide ? 40 : 14);
  const titleSize = isWide ? 52 : 24;
  const subSize = isWide ? 20 : 10;
  const subLine2Size = isWide ? 18 : 9;
  const titleY = Math.round(height * (isWide ? 0.4 : 0.38));
  const sub1Y = Math.round(height * (isWide ? 0.56 : 0.56));
  const sub2Y = Math.round(height * (isWide ? 0.7 : 0.72));

  const logoPng = await sharp(master1024)
    .resize(logoSize, logoSize, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const logoB64 = logoPng.toString('base64');

  const title = escapeXml('PriceGuard AI');
  const sub1 = escapeXml('Сравнение цен WB · Ozon · Маркет');
  const sub2 = escapeXml('+ AI и алерты');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="22%" cy="48%" r="75%">
      <stop offset="0%" stop-color="#0f766e" stop-opacity="0.35"/>
      <stop offset="55%" stop-color="#0B161A" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#0B161A" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="#0B161A"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <image href="data:image/png;base64,${logoB64}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}"/>
  <text x="${textX}" y="${titleY}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="#FFFFFF">${title}</text>
  <text x="${textX}" y="${sub1Y}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif" font-size="${subSize}" fill="#2DD4BF">${sub1}</text>
  <text x="${textX}" y="${sub2Y}" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif" font-size="${subLine2Size}" fill="#94a3b8">${sub2}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

await mkdir(uiOutDir, { recursive: true });
await mkdir(storeOutDir, { recursive: true });

await buildMaster1024();

for (const size of uiSizes) {
  const filePath = join(uiOutDir, `icon${size}.png`);
  await writeFile(filePath, await createSquareIcon(size));
  console.log(`Created ${filePath}`);
}

const store128 = join(storeOutDir, 'store-icon-128.png');
await writeFile(store128, await createSquareIcon(128));
console.log(`Created ${store128}`);

const smallPromo = join(storeOutDir, 'small-promo-440x280.png');
await writeFile(smallPromo, await createPromoBanner(440, 280));
console.log(`Created ${smallPromo}`);

const marquee = join(storeOutDir, 'marquee-1400x560.png');
await writeFile(marquee, await createPromoBanner(1400, 560));
console.log(`Created ${marquee}`);
