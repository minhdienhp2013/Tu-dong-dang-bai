import fs from 'fs';
import { chromium, BrowserContext, Page } from 'playwright-core';

function normalizeVisibleText(s: string) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function detectSecurityGate(page: Page): Promise<string | null> {
  const body = normalizeVisibleText(await page.locator('body').innerText().catch(() => ''));
  const signals = [
    'enter security code', 'security check', 'checkpoint', 'captcha',
    'nhập mã bảo mật', 'kiểm tra bảo mật', 'xác nhận danh tính',
    'xác minh tài khoản', 'xác nhận đây là bạn'
  ];
  const found = signals.find(s => body.includes(s));
  return found || null;
}

async function clickComposer(page: Page) {
  const candidates = [
    page.getByText("What's on your mind?", { exact: false }),
    page.getByText('Bạn đang nghĩ gì?', { exact: false }),
    page.getByText('Bạn đang nghĩ gì', { exact: false })
  ];
  for (const locator of candidates) {
    if (await locator.first().isVisible().catch(() => false)) {
      await locator.first().click();
      return;
    }
  }
  const fallback = page.locator('[role="button"]').filter({ hasText: /nghĩ gì|what's on your mind/i }).first();
  if (await fallback.isVisible().catch(() => false)) {
    await fallback.click();
    return;
  }
  throw new Error('Không tìm thấy ô tạo bài viết. Facebook có thể đã đổi giao diện.');
}

async function fillCaption(page: Page, caption: string) {
  const dialog = page.locator('[role="dialog"]').last();
  const editors = dialog.locator('[contenteditable="true"]');
  const count = await editors.count();
  for (let i = 0; i < count; i++) {
    const ed = editors.nth(i);
    if (await ed.isVisible().catch(() => false)) {
      await ed.click();
      await ed.fill(caption).catch(async () => {
        await page.keyboard.insertText(caption);
      });
      return;
    }
  }
  throw new Error('Không tìm thấy ô nhập nội dung bài viết.');
}

async function addPhotos(page: Page, images: string[]) {
  for (const img of images) {
    if (!fs.existsSync(img)) throw new Error(`Không tìm thấy ảnh: ${img}`);
  }

  const dialog = page.locator('[role="dialog"]').last();
  const inputs = dialog.locator('input[type="file"]');
  if (await inputs.count()) {
    await inputs.first().setInputFiles(images);
    return;
  }

  const photoButtons = [
    dialog.getByText('Ảnh/video', { exact: false }),
    dialog.getByText('Photo/video', { exact: false })
  ];
  for (const btn of photoButtons) {
    if (await btn.first().isVisible().catch(() => false)) {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
      await btn.first().click();
      const chooser = await chooserPromise;
      await chooser.setFiles(images);
      return;
    }
  }
  throw new Error('Không tìm thấy nút/ô tải ảnh trong hộp tạo bài.');
}

async function clickPost(page: Page) {
  const dialog = page.locator('[role="dialog"]').last();
  const candidates = [
    dialog.getByRole('button', { name: /^Đăng$/i }),
    dialog.getByRole('button', { name: /^Post$/i })
  ];
  for (const btn of candidates) {
    if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) {
      await btn.click();
      return;
    }
  }
  throw new Error('Không tìm thấy nút Đăng hoặc nút chưa sẵn sàng.');
}

export async function openFacebookForLogin(profileDir: string): Promise<void> {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
  // Keep browser open; user closes it manually after login.
}

export async function publishToFacebook(profileDir: string, caption: string, images: string[]): Promise<void> {
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      args: ['--start-maximized']
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    const gate = await detectSecurityGate(page);
    if (gate) throw new Error('Facebook đang yêu cầu xác minh/CAPTCHA. Đã dừng tự động để bạn xử lý thủ công.');

    const body = normalizeVisibleText(await page.locator('body').innerText().catch(() => ''));
    if (body.includes('log into facebook') || body.includes('đăng nhập facebook')) {
      throw new Error('Chưa đăng nhập Facebook trong hồ sơ Chrome của ứng dụng.');
    }

    await clickComposer(page);
    await page.waitForTimeout(800);
    await fillCaption(page, caption);
    if (images.length) {
      await addPhotos(page, images);
      await page.waitForTimeout(1500);
    }

    const gate2 = await detectSecurityGate(page);
    if (gate2) throw new Error('Facebook yêu cầu xác minh trong lúc tạo bài. Đã dừng trước khi đăng.');

    await clickPost(page);
    await page.waitForTimeout(3500);
  } finally {
    if (context) await context.close().catch(() => undefined);
  }
}
