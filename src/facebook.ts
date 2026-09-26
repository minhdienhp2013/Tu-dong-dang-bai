import fs from 'fs';
import { chromium, BrowserContext, Page } from 'playwright-core';
import type { FacebookLoginStatus, FacebookPublishResult, RunMode } from './types';
import { FACEBOOK_SELECTORS, LOGIN_PAGE_SIGNALS, SECURITY_SIGNALS } from './facebook/selectors';
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
    'Không tìm thấy ô tạo bài viết. Facebook có thể đã đổi giao diện.'
  );
}

async function getComposerDialog(page: Page) {
  const dialog = page.locator(FACEBOOK_SELECTORS.dialog).last();
  if (!await dialog.isVisible().catch(() => false)) {
    throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy hộp tạo bài viết.');
  }
  return dialog;
}

async function fillCaption(page: Page, caption: string) {
  const dialog = await getComposerDialog(page);
  const editors = dialog.locator(FACEBOOK_SELECTORS.editor);
  const count = await editors.count();
  for (let i = 0; i < count; i++) {
    const ed = editors.nth(i);
    if (await ed.isVisible().catch(() => false)) {
      await ed.click();
      try {
        await ed.fill(caption);
      } catch {
        await page.keyboard.insertText(caption);
      }
      return;
    }
  }
  throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy ô nhập nội dung bài viết.');
}

async function addPhotos(page: Page, images: string[]) {
  for (const img of images) {
    if (!fs.existsSync(img)) {
      throw new FacebookAutomationError('UPLOAD_ERROR', `Không tìm thấy ảnh: ${img}`);
    }
  }

  const dialog = await getComposerDialog(page);
  const inputs = dialog.locator(FACEBOOK_SELECTORS.fileInput);
  if (await inputs.count()) {
    try {
      await inputs.first().setInputFiles(images);
      return;
    } catch (error) {
      throw new FacebookAutomationError('UPLOAD_ERROR', 'Không thể upload ảnh vào Facebook: ' + String((error as any)?.message || error));
    }
  }

  for (const text of FACEBOOK_SELECTORS.photoTexts) {
    const btn = dialog.getByText(text, { exact: false }).first();
    if (await btn.isVisible().catch(() => false)) {
      try {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 7000 });
        await btn.click();
        const chooser = await chooserPromise;
        await chooser.setFiles(images);
        return;
      } catch (error) {
        throw new FacebookAutomationError('UPLOAD_ERROR', 'Không thể chọn ảnh để upload: ' + String((error as any)?.message || error));
      }
    }
  }
  throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy nút/ô tải ảnh trong hộp tạo bài.');
}

async function clickPost(page: Page) {
  const dialog = await getComposerDialog(page);
  for (const name of FACEBOOK_SELECTORS.postButtonNames) {
    const btn = dialog.getByRole('button', { name }).first();
    if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) {
      await btn.click();
      return;
    }
  }
  throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy nút Đăng hoặc nút chưa sẵn sàng.');
}

async function launch(profileDir: string): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: ['--start-maximized']
    });
  } catch (error) {
    const code = classifyUnknownError(error);
    throw new FacebookAutomationError(code, 'Không thể mở Google Chrome: ' + String((error as any)?.message || error));
  }
}

export async function openFacebookForLogin(profileDir: string): Promise<void> {
  const context = await launch(profileDir);
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Chủ tài khoản tự đăng nhập và đóng cửa sổ Chrome sau khi xong.
}

export async function checkFacebookLogin(profileDir: string): Promise<FacebookLoginStatus> {
  let context: BrowserContext | null = null;
  try {
    context = await launch(profileDir);
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
  try {
    context = await launch(profileDir);
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2200);
    await assertSafeSession(page);

    await clickComposer(page);
    await page.waitForTimeout(700);
    await fillCaption(page, caption);

    if (images.length) {
      await addPhotos(page, images);
      await page.waitForTimeout(1600);
    }

    await assertSafeSession(page);

    if (mode === 'test') {
      // Giữ browser mở để người dùng tự kiểm tra và bấm Đăng.
      context = null;
      return { prepared: true, posted: false };
    }

    await clickPost(page);
    await page.waitForTimeout(3500);
    return { prepared: true, posted: true };
  } catch (error) {
    if (error instanceof FacebookAutomationError) throw error;
    const code = classifyUnknownError(error);
    throw new FacebookAutomationError(code, String((error as any)?.message || error));
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}
