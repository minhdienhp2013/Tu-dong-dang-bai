import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, Tray
} from 'electron';
import { ConfigStore } from './config';
import { AppDb } from './db';
import { generateProductContent } from './ai';
import { checkFacebookLogin, openFacebookForLogin, publishToFacebook } from './facebook';
import { FacebookAutomationError, classifyUnknownError, isAutoRetryable } from './facebook/errors';
import { Scheduler } from './scheduler';
import { AppLogger } from './logger';
import type { ContentDraftRecord, DraftPost, PostErrorCode, ProductImageRecord, ProductRecord, RunMode, SocialPostRecord } from './types';

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let configStore: ConfigStore;
let db: AppDb;
let scheduler: Scheduler;
let logger: AppLogger;
let quitting = false;
let manualPosting = false;
const managedPosting = new Set<number>();

function status(message: string) {
  win?.webContents.send('status', message);
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function showWindow() {
  if (!win) createWindow(false);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(forceShow = false) {
  const cfg = configStore.load();
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 680,
    show: forceShow || !cfg.startMinimized,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('close', event => {
    const latest = configStore.load();
    if (!quitting && latest.minimizeToTray && latest.keepRunningInTray) {
      event.preventDefault();
      win?.hide();
      status('Ứng dụng vẫn chạy nền và tiếp tục lịch đăng.');
    }
  });
  win.on('closed', () => { win = null; });
}

function applyWindowsStartup() {
  const cfg = configStore.load();
  app.setLoginItemSettings({
    openAtLogin: cfg.autoStartWindows,
    openAsHidden: cfg.autoStartWindows && cfg.startMinimized,
    args: cfg.startMinimized ? ['--hidden'] : []
  });
}

function createTray() {
  if (tray) return;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAU0lEQVR4nGOUKP/0n4ECwESJZqoYwIJL4nkHL4aYZMVn4lyATTMucQwDcGnGJc+ET5IYQwY+FgaZAdjiGRtAVofhAkKGoMtj9QIuQ7CJMw54bgQA3owaITlF3TAAAAAASUVORK5CYII=';
  const icon = nativeImage.createFromDataURL('data:image/png;base64,' + png);
  tray = new Tray(icon);
  tray.setToolTip('Auto Social Minh Điến');
  tray.on('double-click', showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const cfg = configStore.load();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở Auto Social', click: showWindow },
    { type: 'separator' },
    {
      label: cfg.schedulerPaused ? 'Tiếp tục lịch' : 'Tạm dừng tự động đăng',
      click: () => {
        const next = configStore.save({ schedulerPaused: !cfg.schedulerPaused });
        logger.write(next.schedulerPaused ? 'SCHEDULER_PAUSED' : 'SCHEDULER_RESUMED');
        refreshTrayMenu();
        status(next.schedulerPaused ? '⏸ Đã tạm dừng lịch' : '▶ Đã tiếp tục lịch');
      }
    },
    { label: 'Đăng bài tiếp theo', click: () => void runNextNow() },
    { type: 'separator' },
    {
      label: 'Thoát',
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
}

function mediaRoot() {
  return path.join(app.getPath('userData'), 'media', 'products');
}

function productMediaDir(productId: number) {
  return path.join(mediaRoot(), String(productId));
}

function isManagedMediaPath(filePath: string) {
  const rel = path.relative(mediaRoot(), filePath);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function copyImageIntoLibrary(productId: number, sourcePath: string) {
  if (!fs.existsSync(sourcePath)) throw new Error('Không tìm thấy ảnh đã chọn: ' + sourcePath);
  const ext = path.extname(sourcePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    throw new Error('Định dạng ảnh không hỗ trợ: ' + ext);
  }
  const dir = productMediaDir(productId);
  fs.mkdirSync(dir, { recursive: true });
  const destination = path.join(dir, randomUUID() + ext);
  fs.copyFileSync(sourcePath, destination);
  return destination;
}

function migrateLegacyProductImages() {
  let migrated = 0;
  for (const product of db.listProducts()) {
    for (const image of db.listImages(product.id)) {
      if (!image.file_path || isManagedMediaPath(image.file_path) || !fs.existsSync(image.file_path)) continue;
      try {
        const destination = copyImageIntoLibrary(product.id, image.file_path);
        db.updateImagePath(image.id, destination);
        migrated++;
      } catch {
        // Giữ bản ghi cũ nếu file nguồn không thể copy; UI sẽ cho người dùng thêm lại ảnh.
      }
    }
  }
  return migrated;
}

type PostingCandidate = {
  product: ProductRecord;
  content: ContentDraftRecord;
  images: ProductImageRecord[];
  lastPostedAt: string | null;
};

function usableImages(rows: ProductImageRecord[], reuseAfterDays: number, count: number) {
  const active = rows.filter(image => !!image.active && fs.existsSync(image.file_path));
  const unused = active.filter(image => Number(image.used_count || 0) === 0);
  if (unused.length) return unused.slice(0, Math.max(1, count));

  const cutoff = Date.now() - reuseAfterDays * 86400000;
  return active
    .filter(image => !image.last_used_at || new Date(image.last_used_at).getTime() <= cutoff)
    .slice(0, Math.max(1, count));
}

function getPostingCandidates(): PostingCandidate[] {
  return db.listProducts()
    .filter(product => !!product.active)
    .map(product => {
      const contents = db.listContents(product.id).filter(content => content.status !== 'used');
      const content = contents.find(item => item.status === 'approved') || contents.find(item => item.status === 'draft');
      if (!content) return null;

      const images = db.listImages(product.id).filter(image => !!image.active && fs.existsSync(image.file_path));
      if (!images.length) return null;

      return {
        product,
        content,
        images,
        lastPostedAt: db.getProductLastPostedAt(product.id)
      } satisfies PostingCandidate;
    })
    .filter((item): item is PostingCandidate => !!item);
}

function choosePostingCandidate(candidates: PostingCandidate[], daysBeforeRepeat: number, imageReuseAfterDays: number) {
  const cutoff = Date.now() - daysBeforeRepeat * 86400000;
  const eligible = candidates.filter(item => {
    if (item.lastPostedAt && new Date(item.lastPostedAt).getTime() >= cutoff) return false;
    return usableImages(item.images, imageReuseAfterDays, 1).length > 0;
  });

  eligible.sort((a, b) => {
    const aUnused = a.images.some(image => Number(image.used_count || 0) === 0) ? 1 : 0;
    const bUnused = b.images.some(image => Number(image.used_count || 0) === 0) ? 1 : 0;
    if (aUnused !== bUnused) return bUnused - aUnused;
    const aTime = a.lastPostedAt ? new Date(a.lastPostedAt).getTime() : 0;
    const bTime = b.lastPostedAt ? new Date(b.lastPostedAt).getTime() : 0;
    return aTime - bTime;
  });

  return eligible[0] || null;
}

function selectedStylePrompt() {
  const cfg = configStore.load();
  const styles = db.listStyles();
  const style = styles.find(s => s.id === cfg.defaultStyleId) || styles.find(s => s.is_default) || styles.find(s => s.enabled);
  return style?.prompt || cfg.stylePrompt;
}

async function makeDraft(productId?: number): Promise<DraftPost> {
  const cfg = configStore.load();
  const candidates = getPostingCandidates();
  const preferred = productId ? candidates.find(item => item.product.id === productId) || null : null;
  const selected = preferred || choosePostingCandidate(candidates, cfg.daysBeforeRepeatProduct, cfg.imageReuseAfterDays);

  if (!selected) {
    notify('Auto Social Minh Điến', '📦 Chưa có sản phẩm đủ điều kiện để đăng.');
    throw new Error(
      'Chưa có sản phẩm đủ điều kiện. Trong app cần: sản phẩm đang hoạt động, ít nhất 1 ảnh đang dùng, ít nhất 1 nội dung Nháp/Đã duyệt, và không nằm trong thời gian chống lặp.'
    );
  }

  const selectedImages = usableImages(selected.images, cfg.imageReuseAfterDays, cfg.imagesPerPost);
  if (!selectedImages.length) {
    throw new Error('Ảnh của sản phẩm chưa đủ điều kiện dùng lại theo cài đặt hiện tại.');
  }

  const caption = [
    selected.content.title?.trim(),
    selected.content.caption?.trim(),
    selected.content.hashtags?.trim()
  ].filter(Boolean).join('\n\n');

  if (!caption.trim()) throw new Error('Nội dung của sản phẩm đang trống.');

  logger.write('CONTENT_SELECTED', {
    product: selected.product.name,
    productId: selected.product.id,
    contentId: selected.content.id,
    images: selectedImages.length
  });

  return {
    productId: selected.product.id,
    contentId: selected.content.id,
    imageIds: selectedImages.map(image => image.id),
    productName: selected.product.name,
    productFolder: `catalog:${selected.product.id}`,
    caption,
    aiOriginal: selected.content.ai_original || selected.content.caption,
    images: selectedImages.map(image => image.file_path),
    mode: cfg.runMode
  };
}

function resolvedDraftImageIds(draft: DraftPost) {
  if (draft.productId) {
    return db.listImages(draft.productId)
      .filter(image => draft.images.includes(image.file_path))
      .map(image => image.id);
  }
  return draft.imageIds || [];
}

function errorInfo(error: unknown): { code: PostErrorCode; message: string } {
  if (error instanceof FacebookAutomationError) return { code: error.code, message: error.message };
  return { code: classifyUnknownError(error), message: String((error as any)?.message || error) };
}

function retryAt(retryCount: number) {
  const ms = retryCount === 1 ? 30_000 : 120_000;
  return new Date(Date.now() + ms).toISOString();
}

async function executeScheduledJob(jobId: number, draft: DraftPost) {
  const cfg = configStore.load();
  const mode = draft.mode || cfg.runMode;
  db.updateScheduledJob(jobId, {
    status: 'preparing',
    productName: draft.productName,
    productFolder: draft.productFolder,
    caption: draft.caption,
    images: draft.images
  });
  logger.write('SCHEDULE_PRODUCT_SELECTED', { product: draft.productName, mode, images: draft.images.length });

  try {
    db.updateScheduledJob(jobId, { status: 'posting' });
    logger.write('FACEBOOK_OPENED', { product: draft.productName, mode });
    const result = await publishToFacebook(cfg.browserProfileDir, draft.caption, draft.images, mode);
    logger.write('IMAGES_UPLOADED', { count: draft.images.length });

    if (result.posted) {
      db.updateScheduledJob(jobId, { status: 'posted', completed: true, errorCode: null, errorMessage: null });
      db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'posted', undefined, {
        mode, aiOriginal: draft.aiOriginal, userFinal: draft.caption, jobKey: draft.jobKey || null
      });
      const usedImageIds = resolvedDraftImageIds(draft);
      if (usedImageIds.length) db.markImagesUsed(usedImageIds);
      if (draft.contentId) db.markContentUsed(draft.contentId);
      db.addLearning(draft.productName, draft.aiOriginal || draft.caption, draft.caption);
      logger.write('POST_SUCCESS', { product: draft.productName });
      notify('Auto Social Minh Điến', `✅ Đã đăng ${draft.productName} lên Facebook.`);
      status(`✅ Đã đăng thành công: ${draft.productName}`);
    } else {
      db.updateScheduledJob(jobId, { status: 'prepared', completed: true, errorCode: null, errorMessage: null });
      db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'prepared', undefined, {
        mode: 'test', aiOriginal: draft.aiOriginal, userFinal: draft.caption, jobKey: draft.jobKey || null
      });
      logger.write('TEST_PREPARED', { product: draft.productName });
      status('🧪 TEST MODE: Bài đã được chuẩn bị. Hãy kiểm tra và tự bấm Đăng.');
      notify('Auto Social Minh Điến', '🧪 TEST MODE: Bài đã chuẩn bị xong. Hãy kiểm tra và tự bấm Đăng.');
    }
  } catch (error) {
    const info = errorInfo(error);
    const row = db.getScheduledJob(jobId);
    const retryCount = Number(row?.retry_count || 0) + 1;
    const uncertain = info.code === 'POST_UNCERTAIN';
    const canRetry = !uncertain && mode === 'auto' && isAutoRetryable(info.code) && retryCount <= 2;

    db.updateScheduledJob(jobId, {
      status: uncertain ? 'uncertain' : 'failed',
      errorCode: info.code,
      errorMessage: info.message,
      retryCount,
      nextRetryAt: canRetry ? retryAt(retryCount) : null
    });
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, uncertain ? 'uncertain' : 'failed', info.message, {
      mode, errorCode: info.code, aiOriginal: draft.aiOriginal, userFinal: draft.caption, jobKey: draft.jobKey || null
    });
    logger.write(uncertain ? 'POST_UNCERTAIN' : 'POST_FAILED', {
      product: draft.productName, code: info.code, retryCount, autoRetry: canRetry
    });

    if (uncertain) {
      notify('Auto Social Minh Điến', '⚠ Đã bấm Đăng nhưng chưa xác nhận chắc chắn. Hãy kiểm tra trang cá nhân.');
      status('⚠ Cần kiểm tra thủ công: ' + info.message);
    } else if (info.code === 'SECURITY_CHECK') {
      notify('Auto Social Minh Điến', '⚠ Facebook yêu cầu xác minh. Hãy mở ứng dụng và xử lý thủ công.');
      status(`❌ ${info.message}`);
    } else {
      notify('Auto Social Minh Điến', `❌ Đăng thất bại: ${draft.productName}`);
      status(`❌ ${info.message}`);
    }
    throw error;
  }
}

function localDateKey(now: Date) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function slotDue(slot: string, now: Date) {
  const match = /^(\d{2}):(\d{2})$/.exec(slot);
  if (!match) return false;
  const target = new Date(now);
  target.setHours(Number(match[1]), Number(match[2]), 0, 0);
  const delta = now.getTime() - target.getTime();
  return delta >= 0 && delta < 5 * 60_000;
}

async function processConfiguredSlots() {
  const cfg = configStore.load();
  if (!cfg.autoPostEnabled || cfg.schedulerPaused) return;
  const now = new Date();

  for (const slot of cfg.postingTimes) {
    if (!slotDue(slot, now)) continue;
    const jobKey = `slot:${localDateKey(now)}:${slot}`;
    const jobId = db.claimScheduledJob(jobKey, `${localDateKey(now)} ${slot}`, cfg.runMode);
    if (!jobId) continue;

    logger.write('SCHEDULE_TRIGGER', { slot, jobKey, mode: cfg.runMode });
    try {
      const draft = await makeDraft();
      draft.jobKey = jobKey;
      draft.mode = cfg.runMode;
      await executeScheduledJob(jobId, draft);
    } catch (error) {
      const info = errorInfo(error);
      const existing = db.getScheduledJob(jobId);
      if (existing && existing.status === 'pending') {
        db.updateScheduledJob(jobId, {
          status: 'failed',
          errorCode: info.code,
          errorMessage: info.message,
          completed: true
        });
        logger.write('SCHEDULE_PREPARE_FAILED', { jobKey, code: info.code });
      }
      if (info.code === 'AI_ERROR') notify('Auto Social Minh Điến', '🤖 AI không tạo được bài.');
    }
  }
}

async function processNetworkRetries() {
  const cfg = configStore.load();
  if (!cfg.autoPostEnabled || cfg.schedulerPaused || cfg.runMode !== 'auto') return;
  const rows = db.getRetryableJobs(new Date().toISOString());
  for (const row of rows) {
    const images = JSON.parse(row.images_json || '[]') as string[];
    const productMatch = /^catalog:(\d+)$/.exec(String(row.product_folder || ''));
    const productId = productMatch ? Number(productMatch[1]) : undefined;
    const imageIds = productId
      ? db.listImages(productId).filter(image => images.includes(image.file_path)).map(image => image.id)
      : [];
    const draft: DraftPost = {
      productId,
      imageIds,
      productName: row.product_name || 'Sản phẩm',
      productFolder: row.product_folder || '',
      caption: row.caption || '',
      aiOriginal: row.caption || '',
      images,
      mode: 'auto',
      jobKey: row.job_key
    };
    try {
      await executeScheduledJob(Number(row.id), draft);
    } catch {
      // executeScheduledJob đã lưu lỗi và giới hạn retry.
    }
  }
}

async function processManagedPosts() {
  const cfg = configStore.load();
  if (cfg.schedulerPaused) return;
  const now = new Date().toISOString();
  const due = db.getDueScheduledPosts(now);
  for (const post of due) {
    if (managedPosting.has(post.id)) continue;
    await publishManagedPost(post.id).catch(() => undefined);
  }
  const retryable = db.getRetryableSocialPosts(now);
  for (const post of retryable) {
    if (managedPosting.has(post.id)) continue;
    await publishManagedPost(post.id).catch(() => undefined);
  }
}

async function publishManagedPost(postId: number) {
  if (managedPosting.has(postId)) return { ok: false, skipped: true };
  const post = db.getSocialPost(postId);
  if (!post) throw new Error('Không tìm thấy bài đăng.');
  if (post.status === 'posted' || post.status === 'cancelled' || post.status === 'uncertain') {
    throw new Error('Bài này đã hoàn tất, đã hủy hoặc cần kiểm tra thủ công.');
  }

  const imageIds = JSON.parse(post.image_ids_json || '[]') as number[];
  const images = db.resolveImagePaths(imageIds).filter(i => i.active);
  if (!images.length) throw new Error('Bài đăng chưa có ảnh hoạt động.');
  const text = [post.title?.trim(), post.caption?.trim(), post.hashtags?.trim()].filter(Boolean).join('\n\n');
  if (!text.trim()) throw new Error('Bài đăng chưa có nội dung.');

  const cfg = configStore.load();
  const mode = post.mode || cfg.runMode;
  managedPosting.add(postId);
  db.updateSocialPostStatus(postId, 'posting');
  db.addPostAttempt(postId, 'posting', 'Bắt đầu đăng Facebook');
  logger.write('MANAGED_POST_START', { postId, product: post.product_name, mode });

  try {
    const result = await publishToFacebook(cfg.browserProfileDir, text, images.map(i => i.file_path), mode);
    if (result.posted) {
      db.updateSocialPostStatus(postId, 'posted');
      db.addPostAttempt(postId, 'posted', 'Đăng thành công');
      db.markImagesUsed(imageIds);
      db.markContentUsed(post.content_id);
      if (post.content_id) {
        const content = db.listContents(post.product_id).find(c => c.id === post.content_id);
        if (content?.ai_original) db.addLearning(post.product_name || '', content.ai_original, content.caption);
      }
      notify('Auto Social Minh Điến', `✅ Đã đăng ${post.product_name || 'bài viết'} lên Facebook.`);
      status(`✅ Đã đăng: ${post.product_name || 'bài viết'}`);
    } else {
      db.updateSocialPostStatus(postId, 'prepared');
      db.addPostAttempt(postId, 'prepared', 'TEST MODE: đã chuẩn bị, chưa click Đăng');
      status('🧪 TEST MODE: Bài đã được chuẩn bị. Hãy kiểm tra và tự bấm Đăng.');
    }
    return { ok: true, posted: result.posted };
  } catch (error) {
    const info = errorInfo(error);
    const latest = db.getSocialPost(postId);
    const nextRetry = Number(latest?.retry_count || 0) + 1;
    const uncertain = info.code === 'POST_UNCERTAIN';
    const canRetry = !uncertain && mode === 'auto' && isAutoRetryable(info.code) && nextRetry <= 2;
    db.updateSocialPostStatus(postId, uncertain ? 'uncertain' : 'failed', info.message, info.code);
    db.bumpSocialPostRetry(postId, nextRetry, canRetry ? retryAt(nextRetry) : null);
    db.addPostAttempt(postId, uncertain ? 'uncertain' : 'failed', `${info.code}: ${info.message}`);
    logger.write(uncertain ? 'MANAGED_POST_UNCERTAIN' : 'MANAGED_POST_FAILED', {
      postId, code: info.code, retryCount: nextRetry
    });
    if (uncertain) notify('Auto Social Minh Điến', '⚠ Bài có trạng thái chưa chắc chắn. Hãy kiểm tra trang cá nhân.');
    else if (info.code === 'SECURITY_CHECK') notify('Auto Social Minh Điến', '⚠ Facebook yêu cầu xác minh.');
    else notify('Auto Social Minh Điến', '❌ Đăng Facebook thất bại.');
    throw error;
  } finally {
    managedPosting.delete(postId);
  }
}

async function postDraft(draft: DraftPost) {
  if (manualPosting) throw new Error('Đang có một bài khác được xử lý.');
  manualPosting = true;
  const cfg = configStore.load();
  const mode = draft.mode || cfg.runMode;
  try {
    const result = await publishToFacebook(cfg.browserProfileDir, draft.caption, draft.images, mode);
    if (result.posted) {
      db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'posted', undefined, {
        mode, aiOriginal: draft.aiOriginal, userFinal: draft.caption
      });
      const usedImageIds = resolvedDraftImageIds(draft);
      if (usedImageIds.length) db.markImagesUsed(usedImageIds);
      if (draft.contentId) db.markContentUsed(draft.contentId);
      db.addLearning(draft.productName, draft.aiOriginal || draft.caption, draft.caption);
      notify('Auto Social Minh Điến', `✅ Đã đăng ${draft.productName} lên Facebook.`);
    } else {
      db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, 'prepared', undefined, {
        mode: 'test', aiOriginal: draft.aiOriginal, userFinal: draft.caption
      });
      db.addLearning(draft.productName, draft.aiOriginal || draft.caption, draft.caption);
      status('🧪 TEST MODE: Bài đã được chuẩn bị. Hãy kiểm tra và tự bấm Đăng.');
    }
    return result;
  } catch (error) {
    const info = errorInfo(error);
    const uncertain = info.code === 'POST_UNCERTAIN';
    db.markPost(draft.productName, draft.productFolder, draft.caption, draft.images, uncertain ? 'uncertain' : 'failed', info.message, {
      mode, errorCode: info.code, aiOriginal: draft.aiOriginal, userFinal: draft.caption
    });
    if (uncertain) {
      notify('Auto Social Minh Điến', '⚠ Đã bấm Đăng nhưng chưa xác nhận chắc chắn. Hãy kiểm tra trang cá nhân.');
    } else if (info.code === 'SECURITY_CHECK') {
      notify('Auto Social Minh Điến', '⚠ Facebook yêu cầu xác minh.');
    }
    throw error;
  } finally {
    manualPosting = false;
  }
}

