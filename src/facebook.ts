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
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const dialog = page.locator(FACEBOOK_SELECTORS.dialog).last();
    if (await dialog.isVisible().catch(() => false)) return dialog;
    await page.waitForTimeout(300);
  }
  throw new FacebookAutomationError('FACEBOOK_UI_CHANGED', 'Không tìm thấy hộp tạo bài viết.');
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
      throw new FacebookAutomationError(
        'UPLOAD_ERROR',
        'Không thể upload ảnh vào Facebook: ' + String((error as any)?.message || error)
      );
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
        throw new FacebookAutomationError(
          'UPLOAD_ERROR',
          'Không thể chọn ảnh để upload: ' + String((error as any)?.message || error)
        );
      }
    }
  }

  throw new FacebookAutomationError(
    'FACEBOOK_UI_CHANGED',
    'Không tìm thấy nút/ô tải ảnh trong hộp tạo bài.'
  );
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
    await fillCaption(page, caption);

    if (images.length) {
      await addPhotos(page, images);
    }

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
