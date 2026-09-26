import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import type { AppConfig } from './types';

const DEFAULT_STYLE = `Bạn viết bài Facebook cá nhân như một người bán hàng thật.
Yêu cầu:
- Viết tiếng Việt tự nhiên, câu ngắn, dễ đọc.
- Không dùng giọng văn quảng cáo quá bóng bẩy hoặc máy móc.
- Không mở đầu bài nào cũng giống nhau.
- Có thể dùng 0-3 emoji, không lạm dụng.
- Chỉ dùng dữ kiện được cung cấp; tuyệt đối không bịa giá, chất liệu, kích thước, bảo hành hoặc khuyến mại.
- Nếu thông tin sản phẩm ít, hãy viết ngắn và tự nhiên thay vì bịa thêm.
- Có thể dùng cách nói như: "mới về", "có sẵn", "anh chị", "mọi người", nhưng thay đổi linh hoạt.
- Cuối bài mời khách nhắn tin hỏi thêm một cách tự nhiên.
- Tối đa 5 hashtag và chỉ dùng khi phù hợp.
- Không tự nhận là AI, không nói đây là nội dung được tạo tự động.`;

type StoredConfig = Partial<AppConfig> & {
  deepseekApiKeyEncrypted?: string;
};

function defaultConfig(): AppConfig {
  const userData = app.getPath('userData');
  return {
    rootFolder: '',
    aiProvider: 'deepseek',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
    stylePrompt: DEFAULT_STYLE,
    postingTimes: ['08:00', '12:00', '19:30'],
    autoPostEnabled: false,
    schedulerPaused: false,
    daysBeforeRepeatProduct: 7,
    imageReuseAfterDays: 30,
    imagesPerPost: 4,
    browserProfileDir: path.join(userData, 'facebook-browser-profile'),
    runMode: 'test',
    autoStartWindows: false,
    startMinimized: false,
    minimizeToTray: true,
    keepRunningInTray: true,
    defaultStyleId: null
  };
}

function sanitizeConfig(raw: Partial<AppConfig>, base: AppConfig): AppConfig {
  return {
    ...base,
    ...raw,
    postingTimes: Array.isArray(raw.postingTimes) ? raw.postingTimes.filter(Boolean) : base.postingTimes,
    runMode: raw.runMode === 'auto' ? 'auto' : 'test',
    imagesPerPost: Math.max(1, Math.min(10, Number(raw.imagesPerPost ?? base.imagesPerPost))),
    daysBeforeRepeatProduct: Math.max(0, Number(raw.daysBeforeRepeatProduct ?? base.daysBeforeRepeatProduct)),
    imageReuseAfterDays: Math.max(0, Number(raw.imageReuseAfterDays ?? base.imageReuseAfterDays))
  };
}

function decryptSecret(saved: StoredConfig): string {
  if (saved.deepseekApiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(saved.deepseekApiKeyEncrypted, 'base64'));
    } catch {
      return '';
    }
  }
  // Migration path for MVP versions that stored the key as plain local config.
  return String(saved.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '');
}

export class ConfigStore {
  private filePath = path.join(app.getPath('userData'), 'config.json');

  load(): AppConfig {
    const base = defaultConfig();
    if (!fs.existsSync(this.filePath)) return base;
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as StoredConfig;
      const withSecret: Partial<AppConfig> = {
        ...saved,
        deepseekApiKey: decryptSecret(saved)
      };
      return sanitizeConfig(withSecret, base);
    } catch {
      return base;
    }
  }

  save(next: Partial<AppConfig>): AppConfig {
    const merged = sanitizeConfig({ ...this.load(), ...next }, defaultConfig());
    const stored: StoredConfig = { ...merged };
    delete stored.deepseekApiKeyEncrypted;

    if (merged.deepseekApiKey && safeStorage.isEncryptionAvailable()) {
      stored.deepseekApiKeyEncrypted = safeStorage.encryptString(merged.deepseekApiKey).toString('base64');
      delete stored.deepseekApiKey;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(stored, null, 2), 'utf8');
    return merged;
  }
}