async function runNextNow() {
  if (manualPosting) return;
  try {
    const draft = await makeDraft();
    await postDraft(draft);
  } catch (error: any) {
    status('❌ ' + (error?.message || error));
  }
}

function nextScheduleInfo() {
  const cfg = configStore.load();
  const now = new Date();
  const candidates = cfg.postingTimes
    .map(slot => {
      const [h, m] = slot.split(':').map(Number);
      const d = new Date(now);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return { slot, at: d };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] || null;
}

function registerIpc() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('config:get', () => {
    const cfg = configStore.load();
    return { ...cfg, deepseekApiKey: '', hasDeepseekApiKey: !!cfg.deepseekApiKey };
  });
  ipcMain.handle('config:save', (_e, next) => {
    const incoming = { ...(next || {}) };
    if (!String(incoming.deepseekApiKey || '').trim()) {
      delete incoming.deepseekApiKey;
    }
    const saved = configStore.save(incoming);
    applyWindowsStartup();
    refreshTrayMenu();
    return { ...saved, deepseekApiKey: '', hasDeepseekApiKey: !!saved.deepseekApiKey };
  });
  ipcMain.handle('draft:generate', async (_e, productId?: number) => makeDraft(productId ? Number(productId) : undefined));
  ipcMain.handle('facebook:post', async (_e, draft: DraftPost) => postDraft(draft));
  ipcMain.handle('facebook:login', async () => {
    await openFacebookForLogin(configStore.load().browserProfileDir);
    return true;
  });
  ipcMain.handle('facebook:status', () => checkFacebookLogin(configStore.load().browserProfileDir));
  ipcMain.handle('posts:recent', () => db.recentPosts(100));
  ipcMain.handle('scheduler:pause', () => {
    const saved = configStore.save({ schedulerPaused: true });
    refreshTrayMenu();
    return saved;
  });
  ipcMain.handle('scheduler:resume', () => {
    const saved = configStore.save({ schedulerPaused: false });
    refreshTrayMenu();
    return saved;
  });
  ipcMain.handle('scheduler:post-next', () => runNextNow());

  ipcMain.handle('categories:list', () => db.listCategories());
  ipcMain.handle('categories:create', (_e, data) => db.createCategory(String(data?.name || '').trim(), data?.parentId ? Number(data.parentId) : null));
  ipcMain.handle('categories:update', (_e, id: number, data) => db.updateCategory(Number(id), String(data?.name || '').trim(), data?.parentId ? Number(data.parentId) : null));
  ipcMain.handle('categories:delete', (_e, id: number) => { db.deleteCategory(Number(id)); return { ok: true }; });

  ipcMain.handle('catalog:products:list', (_e, categoryId?: number | null) => db.listProducts(categoryId ? Number(categoryId) : null));
  ipcMain.handle('catalog:products:create', (_e, data) => db.createProduct({
    categoryId: data?.categoryId ? Number(data.categoryId) : null,
    name: String(data?.name || '').trim(),
    description: String(data?.description || ''),
    infoText: String(data?.infoText || ''),
    defaultHashtags: String(data?.defaultHashtags || '')
  }));
  ipcMain.handle('catalog:products:update', (_e, id: number, data) => db.updateProduct(Number(id), {
    categoryId: data?.categoryId ? Number(data.categoryId) : null,
    name: String(data?.name || '').trim(),
    description: String(data?.description || ''),
    infoText: String(data?.infoText || ''),
    defaultHashtags: String(data?.defaultHashtags || ''),
    active: data?.active !== false
  }));
  ipcMain.handle('catalog:products:delete', (_e, id: number) => {
    const productId = Number(id);
    db.deleteProduct(productId);
    fs.rmSync(productMediaDir(productId), { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('catalog:images:list', (_e, productId: number) => db.listImages(Number(productId)));
  ipcMain.handle('catalog:images:add', async (_e, productId: number) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Chọn ảnh sản phẩm', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (r.canceled) return db.listImages(Number(productId));
    const managedPaths = r.filePaths.map(filePath => copyImageIntoLibrary(Number(productId), filePath));
    return db.addImages(Number(productId), managedPaths);
  });
  ipcMain.handle('catalog:images:update', (_e, id: number, data) => db.updateImage(Number(id), {
    note: data?.note, sortOrder: data?.sortOrder === undefined ? undefined : Number(data.sortOrder), active: data?.active
  }));
  ipcMain.handle('catalog:images:delete', (_e, id: number) => {
    const imageId = Number(id);
    const image = db.getImage(imageId);
    db.deleteImage(imageId);
    if (image?.file_path && isManagedMediaPath(image.file_path)) {
      fs.rmSync(image.file_path, { force: true });
    }
    return { ok: true };
  });

  ipcMain.handle('content:list', (_e, productId?: number) => db.listContents(productId ? Number(productId) : undefined));
  ipcMain.handle('content:generate', async (_e, productId: number) => {
    const product = db.getProduct(Number(productId));
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    const images = db.listImages(product.id).filter(i => i.active);
    const result = await generateProductContent(
      configStore.load(), product, images,
      db.recentLearning(10, product.name), selectedStylePrompt()
    );
    return db.createContent(product.id, result, 'ai', result.caption, configStore.load().defaultStyleId);
  });
  ipcMain.handle('content:create-manual', (_e, productId: number, data) => db.createContent(Number(productId), {
    title: String(data?.title || ''), caption: String(data?.caption || ''), hashtags: String(data?.hashtags || '')
  }, 'manual'));
  ipcMain.handle('content:update', (_e, id: number, data) => db.updateContent(Number(id), {
    title: data?.title, caption: data?.caption, hashtags: data?.hashtags, status: data?.status
  }));
  ipcMain.handle('content:delete', (_e, id: number) => { db.deleteContent(Number(id)); return { ok: true }; });

  ipcMain.handle('schedule:list', () => db.listScheduledPosts());
  ipcMain.handle('schedule:create', (_e, data) => {
    const scheduledAt = data?.scheduledAt ? new Date(data.scheduledAt) : null;
    const localKey = scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? String(data.scheduledAt) : null;
    return db.createSocialPost({
      productId: Number(data.productId), contentId: Number(data.contentId),
      imageIds: Array.isArray(data.imageIds) ? data.imageIds.map(Number).filter(Boolean) : [],
      scheduledAt: scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt.toISOString() : null,
      scheduledLocalKey: localKey, mode: data?.mode === 'auto' ? 'auto' : configStore.load().runMode,
      status: scheduledAt ? 'scheduled' : 'draft'
    });
  });
  ipcMain.handle('schedule:cancel', (_e, id: number) => { db.cancelSocialPost(Number(id)); return { ok: true }; });
  ipcMain.handle('schedule:post-now', (_e, id: number) => publishManagedPost(Number(id)));
  ipcMain.handle('history:list', () => db.listPostHistory(200));

  ipcMain.handle('styles:list', () => db.listStyles());
  ipcMain.handle('styles:create', (_e, data) => db.createStyle(String(data?.name || ''), String(data?.prompt || '')));
  ipcMain.handle('styles:update', (_e, id: number, data) => db.updateStyle(Number(id), data || {}));
  ipcMain.handle('styles:delete', (_e, id: number) => { db.deleteStyle(Number(id)); return { ok: true }; });
  ipcMain.handle('styles:set-default', (_e, id: number) => {
    db.setDefaultStyle(Number(id));
    const saved = configStore.save({ defaultStyleId: Number(id) });
    return { styles: db.listStyles(), config: saved };
  });

  ipcMain.handle('dashboard:get', async () => {
    const cfg = configStore.load();
    const candidates = getPostingCandidates();
    const selected = choosePostingCandidate(candidates, cfg.daysBeforeRepeatProduct, cfg.imageReuseAfterDays);
    const inv = db.catalogInventoryStats();
    const next = nextScheduleInfo();
    const summary = db.dashboardSummary(next?.at.toISOString() || null, selected?.product.name || null);
    return { ...summary, ...inv, mode: cfg.runMode, paused: cfg.schedulerPaused };
  });
  ipcMain.handle('app:log-path', () => logger.getPath());
}

app.on('second-instance', () => showWindow());

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    configStore = new ConfigStore();
    db = new AppDb();
    logger = new AppLogger();
    scheduler = new Scheduler();

    const migratedImages = migrateLegacyProductImages();
    db.recoverInterruptedJobs();
    logger.write('APP_START', { version: app.getVersion(), migratedImages });
    applyWindowsStartup();
    createTray();
    registerIpc();

    const hiddenArg = process.argv.includes('--hidden');
    createWindow(!hiddenArg && !configStore.load().startMinimized);

    scheduler.start(async () => {
      await processNetworkRetries();
      await processManagedPosts();
      await processConfiguredSlots();
    }, 15_000);
  });
}

app.on('before-quit', () => {
  quitting = true;
  scheduler?.stop();
});

app.on('window-all-closed', () => {
  const cfg = configStore?.load();
  if (process.platform !== 'darwin' && (!cfg?.keepRunningInTray || !tray)) {
    quitting = true;
    app.quit();
  }
});
