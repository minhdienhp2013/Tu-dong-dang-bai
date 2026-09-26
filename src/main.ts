import path from 'path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { ConfigStore } from './config';
import { AppDb } from './db';
import { scanProducts, chooseEligibleProduct, chooseImages } from './scanner';
import { generateCaption } from './ai';
import { openFacebookForLogin, publishToFacebook } from './facebook';
import { Scheduler } from './scheduler';
import type { DraftPost, ProductFolder } from './types';

let win: BrowserWindow | null = null;
let configStore: ConfigStore;
let db: AppDb;
let scheduler: Scheduler;
let busy = false;

function status(message: string) {
  win?.webContents.send('status', message);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1050,
    height: 760,
    minWidth: 900,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function getProducts() {
  const cfg = configStore.load();
  return scanProducts(cfg.rootFolder, db);
}

async function makeDraft(folderPath?: string): Promise<DraftPost> {
  const cfg = configStore.load();
  const products = getProducts();
  let product: ProductFolder | null = null;
  if (folderPath) product = products.find(p => p.folderPath === folderPath) || null;
  if (!product) product = chooseEligibleProduct(products, cfg.daysBeforeRepeatProduct);
  if (!product) throw new Error('Không có mặt hàng đủ điều kiện để đăng.');
  const images = chooseImages(product, cfg.imagesPerPost);
  const caption = await generateCaption(cfg, product);
  return { productName: product.name, productFolder: product.folderPath, caption, images };
}

async function postDraft(draft: DraftPost) {
  const cfg = configStore.load();
  status(`Đang mở Facebook và đăng: ${draft.productName}...`);
  try {
    await publishToFacebook(cfg.browserProfileDir, draft.caption, draft.images);
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'posted');
    status(`✅ Đã đăng thành công: ${draft.productName}`);
    return { ok: true };
  } catch (e: any) {
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'failed', e?.message || String(e));
    status(`❌ ${e?.message || e}`);
    throw e;
  }
}

app.whenReady().then(() => {
  configStore = new ConfigStore();
  db = new AppDb();
  scheduler = new Scheduler();
  createWindow();

  scheduler.start(() => configStore.load(), async slot => {
    if (busy) return;
    busy = true;
    try {
      status(`⏰ Đến lịch ${slot}. AI đang tạo bài...`);
      const draft = await makeDraft();
      await postDraft(draft);
    } catch (e: any) {
      status(`❌ Lịch ${slot}: ${e?.message || e}`);
    } finally {
      busy = false;
    }
  });

  ipcMain.handle('config:get', () => configStore.load());
  ipcMain.handle('config:save', (_e, next) => configStore.save(next));
  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return configStore.save({ rootFolder: r.filePaths[0] });
  });
  ipcMain.handle('products:scan', () => getProducts());
  ipcMain.handle('draft:generate', async (_e, folderPath?: string) => makeDraft(folderPath));
  ipcMain.handle('facebook:post', async (_e, draft: DraftPost) => postDraft(draft));
  ipcMain.handle('facebook:login', async () => {
    const cfg = configStore.load();
    await openFacebookForLogin(cfg.browserProfileDir);
    return true;
  });
  ipcMain.handle('posts:recent', () => db.recentPosts(50));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
