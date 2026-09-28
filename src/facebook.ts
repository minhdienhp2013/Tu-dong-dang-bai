import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { chromium, BrowserContext, Locator, Page } from 'playwright-core';
import type { FacebookLoginStatus, FacebookPublishResult, RunMode } from './types';
import {
  FACEBOOK_SELECTORS, FACEBOOK_URLS, LOGIN_PAGE_SIGNALS, POST_FAILURE_SIGNALS, SECURITY_SIGNALS
} from './facebook/selectors';
import { FacebookAutomationError, classifyUnknownError } from './facebook/errors';

function normalizeVisibleText(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function bodyText(page: Page) {
  return normalizeVisibleText(await page.locator('body').innerText().catch(() => ''));
}

async function detectSecurityGate(page: Page): Promise<string | null> {
  const body = await bodyText(page);
  return SECURITY_SIGNALS.find(signal => body.includes(signal)) || null;
}

async function detectPostFailure(page: Page): Promise<string | null> {
  const body = await bodyText(page);
  return POST_FAILURE_SIGNALS.find(signal => body.includes(signal)) || null;
}

async function isLoginPage(page: Page): Promise<boolean> {
  const body = await bodyText(page);
  if (LOGIN_PAGE_SIGNALS.some(signal => body.includes(signal))) return true;
  const password = page.locator('input[type="password"]');
  return await password.first().isVisible().catch(() => false);
}

async function assertSafeSession(page: Page) {
  const gate = await detectSecurityGate(page);
  if (gate) {
    throw new FacebookAutomationError(
      'SECURITY_CHECK',
      'Facebook yêu cầu xác minh. Hãy mở ứng dụng và xử lý thủ công.'
    );
  }
  if (await isLoginPage(page)) {
    throw new FacebookAutomationError(
      'NOT_LOGGED_IN',
      'Chưa đăng nhập Facebook trong hồ sơ Chrome của ứng dụng.'
    );
  }
}

async function clickComposer(page: Page) {
  for (const text of FACEBOOK_SELECTORS.composerTexts) {
    const byText = page.getByText(text, { exact: false }).first();
    if (await byText.isVisible().catch(() => false)) {
      await byText.click();
      return;
    }
    const byButton = page.getByRole('button', { name: text, exact: false }).first();
    if (await byButton.isVisible().catch(() => false)) {
      await byButton.click();
      return;
    }
  }
  throw new FacebookAutomationError(
    'FACEBOOK_UI_CHANGED',
    'Không tìm thấy ô tạo bài viết trên trang cá nhân. Facebook có thể đã đổi giao diện.'
  );
}

async function getComposerDialog(page: Page) {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const dialogs = page.locator(FACEBOOK_SELECTORS.dialog);
    const count = await dialogs.count();

    // Facebook đôi khi có nhiều dialog cùng lúc. Ưu tiên dialog có tiêu đề
    // "Tạo bài viết / Create post" hoặc có editor/file input của composer.
    for (let i = count - 1; i >= 0; i--) {
      const dialog = dialogs.nth(i);
      if (!await dialog.isVisible().catch(() => false)) continue;

      const text = normalizeVisibleText(await dialog.innerText().catch(() => ''));
      const hasComposerTitle = FACEBOOK_SELECTORS.composerDialogSignals
        .some(signal => text.includes(normalizeVisibleText(signal)));

      let hasEditor = false;
      for (const selector of FACEBOOK_SELECTORS.editorCandidates) {
        if (await dialog.locator(selector).first().isVisible().catch(() => false)) {
          hasEditor = true;
          break;
        }
      }

      const hasFileInput = await dialog.locator(FACEBOOK_SELECTORS.fileInput).count().catch(() => 0) > 0;
      if (hasComposerTitle || hasEditor || hasFileInput) return dialog;
    }

    await page.waitForTimeout(300);
  }

  throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy hộp tạo bài viết.');
}

