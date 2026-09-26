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
let legacyBusy = false;
const managedPosting = new Set<number>();
let managedTimer: NodeJS.Timeout | null = null;

function status(message: string) {
  win?.webContents.send('status', message);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
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

function getLegacyProducts() {
  const cfg = configStore.load();
  return scanProducts(cfg.rootFolder, db);
}

async function makeLegacyDraft(folderPath?: string): Promise<DraftPost> {
  const cfg = configStore.load();
  const products = getLegacyProducts();
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

function buildFacebookText(post: SocialPostRecord): string {
  return [post.title?.trim(), post.caption?.trim(), post.hashtags?.trim()]
    .filter(Boolean)
    .join('\n\n');
}

async function publishManagedPost(postId: number) {
  if (managedPosting.has(postId)) return { ok: false, skipped: true };
  const post = db.getSocialPost(postId);
  if (!post) throw new Error('Không tìm thấy bài đăng.');
  if (post.status === 'posted' || post.status === 'cancelled') {
    throw new Error('Bài này đã hoàn tất hoặc đã hủy.');
  }

  const imageIds = JSON.parse(post.image_ids_json || '[]') as number[];
  const images = db.resolveImagePaths(imageIds).filter(i => i.active);
  if (!images.length) throw new Error('Bài đăng chưa có ảnh hoạt động.');
  const text = buildFacebookText(post);
  if (!text.trim()) throw new Error('Bài đăng chưa có nội dung.');

  const cfg = configStore.load();
  managedPosting.add(postId);
  db.updateSocialPostStatus(postId, 'posting');
  db.addPostAttempt(postId, 'posting', 'Bắt đầu đăng Facebook');
  status(`🚀 Đang đăng Facebook: ${post.product_name || 'bài viết'}...`);

  try {
    await publishToFacebook(cfg.browserProfileDir, text, images.map(i => i.file_path));
    db.updateSocialPostStatus(postId, 'posted');
    db.addPostAttempt(postId, 'posted', 'Đăng thành công');
    db.markImagesUsed(imageIds);
    db.markContentUsed(post.content_id);
    status(`✅ Đã đăng: ${post.product_name || 'bài viết'}`);
    return { ok: true };
  } catch (e: any) {
    const message = e?.message || String(e);
    db.updateSocialPostStatus(postId, 'failed', message);
    db.addPostAttempt(postId, 'failed', message);
    status(`❌ Đăng thất bại: ${message}`);
    throw e;
  } finally {
    managedPosting.delete(postId);
  }
}

async function processDueManagedPosts() {
  if (!db) return;
  const due = db.getDueScheduledPosts(new Date().toISOString());
  for (const post of due) {
    if (managedPosting.has(post.id)) continue;
    try {
      await publishManagedPost(post.id);
    } catch {
      // Lỗi đã được lưu vào lịch sử; không retry vô hạn.
    }
  }
}

function registerManagedIpc() {
  ipcMain.handle('categories:list', () => db.listCategories());
  ipcMain.handle('categories:create', (_e, data) => {
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('Tên danh mục không được để trống.');
    return db.createCategory(name, data?.parentId ? Number(data.parentId) : null);
  });
  ipcMain.handle('categories:update', (_e, id: number, data) => {
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('Tên danh mục không được để trống.');
    return db.updateCategory(Number(id), name, data?.parentId ? Number(data.parentId) : null);
  });
  ipcMain.handle('categories:delete', (_e, id: number) => {
    db.deleteCategory(Number(id));
    return { ok: true };
  });

  ipcMain.handle('catalog:products:list', (_e, categoryId?: number | null) =>
    db.listProducts(categoryId ? Number(categoryId) : null)
  );
  ipcMain.handle('catalog:products:create', (_e, data) => {
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('Tên sản phẩm không được để trống.');
    return db.createProduct({
      categoryId: data?.categoryId ? Number(data.categoryId) : null,
      name,
      description: String(data?.description || ''),
      infoText: String(data?.infoText || ''),
      defaultHashtags: String(data?.defaultHashtags || '')
    });
  });
  ipcMain.handle('catalog:products:update', (_e, id: number, data) => {
    const name = String(data?.name || '').trim();
    if (!name) throw new Error('Tên sản phẩm không được để trống.');
    return db.updateProduct(Number(id), {
      categoryId: data?.categoryId ? Number(data.categoryId) : null,
      name,
      description: String(data?.description || ''),
      infoText: String(data?.infoText || ''),
      defaultHashtags: String(data?.defaultHashtags || ''),
      active: data?.active !== false
    });
  });
  ipcMain.handle('catalog:products:delete', (_e, id: number) => {
    db.deleteProduct(Number(id));
    return { ok: true };
  });

  ipcMain.handle('catalog:images:list', (_e, productId: number) => db.listImages(Number(productId)));
  ipcMain.handle('catalog:images:add', async (_e, productId: number) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn ảnh sản phẩm',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (r.canceled || !r.filePaths.length) return db.listImages(Number(productId));
    return db.addImages(Number(productId), r.filePaths);
  });
  ipcMain.handle('catalog:images:update', (_e, id: number, data) =>
    db.updateImage(Number(id), {
      note: data?.note,
      sortOrder: data?.sortOrder === undefined ? undefined : Number(data.sortOrder),
      active: data?.active
    })
  );
  ipcMain.handle('catalog:images:delete', (_e, id: number) => {
    db.deleteImage(Number(id));
    return { ok: true };
  });

  ipcMain.handle('content:list', (_e, productId?: number) =>
    db.listContents(productId ? Number(productId) : undefined)
  );
  ipcMain.handle('content:generate', async (_e, productId: number) => {
    const product = db.getProduct(Number(productId));
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    const images = db.listImages(product.id).filter(i => i.active);
    const result = await generateProductContent(configStore.load(), product, images, configStore.load().rootFolder || undefined);
    return db.createContent(product.id, result, 'ai');
  });
  ipcMain.handle('content:create-manual', (_e, productId: number, data) =>
    db.createContent(Number(productId), {
      title: String(data?.title || ''),
      caption: String(data?.caption || ''),
      hashtags: String(data?.hashtags || '')
    }, 'manual')
  );
  ipcMain.handle('content:update', (_e, id: number, data) =>
    db.updateContent(Number(id), {
      title: data?.title,
      caption: data?.caption,
      hashtags: data?.hashtags,
      status: data?.status
    })
  );
  ipcMain.handle('content:delete', (_e, id: number) => {
    db.deleteContent(Number(id));
    return { ok: true };
  });

  ipcMain.handle('schedule:list', () => db.listScheduledPosts());
  ipcMain.handle('schedule:create', (_e, data) => {
    const productId = Number(data?.productId);
    const contentId = Number(data?.contentId);
    const imageIds = Array.isArray(data?.imageIds) ? data.imageIds.map(Number).filter(Boolean) : [];
    if (!productId || !contentId) throw new Error('Cần chọn sản phẩm và nội dung.');
    if (!imageIds.length) throw new Error('Cần chọn ít nhất 1 ảnh.');

    let scheduledAt: string | null = null;
    if (data?.scheduledAt) {
      const d = new Date(data.scheduledAt);
      if (Number.isNaN(d.getTime())) throw new Error('Thời gian đăng không hợp lệ.');
      scheduledAt = d.toISOString();
    }
    return db.createSocialPost({
      productId,
      contentId,
      imageIds,
      scheduledAt,
      status: scheduledAt ? 'scheduled' : 'draft'
    });
  });
  ipcMain.handle('schedule:cancel', (_e, id: number) => {
    db.cancelSocialPost(Number(id));
    return { ok: true };
  });
  ipcMain.handle('schedule:post-now', async (_e, postId: number) => publishManagedPost(Number(postId)));
  ipcMain.handle('history:list', () => db.listPostHistory(200));
}

app.whenReady().then(() => {
  configStore = new ConfigStore();
  db = new AppDb();
  scheduler = new Scheduler();
  createWindow();
  registerManagedIpc();

  // Giữ tương thích luồng thư mục tự động cũ.
  scheduler.start(() => configStore.load(), async slot => {
    if (legacyBusy) return;
    const cfg = configStore.load();
    if (!cfg.rootFolder) return;
    legacyBusy = true;
    try {
      status(`⏰ Đến lịch thư mục ${slot}. AI đang tạo bài...`);
      const draft = await makeLegacyDraft();
      await postLegacyDraft(draft);
    } catch (e: any) {
      status(`❌ Lịch thư mục ${slot}: ${e?.message || e}`);
    } finally {
      legacyBusy = false;
    }
  });

  managedTimer = setInterval(() => {
    processDueManagedPosts().catch(e => status('❌ Lỗi lịch đăng: ' + (e?.message || e)));
  }, 30_000);
  processDueManagedPosts().catch(() => undefined);

  ipcMain.handle('config:get', () => configStore.load());
  ipcMain.handle('config:save', (_e, next) => configStore.save(next));
  ipcMain.handle('folder:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return configStore.save({ rootFolder: r.filePaths[0] });
  });
  ipcMain.handle('products:scan', () => getLegacyProducts());
  ipcMain.handle('draft:generate', async (_e, folderPath?: string) => makeLegacyDraft(folderPath));
  ipcMain.handle('facebook:post', async (_e, draft: DraftPost) => postLegacyDraft(draft));
  ipcMain.handle('facebook:login', async () => {
    const cfg = configStore.load();
    await openFacebookForLogin(cfg.browserProfileDir);
    return true;
  });
  ipcMain.handle('posts:recent', () => db.recentPosts(50));
});

app.on('before-quit', () => {
  if (managedTimer) clearInterval(managedTimer);
  scheduler?.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
