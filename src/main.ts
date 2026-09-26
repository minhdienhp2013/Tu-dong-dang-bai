import path from 'path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { ConfigStore } from './config';
import { AppDb } from './db';
import { scanProducts, chooseEligibleProduct, chooseImages } from './scanner';
import { generateCaption, generateProductContent } from './ai';
import { openFacebookForLogin, publishToFacebook } from './facebook';
import { Scheduler } from './scheduler';
import type { DraftPost, ProductFolder, SocialPostRecord } from './types';

let win: BrowserWindow | null = null;
let configStore: ConfigStore;
let db: AppDb;
let scheduler: Scheduler;

function status(message: string) {
  win?.webContents.send('status', message);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function getFolderProducts() {
  const cfg = configStore.load();
  return scanProducts(cfg.rootFolder, db);
}

async function makeLegacyDraft(folderPath?: string): Promise<DraftPost> {
  const cfg = configStore.load();
  const products = getFolderProducts();
  let product: ProductFolder | null = null;
  if (folderPath) product = products.find(p => p.folderPath === folderPath) || null;
  if (!product) product = chooseEligibleProduct(products, cfg.daysBeforeRepeatProduct);
  if (!product) throw new Error('Không có mặt hàng đủ điều kiện để đăng.');
  const images = chooseImages(product, cfg.imagesPerPost);
  const caption = await generateCaption(cfg, product);
  return { productName: product.name, productFolder: product.folderPath, caption, images };
}

async function postLegacyDraft(draft: DraftPost) {
  const cfg = configStore.load();
  status('Đang mở Facebook và đăng: ' + draft.productName + '...');
  try {
    await publishToFacebook(cfg.browserProfileDir, draft.caption, draft.images);
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'posted');
    status('✅ Đã đăng thành công: ' + draft.productName);
    return { ok: true };
  } catch (e: any) {
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'failed', e?.message || String(e));
    status('❌ ' + (e?.message || e));
    throw e;
  }
}

function composePostText(post: SocialPostRecord) {
  const parts: string[] = [];
  if (post.title?.trim()) parts.push(post.title.trim());
  if (post.caption?.trim()) parts.push(post.caption.trim());
  if (post.hashtags?.trim()) parts.push(post.hashtags.trim());
  return parts.join('\n\n').trim();
}

async function publishScheduledPost(postId: number) {
  const post = db.getSocialPost(postId);
  if (!post) throw new Error('Không tìm thấy bài đăng.');
  if (post.status === 'posted' || post.status === 'cancelled') {
    throw new Error('Bài này đã kết thúc và không thể đăng lại trực tiếp.');
  }

  const imageIds: number[] = JSON.parse(post.image_ids_json || '[]');
  const images = db.resolveImagePaths(imageIds);
  const filePaths = images.filter(i => i.active).map(i => i.file_path);
  const publishText = composePostText(post);
  if (!publishText) throw new Error('Bài đăng chưa có nội dung.');
  if (!filePaths.length) throw new Error('Bài đăng chưa có ảnh hoạt động.');

  const cfg = configStore.load();
  db.updateSocialPostStatus(post.id, 'posting', null);
  db.addPostAttempt(post.id, 'posting', 'Bắt đầu đăng Facebook');
  status('🚀 Đang đăng Facebook: ' + (post.product_name || ''));

  try {
    await publishToFacebook(cfg.browserProfileDir, publishText, filePaths);
    db.updateSocialPostStatus(post.id, 'posted', null);
    db.addPostAttempt(post.id, 'posted', 'Đăng thành công');
    db.markImagesUsed(imageIds);
    db.markContentUsed(post.content_id);
    status('✅ Đã đăng: ' + (post.product_name || ''));
    return db.getSocialPost(post.id);
  } catch (e: any) {
    const message = e?.message || String(e);
    db.updateSocialPostStatus(post.id, 'failed', message);
    db.addPostAttempt(post.id, 'failed', message);
    status('❌ ' + message);
    throw e;
  }
}

