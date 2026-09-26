import fs from 'fs';
import path from 'path';
import type { AppConfig, ProductFolder } from './types';

function loadExamples(productFolder: string): string {
  const root = path.dirname(productFolder);
  const candidates = [
    path.join(root, '_phong-cach', 'bai-mau.txt'),
    path.join(root, '_phong-cach', 'examples.txt'),
    path.join(root, 'bai-mau.txt')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try { return fs.readFileSync(file, 'utf8').slice(0, 12000); } catch { /* ignore */ }
    }
  }
  return '';
}

function buildUserPrompt(product: ProductFolder) {
  const examples = loadExamples(product.folderPath);
  return `Hãy viết đúng 1 caption Facebook cá nhân để bán mặt hàng dưới đây.

Tên thư mục / tên mặt hàng: ${product.name}
Thông tin bổ sung do người dùng cung cấp:
${product.infoText || '(không có)'}

${examples ? `Một số bài mẫu phong cách của người dùng:\n${examples}\n` : ''}

Quy tắc bắt buộc:
- Chỉ dựa vào tên và thông tin đã cung cấp.
- Không bịa thông số kỹ thuật, chất liệu, giá, bảo hành, xuất xứ hay khuyến mại.
- Nếu thiếu dữ liệu, viết ngắn tự nhiên.
- Chỉ trả về nội dung caption, không giải thích.`;
}

async function deepseek(config: AppConfig, system: string, user: string): Promise<string> {
  if (!config.deepseekApiKey) throw new Error('Chưa nhập DeepSeek API key.');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekModel || 'deepseek-chat',
      temperature: 0.85,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!res.ok) throw new Error(`DeepSeek lỗi ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

async function ollama(config: AppConfig, system: string, user: string): Promise<string> {
  const base = config.ollamaUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      options: { temperature: 0.85 }
    })
  });
  if (!res.ok) throw new Error(`Ollama lỗi ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return String(data?.message?.content || '').trim();
}

export async function generateCaption(config: AppConfig, product: ProductFolder): Promise<string> {
  const system = config.stylePrompt;
  const user = buildUserPrompt(product);
  const out = config.aiProvider === 'ollama'
    ? await ollama(config, system, user)
    : await deepseek(config, system, user);
  if (!out) throw new Error('AI không trả về caption.');
  return out;
}