async function fillEditor(locator: Locator, page: Page, caption: string) {
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ timeout: 3000 }).catch(() => undefined);

  try {
    await locator.fill(caption, { timeout: 5000 });
  } catch {
    // Một số bản Facebook dùng Lexical editor: locator.fill có thể không nhận.
    // Khi đó focus editor rồi chèn text bằng bàn phím thật của Playwright.
    await locator.focus().catch(() => undefined);
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.insertText(caption);
  }

  const text = (await locator.innerText().catch(() => '')).trim();
  if (text || !caption.trim()) return true;

  // Với một số contenteditable, innerText cập nhật trễ.
  await page.waitForTimeout(300);
  return (await locator.innerText().catch(() => '')).trim().length > 0;
}

async function findVisibleComposerEditor(dialog: Locator): Promise<Locator | null> {
  for (const selector of FACEBOOK_SELECTORS.editorCandidates) {
    const candidates = dialog.locator(selector);
    const count = await candidates.count();

    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      if (!await candidate.isVisible().catch(() => false)) continue;

      const tag = await candidate.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      const role = await candidate.getAttribute('role').catch(() => null);
      const editable = await candidate.getAttribute('contenteditable').catch(() => null);

      // Tránh chọn nhầm input tìm kiếm/nút khác trong dialog.
      if (tag === 'textarea' || tag === 'input' || role === 'textbox' || editable === 'true' || editable === 'plaintext-only') {
        return candidate;
      }
    }
  }

  // Fallback cuối: role=textbox trong đúng composer dialog.
  const textboxes = dialog.getByRole('textbox');
  const count = await textboxes.count();
  for (let i = 0; i < count; i++) {
    const candidate = textboxes.nth(i);
    if (!await candidate.isVisible().catch(() => false)) continue;
    const tag = await candidate.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
    const editable = await candidate.getAttribute('contenteditable').catch(() => null);
    if (tag !== 'input' || editable === 'true' || editable === 'plaintext-only') return candidate;
  }

  return null;
}

async function fillCaption(page: Page, caption: string) {
  const dialog = await getComposerDialog(page);
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    await assertSafeSession(page);

    const editor = await findVisibleComposerEditor(dialog);
    if (editor) {
      const ok = await fillEditor(editor, page, caption).catch(() => false);
      if (ok) return;
    }

    await page.waitForTimeout(350);
  }

  throw new FacebookAutomationError(
    'FACEBOOK_UI_CHANGED',
    'Hộp Tạo bài viết đã mở nhưng không tìm thấy vùng nhập nội dung sau 15 giây. Facebook có thể vừa thay đổi giao diện.'
  );
}

async function setImagesOnInputs(root: Locator | Page, images: string[], allowGeneric = true): Promise<boolean> {
  for (const selector of FACEBOOK_SELECTORS.imageFileInputs) {
    const inputs = root.locator(selector);
    const count = await inputs.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      try {
        const accept = String(await input.getAttribute('accept').catch(() => '') || '').toLowerCase();
        const multiple = await input.getAttribute('multiple').catch(() => null);

        // Tránh input rõ ràng chỉ dành cho video/file khác. Input không có accept
        // vẫn được thử vì Facebook có phiên bản dùng input generic trong composer.
        if (accept && !/image|\.jpe?g|\.png|\.webp/.test(accept)) continue;
        if (!accept && !allowGeneric) continue;
        if (images.length > 1 && multiple === null && count > 1) continue;

        await input.setInputFiles(images, { timeout: 5000 });
        const fileCount = await input.evaluate(el => (el as HTMLInputElement).files?.length || 0).catch(() => 0);
        if (fileCount > 0) return true;
      } catch {
        // Thử input tiếp theo; Facebook thường giữ nhiều input file ẩn trên trang.
      }
    }
  }

  return false;
}