app.whenReady().then(() => {
  configStore = new ConfigStore();
  db = new AppDb();
  scheduler = new Scheduler();
  createWindow();

  scheduler.start(async () => {
    const due = db.getDueScheduledPosts(new Date().toISOString());
    for (const post of due) {
      try {
        await publishScheduledPost(post.id);
      } catch {
        // Failure is already persisted. Do not auto-loop retry continuously.
      }
    }
  });

  ipcMain.handle('config:get', () => configStore.load());
  ipcMain.handle('config:save', (_e, next) => configStore.save(next));

  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return configStore.save({ rootFolder: r.filePaths[0] });
  });
  ipcMain.handle('products:scan', () => getFolderProducts());

  ipcMain.handle('categories:list', () => db.listCategories());
  ipcMain.handle('categories:create', (_e, data) => db.createCategory(String(data.name || ''), data.parentId || null));
  ipcMain.handle('categories:update', (_e, id, data) => db.updateCategory(Number(id), String(data.name || ''), data.parentId || null));
  ipcMain.handle('categories:delete', (_e, id) => {
    db.deleteCategory(Number(id));
    return { ok: true };
  });

  ipcMain.handle('catalog:products:list', (_e, categoryId) => db.listProducts(categoryId ? Number(categoryId) : null));
  ipcMain.handle('catalog:products:create', (_e, data) => {
    if (!String(data.name || '').trim()) throw new Error('Tên sản phẩm không được để trống.');
    return db.createProduct(data);
  });
  ipcMain.handle('catalog:products:update', (_e, id, data) => {
    if (!String(data.name || '').trim()) throw new Error('Tên sản phẩm không được để trống.');
    return db.updateProduct(Number(id), data);
  });
  ipcMain.handle('catalog:products:delete', (_e, id) => {
    db.deleteProduct(Number(id));
    return { ok: true };
  });

  ipcMain.handle('catalog:images:list', (_e, productId) => db.listImages(Number(productId)));
  ipcMain.handle('catalog:images:add', async (_e, productId) => {
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (r.canceled) return db.listImages(Number(productId));
    return db.addImages(Number(productId), r.filePaths);
  });
  ipcMain.handle('catalog:images:update', (_e, id, data) => db.updateImage(Number(id), data));
  ipcMain.handle('catalog:images:delete', (_e, id) => {
    db.deleteImage(Number(id));
    return { ok: true };
  });

  ipcMain.handle('content:list', (_e, productId) => db.listContents(productId ? Number(productId) : undefined));
  ipcMain.handle('content:generate', async (_e, productId) => {
    const product = db.getProduct(Number(productId));
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    const images = db.listImages(product.id);
    if (!images.length) throw new Error('Hãy thêm ít nhất một ảnh trước khi AI tạo bài.');
    status('✨ AI đang viết bài cho ' + product.name + '...');
    const cfg = configStore.load();
    const result = await generateProductContent(cfg, product, images, cfg.rootFolder || undefined);
    const saved = db.createContent(product.id, result, 'ai');
    status('✅ AI đã tạo nội dung cho ' + product.name);
    return saved;
  });
  ipcMain.handle('content:create-manual', (_e, productId, data) => {
    return db.createContent(Number(productId), {
      title: String(data.title || ''),
      caption: String(data.caption || ''),
      hashtags: String(data.hashtags || '')
    }, 'manual');
  });
  ipcMain.handle('content:update', (_e, id, data) => db.updateContent(Number(id), data));
  ipcMain.handle('content:delete', (_e, id) => {
    db.deleteContent(Number(id));
    return { ok: true };
  });

  ipcMain.handle('schedule:list', () => db.listScheduledPosts());
  ipcMain.handle('schedule:create', (_e, data) => {
    if (!data.productId || !data.contentId) throw new Error('Thiếu sản phẩm hoặc nội dung.');
    const imageIds = Array.isArray(data.imageIds) ? data.imageIds.map(Number).filter(Boolean) : [];
    if (!imageIds.length) throw new Error('Hãy chọn ít nhất một ảnh.');
    let scheduledAt: string | null = null;
    if (data.scheduledAt) {
      const parsed = new Date(data.scheduledAt);
      if (Number.isNaN(parsed.getTime())) throw new Error('Thời gian đăng không hợp lệ.');
      scheduledAt = parsed.toISOString();
    }
    return db.createSocialPost({
      productId: Number(data.productId),
      contentId: Number(data.contentId),
      imageIds,
      scheduledAt,
      status: scheduledAt ? 'scheduled' : 'draft'
    });
  });
  ipcMain.handle('schedule:cancel', (_e, id) => {
    db.cancelSocialPost(Number(id));
    return { ok: true };
  });
  ipcMain.handle('schedule:post-now', async (_e, id) => publishScheduledPost(Number(id)));
  ipcMain.handle('history:list', () => db.listPostHistory(100));

  ipcMain.handle('draft:generate', async (_e, folderPath?: string) => makeLegacyDraft(folderPath));
  ipcMain.handle('facebook:post', async (_e, draft: DraftPost) => postLegacyDraft(draft));
  ipcMain.handle('facebook:login', async () => {
    const cfg = configStore.load();
    await openFacebookForLogin(cfg.browserProfileDir);
    return true;
  });
  ipcMain.handle('posts:recent', () => db.recentPosts(50));
});

app.on('before-quit', () => scheduler?.stop());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
