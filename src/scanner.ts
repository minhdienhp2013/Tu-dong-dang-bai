import fs from 'fs';
import path from 'path';
import type { ProductFolder } from './types';
import { AppDb } from './db';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const INFO_NAMES = ['thongtin.txt', 'info.txt', 'mota.txt', 'description.txt'];

function readInfo(folder: string): string {
  for (const name of INFO_NAMES) {
    const file = path.join(folder, name);
    if (fs.existsSync(file)) {
      try { return fs.readFileSync(file, 'utf8').trim(); } catch { return ''; }
    }
  }
  return '';
}

export function scanProducts(rootFolder: string, db: AppDb): ProductFolder[] {
  if (!rootFolder || !fs.existsSync(rootFolder)) return [];
  const entries = fs.readdirSync(rootFolder, { withFileTypes: true }).filter(e => e.isDirectory());

  return entries.map(entry => {
    const folderPath = path.join(rootFolder, entry.name);
    const images = fs.readdirSync(folderPath)
      .filter(name => IMAGE_EXT.has(path.extname(name).toLowerCase()))
      .map(name => path.join(folderPath, name))
      .sort((a, b) => a.localeCompare(b, 'vi'));

    return {
      name: entry.name,
      folderPath,
      infoText: readInfo(folderPath),
      images,
      unusedImages: images.filter(img => !db.imageUsed(img)),
      lastPostedAt: db.getLastPostedAt(folderPath)
    };
  }).filter(p => p.images.length > 0);
}

export function chooseEligibleProduct(products: ProductFolder[], daysBeforeRepeat: number): ProductFolder | null {
  const cutoff = Date.now() - daysBeforeRepeat * 24 * 60 * 60 * 1000;
  const eligible = products.filter(p => {
    if (!p.lastPostedAt) return true;
    return new Date(p.lastPostedAt).getTime() < cutoff;
  });
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const aNew = a.unusedImages.length > 0 ? 1 : 0;
    const bNew = b.unusedImages.length > 0 ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;
    const aTime = a.lastPostedAt ? new Date(a.lastPostedAt).getTime() : 0;
    const bTime = b.lastPostedAt ? new Date(b.lastPostedAt).getTime() : 0;
    return aTime - bTime;
  });
  return eligible[0];
}

export function chooseImages(product: ProductFolder, count: number): string[] {
  const primary = product.unusedImages.length ? product.unusedImages : product.images;
  return primary.slice(0, Math.max(1, count));
}