async function clickPhotoControl(page: Page, dialog: Locator, images: string[]): Promise<boolean> {
  const candidates: Locator[] = [];

  for (const selector of FACEBOOK_SELECTORS.photoButtonSelectors) {
    const candidate = dialog.locator(selector).first();
    candidates.push(candidate);

    // Khi selector trỏ vào icon <img>, thử cả phần tử cha clickable.
    // HTML Facebook hiện tại có thể không đặt aria-label trực tiếp trên icon.
    if (selector.startsWith('img[')) {
      candidates.push(
        candidate.locator('xpath=ancestor::*[@role="button" or @tabindex="0"][1]')
      );
    }
  }

  for (const text of FACEBOOK_SELECTORS.photoTexts) {
    candidates.push(dialog.getByRole('button', { name: text, exact: false }).first());
    candidates.push(dialog.getByText(text, { exact: false }).first());
  }

  for (const candidate of candidates) {
    if (!await candidate.isVisible().catch(() => false)) continue;

    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 2200 }).catch(() => null);
      await candidate.click({ timeout: 4000, force: true });
      const chooser = await chooserPromise;

      if (chooser) {
        await chooser.setFiles(images);
        return true;
      }

      // Nhiều bản Facebook chỉ tạo input file ẩn sau khi click Ảnh/video.
      await page.waitForTimeout(350);
      if (await setImagesOnInputs(dialog, images)) return true;
      if (await setImagesOnInputs(page, images, false)) return true;
    } catch {
      // Thử control tiếp theo.
    }
  }

  return false;
}

type ComposerMediaEvidence = {
  imageCount: number;
  blobImageCount: number;
  backgroundImageCount: number;
  removeControlCount: number;
};

async function getComposerMediaEvidence(dialog: Locator): Promise<ComposerMediaEvidence> {
  const [
    imageCount,
    blobImageCount,
    backgroundImageCount,
    removeControlCount
  ] = await Promise.all([
    dialog.locator('img').count().catch(() => 0),
    dialog.locator('img[src^="blob:"], img[src^="data:image/"]').count().catch(() => 0),
    dialog.locator('[style*="background-image"]').count().catch(() => 0),
    dialog.locator(
      [
        '[aria-label*="Xóa ảnh"]',
        '[aria-label*="Xoá ảnh"]',
        '[aria-label*="Remove photo"]',
        '[aria-label*="Remove image"]',
        '[aria-label*="Chỉnh sửa ảnh"]',
        '[aria-label*="Edit photo"]'
      ].join(',')
    ).count().catch(() => 0)
  ]);

  return { imageCount, blobImageCount, backgroundImageCount, removeControlCount };
}

function hasNewComposerMedia(before: ComposerMediaEvidence, after: ComposerMediaEvidence) {
  return (
    after.imageCount > before.imageCount ||
    after.blobImageCount > before.blobImageCount ||
    after.backgroundImageCount > before.backgroundImageCount ||
    after.removeControlCount > before.removeControlCount
  );
}

function imageMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.bmp': return 'image/bmp';
    case '.jpg':
    case '.jpeg':
    default:
      return 'image/jpeg';
  }
}

async function dispatchImagesToComposer(
  page: Page,
  dialog: Locator,
  images: string[],
  method: 'drop' | 'paste'
): Promise<boolean> {
  const editor = await findVisibleComposerEditor(dialog);
  const targets = editor ? [editor, dialog] : [dialog];

  const payload = images.map(filePath => ({
    name: path.basename(filePath),
    type: imageMimeType(filePath),
    base64: fs.readFileSync(filePath).toString('base64')
  }));

  for (const target of targets) {
    if (!await target.isVisible().catch(() => false)) continue;

    const before = await getComposerMediaEvidence(dialog);

    try {
      await target.evaluate((element, arg) => {
        const transfer = new DataTransfer();

        for (const item of arg.files) {
          const binary = atob(item.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          transfer.items.add(
            new File([bytes], item.name, {
              type: item.type,
              lastModified: Date.now()
            })
          );
        }

        if (arg.method === 'drop') {
          element.dispatchEvent(new DragEvent('dragenter', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          }));
          element.dispatchEvent(new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          }));
          element.dispatchEvent(new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          }));
        } else {
          element.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer
          }));
        }
      }, { files: payload, method });

      // Facebook cần một chút thời gian để tạo vùng preview/upload.
      const deadline = Date.now() + 4500;
      while (Date.now() < deadline) {
        await page.waitForTimeout(350);

        // Nếu Facebook tạo input thật sau drop/paste thì ưu tiên dùng input đó.
        if (await setImagesOnInputs(dialog, images)) return true;
        if (await setImagesOnInputs(page, images, false)) return true;

        const after = await getComposerMediaEvidence(dialog);
        if (hasNewComposerMedia(before, after)) return true;
      }
    } catch {
      // Thử target/phương thức tiếp theo.
    }
  }

  return false;
}

