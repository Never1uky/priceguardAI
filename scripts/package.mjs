import { createWriteStream, copyFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8'));
const version = pkg.version;
const outFile = join(rootDir, `priceguard-ai-v${version}.zip`);
const desktopDir = join(homedir(), 'Desktop');
const desktopFile = join(desktopDir, `priceguard-ai-v${version}.zip`);

async function addDirectory(archive, dirPath, archivePath = '') {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const entryArchivePath = archivePath ? join(archivePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await addDirectory(archive, fullPath, entryArchivePath);
    } else if (entry.isFile()) {
      archive.file(fullPath, { name: entryArchivePath.replace(/\\/g, '/') });
    }
  }
}

async function ensureDistExists() {
  try {
    const info = await stat(distDir);
    if (!info.isDirectory()) {
      throw new Error('dist is not a directory');
    }
  } catch {
    throw new Error('Папка dist не найдена. Сначала выполните: npm run build');
  }
}

await ensureDistExists();

const output = createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.on('error', (error) => {
  throw error;
});

archive.pipe(output);

const distEntries = await readdir(distDir, { withFileTypes: true });
for (const entry of distEntries) {
  const fullPath = join(distDir, entry.name);
  if (entry.isDirectory()) {
    await addDirectory(archive, fullPath, entry.name);
  } else {
    archive.file(fullPath, { name: entry.name });
  }
}

await archive.finalize();

await new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
});

try {
  mkdirSync(desktopDir, { recursive: true });
  copyFileSync(outFile, desktopFile);
  console.log(`Desktop copy: ${desktopFile}`);
} catch (error) {
  console.warn('Не удалось скопировать на рабочий стол:', error);
}

console.log(`Created ${relative(rootDir, outFile)} (${archive.pointer()} bytes)`);