async function addPhotos(page: Page, images: string[]) {
  for (const img of images) {
    if (!fs.existsSync(img)) {
      throw new FacebookAutomationError('UPLOAD_ERROR', `Không tìm thấy ảnh: ${img}`);
    }
  }

  const dialog = await getComposerDialog(page);

  // Lớp 1: input file nằm ngay trong composer.
  if (await setImagesOnInputs(dialog, images)) return;

  // Lớp 2: Facebook đôi khi portal input ra ngoài dialog.
  if (await setImagesOnInputs(page, images, false)) return;

  // Lớp 3: tìm/click nút Ảnh-video, bao gồm fallback theo icon hiện tại.
  if (await clickPhotoControl(page, dialog, images)) return;

  // Lớp 4: mô phỏng kéo-thả ảnh trực tiếp vào ô "Bạn đang nghĩ gì?".
  // Cách này tương ứng thao tác thủ công mà người dùng xác nhận đang hoạt động.
  if (await dispatchImagesToComposer(page, dialog, images, 'drop')) return;

  // Lớp 5: mô phỏng copy/paste ảnh vào editor.
  if (await dispatchImagesToComposer(page, dialog, images, 'paste')) return;

  // Lớp 6: Facebook có thể tạo input/control trễ, tiếp tục dò thêm một lúc.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await assertSafeSession(page);

    if (await setImagesOnInputs(dialog, images)) return;
    if (await setImagesOnInputs(page, images, false)) return;
    if (await clickPhotoControl(page, dialog, images)) return;

    await page.waitForTimeout(500);
  }

  // Không báo lỗi ở đây nữa. Facebook có thể đã mở đúng bộ chọn/vùng ảnh
  // nhưng DOM không để Playwright xác nhận được ngay. Cho luồng tiếp tục để
  // bước waitForPostButtonReady() quyết định dựa trên trạng thái thật của nút Đăng.
  return;
}

async function dispatchDropToComposer(
  page: Page,
  dialog: Locator,
  images: string[],
  targetMode: 'focused' | 'dialog'
) {
  const payload = images.map(filePath => ({
    name: path.basename(filePath),
    type: imageMimeType(filePath),
    base64: fs.readFileSync(filePath).toString('base64')
  }));

  return dialog.evaluate((dialogElement, arg) => {
    const transfer = new DataTransfer();

    for (const item of arg.files) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      transfer.items.add(new File([bytes], item.name, {
        type: item.type,
        lastModified: Date.now()
      }));
    }

    const active = document.activeElement;
    const target = arg.targetMode === 'focused' && active && dialogElement.contains(active)
      ? active
      : dialogElement;

    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    }

    return {
      tagName: (target as HTMLElement).tagName || '',
      role: (target as HTMLElement).getAttribute?.('role') || '',
      contentEditable: (target as HTMLElement).getAttribute?.('contenteditable') || ''
    };
  }, { files: payload, targetMode });
}

async function waitForDroppedMedia(
  page: Page,
  dialog: Locator,
  before: ComposerMediaEvidence,
  timeoutMs: number
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await assertSafeSession(page);
    await page.waitForTimeout(500);
    const after = await getComposerMediaEvidence(dialog);
    if (hasNewComposerMedia(before, after)) return true;
  }

  return false;
}

async function dragImagesIntoComposer(page: Page, dialog: Locator, images: string[]) {
  for (const img of images) {
    if (!fs.existsSync(img)) {
      throw new FacebookAutomationError('UPLOAD_ERROR', `Không tìm thấy ảnh: ${img}`);
    }
  }

  // Không dùng boundingBox/tọa độ nữa. Facebook vừa mở composer thường đã
  // đặt focus đúng vùng viết bài, nên thả file trực tiếp vào activeElement.
  let before = await getComposerMediaEvidence(dialog);
  await dispatchDropToComposer(page, dialog, images, 'focused');
  if (await waitForDroppedMedia(page, dialog, before, 7000)) return;

  // Nếu focus không nằm trong editor, thả vào chính dialog để sự kiện bubble
  // qua cây composer. Vẫn là thao tác drag/drop, không tìm input file.
  before = await getComposerMediaEvidence(dialog);
  await dispatchDropToComposer(page, dialog, images, 'dialog');
  if (await waitForDroppedMedia(page, dialog, before, 8000)) return;

  throw new FacebookAutomationError(
    'UPLOAD_ERROR',
    'Facebook chưa nhận ảnh sau khi thả trực tiếp vào hộp Tạo bài viết.'
  );
}

async function typeCaptionWithKeyboard(page: Page, dialog: Locator, caption: string) {
  if (!caption.trim()) return;

  // Sau khi mở composer Facebook đã focus sẵn vùng viết bài. Không tìm selector
  // editor nữa; chỉ nhập text vào focus hiện tại bằng keyboard.
  await page.waitForTimeout(900);

  const lines = caption.replace(/\r\n/g, '\n').split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const chars = Array.from(lines[lineIndex]);

    // Chia text thành block nhỏ để editor Facebook không bỏ ký tự khi UI đang
    // đồng thời xử lý preview ảnh.
    for (let i = 0; i < chars.length; i += 80) {
      await page.keyboard.insertText(chars.slice(i, i + 80).join(''));
      await page.waitForTimeout(90);
    }

    if (lineIndex < lines.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(120);
    }
  }

  await page.waitForTimeout(500);

  // Chỉ xác nhận caption đã xuất hiện trong dialog; không cần biết editor nằm đâu.
  const probe = normalizeVisibleText(caption).slice(0, 24);
  const dialogText = normalizeVisibleText(await dialog.innerText().catch(() => ''));
  if (probe && !dialogText.includes(probe)) {
    throw new FacebookAutomationError(
      'FACEBOOK_UI_CHANGED',
      'Facebook không giữ focus ở vùng viết bài nên nội dung chưa được nhập. Không tiếp tục để tránh đăng thiếu chữ.'
    );
  }
}

async function findPostButton(page: Page): Promise<Locator | null> {
  const dialog = await getComposerDialog(page);
  for (const name of FACEBOOK_SELECTORS.postButtonNames) {
    const btn = dialog.getByRole('button', { name }).first();
    if (await btn.isVisible().catch(() => false)) return btn;
  }
  return null;
}

async function waitForPostButtonReady(page: Page, hasImages: boolean): Promise<Locator> {
  const deadline = Date.now() + (hasImages ? 90_000 : 30_000);

  while (Date.now() < deadline) {
    await assertSafeSession(page);

    const failure = await detectPostFailure(page);
    if (failure) {
      throw new FacebookAutomationError(
        hasImages ? 'UPLOAD_ERROR' : 'UNKNOWN',
        'Facebook báo lỗi khi chuẩn bị bài: ' + failure
      );
    }

    const btn = await findPostButton(page).catch(() => null);
    if (btn && await btn.isEnabled().catch(() => false)) return btn;

    await page.waitForTimeout(500);
  }

  throw new FacebookAutomationError(
    hasImages ? 'UPLOAD_ERROR' : 'FACEBOOK_UI_CHANGED',
    hasImages
      ? 'Ảnh chưa upload xong hoặc nút Đăng chưa sẵn sàng sau thời gian chờ.'
      : 'Nút Đăng chưa sẵn sàng sau thời gian chờ.'
  );
}

async function waitForPostConfirmation(page: Page, composer: Locator) {
  const deadline = Date.now() + 20_000;
  let hiddenSince = 0;

  while (Date.now() < deadline) {
    const security = await detectSecurityGate(page);
    if (security) {
      throw new FacebookAutomationError(
        'POST_UNCERTAIN',
        'Đã bấm Đăng nhưng Facebook yêu cầu xác minh. Cần kiểm tra trang cá nhân thủ công để tránh đăng trùng.'
      );
    }

    const failure = await detectPostFailure(page);
    if (failure) {
      throw new FacebookAutomationError(
        'POST_UNCERTAIN',
        'Đã bấm Đăng nhưng Facebook báo lỗi hoặc trạng thái không rõ: ' + failure
      );
    }

    const visible = await composer.isVisible().catch(() => false);
    if (!visible) {
      if (!hiddenSince) hiddenSince = Date.now();
      if (Date.now() - hiddenSince >= 1500) return;
    } else {
      hiddenSince = 0;
    }

    await page.waitForTimeout(400);
  }

  throw new FacebookAutomationError(
    'POST_UNCERTAIN',
    'Đã bấm Đăng nhưng không xác nhận được bài đã đăng. Không tự thử lại để tránh bài trùng.'
  );
}

async function launch(profileDir: string): Promise<BrowserContext> {
  const channels: Array<'chrome' | 'msedge'> = ['chrome', 'msedge'];
  const errors: string[] = [];

  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        channel,
        headless: false,
        viewport: null,
        args: ['--start-maximized'],
        // Playwright có thể thêm --no-sandbox vào Chromium. Trên Windows không cần
        // hạ sandbox; bỏ cờ này để giữ bảo vệ trình duyệt và tránh banner cảnh báo.
        ignoreDefaultArgs: ['--no-sandbox']
      });
    } catch (error) {
      errors.push(`${channel}: ${String((error as any)?.message || error)}`);
    }
  }

  const detail = errors.join(' | ');
  const lower = detail.toLowerCase();
  if (/user data directory|profile.*in use|processsingleton|singletonlock|browser is already running/.test(lower)) {
    throw new FacebookAutomationError(
      'UNKNOWN',
      'Hồ sơ Facebook của ứng dụng đang được một cửa sổ trình duyệt khác sử dụng. Hãy đóng cửa sổ Chrome/Edge do Auto Social mở rồi thử lại.'
    );
  }

  const code = classifyUnknownError(detail);
  throw new FacebookAutomationError(
    code,
    'Không mở được trình duyệt Facebook. Auto Social đã thử Google Chrome và Microsoft Edge. Hãy bảo đảm ít nhất một trong hai trình duyệt có trên máy. Chi tiết: ' + detail
  );
}

function findInstalledBrowser(): { name: string; executable: string } | null {
  const candidates = [
    {
      name: 'Microsoft Edge',
      executable: path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    },
    {
      name: 'Microsoft Edge',
      executable: path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    },
    {
      name: 'Microsoft Edge',
      executable: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    },
    {
      name: 'Google Chrome',
      executable: path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    },
    {
      name: 'Google Chrome',
      executable: path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    },
    {
      name: 'Google Chrome',
      executable: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    }
  ];

  return candidates.find(item => item.executable && fs.existsSync(item.executable)) || null;
}

export async function openFacebookForLogin(profileDir: string): Promise<void> {
  const browser = findInstalledBrowser();
  if (!browser) {
    throw new FacebookAutomationError(
      'UNKNOWN',
      'Không tìm thấy Microsoft Edge hoặc Google Chrome trên máy. Hãy cài một trong hai trình duyệt rồi thử lại.'
    );
  }

  fs.mkdirSync(profileDir, { recursive: true });

  try {
    const child = spawn(browser.executable, [
      `--user-data-dir=${profileDir}`,
      '--profile-directory=Default',
      '--start-maximized',
      FACEBOOK_URLS.home
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
  } catch (error) {
    throw new FacebookAutomationError(
      'UNKNOWN',
      `Không thể mở ${browser.name} để đăng nhập Facebook: ${String((error as any)?.message || error)}`
    );
  }

  // Luồng đăng nhập cố ý KHÔNG dùng Playwright. Người dùng đăng nhập/xác minh
  // trong trình duyệt thật, sau đó đóng toàn bộ cửa sổ browser trước khi app
  // kiểm tra session hoặc chạy TEST/AUTO bằng profile này.
}

export async function checkFacebookLogin(profileDir: string): Promise<FacebookLoginStatus> {
  let context: BrowserContext | null = null;
  try {
    context = await launch(profileDir);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(FACEBOOK_URLS.personalProfile, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);

    if (await detectSecurityGate(page)) return 'needs_check';
    if (await isLoginPage(page)) return 'logged_out';
    return 'logged_in';
  } catch {
    return 'needs_check';
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}

export async function publishToFacebook(
  profileDir: string,
  caption: string,
  images: string[],
  mode: RunMode = 'test'
): Promise<FacebookPublishResult> {
  let context: BrowserContext | null = null;
  let postClicked = false;

  try {
    context = await launch(profileDir);
    const page = context.pages()[0] || await context.newPage();

    // Đi thẳng vào profile cá nhân thay vì chỉ dùng composer ở Home.
    await page.goto(FACEBOOK_URLS.personalProfile, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(2200);
    await assertSafeSession(page);

    await clickComposer(page);
    const composer = await getComposerDialog(page);

    // Luồng thao tác đơn giản theo đúng UI Facebook hiện tại:
    // 1) mở composer, 2) kéo ảnh vào vùng soạn bài, 3) gõ caption bằng keyboard,
    // 4) chờ nút Đăng sẵn sàng.
    await page.waitForTimeout(1200);

    if (images.length) {
      await dragImagesIntoComposer(page, composer, images);
      await page.waitForTimeout(1200);
    }

    await typeCaptionWithKeyboard(page, composer, caption);

    // Chờ Facebook xử lý upload và chỉ tiếp tục khi nút Đăng thực sự enabled.
    const postButton = await waitForPostButtonReady(page, images.length > 0);
    await assertSafeSession(page);

    if (mode === 'test') {
      // TEST giữ Chrome mở để người dùng xem lại và tự bấm Đăng.
      context = null;
      return {
        prepared: true,
        posted: false,
        submitted: false,
        confirmation: 'prepared'
      };
    }

    await postButton.click();
    postClicked = true;

    try {
      await waitForPostConfirmation(page, composer);
    } catch (error) {
      // Sau khi đã click Đăng, mọi trạng thái không rõ phải coi là uncertain,
      // giữ browser mở và tuyệt đối không để scheduler tự retry.
      context = null;
      if (error instanceof FacebookAutomationError && error.code === 'POST_UNCERTAIN') {
        throw error;
      }
      throw new FacebookAutomationError(
        'POST_UNCERTAIN',
        'Đã bấm Đăng nhưng không xác nhận chắc chắn kết quả. Cần kiểm tra thủ công.'
      );
    }

    return {
      prepared: true,
      posted: true,
      submitted: true,
      confirmation: 'confirmed'
    };
  } catch (error) {
    if (error instanceof FacebookAutomationError) throw error;

    if (postClicked) {
      context = null;
      throw new FacebookAutomationError(
        'POST_UNCERTAIN',
        'Đã bấm Đăng nhưng gặp lỗi sau đó. Không tự thử lại để tránh bài trùng.'
      );
    }

    const code = classifyUnknownError(error);
    throw new FacebookAutomationError(code, String((error as any)?.message || error));
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}
