import fs from 'fs';
import path from 'path';
import type { AiContentResult, AppConfig, ProductFolder, ProductImageRecord, ProductRecord } from './types';

function loadExamplesFromRoot(root: string): string {
  const candidates = [
    path.join(root, '_phong-cach', 'bai-mau.txt'),
    path.join(root, '_phong-cach', 'examples.txt'),
    path.join(root, 'bai-mau.txt')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try { return fs.readFileSync(file, 'utf8').slice(0, 12000); } catch { }
    }
  }
  return '';
}

async function deepseek(config: AppConfig, system: string, user: string): Promise<string> {
  if (!config.deepseekApiKey) throw new Error('Chưa nhập DeepSeek API key.');
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.deepseekApiKey },
    body: JSON.stringify({
      model: config.deepseekModel || 'deepseek-chat',
      temperature: 0.82,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  });
  if (!res.ok) throw new Error('DeepSeek lỗi ' + res.status + ': ' + await res.text());
  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content || '').trim();
}

async function ollama(config: AppConfig, system: string, user: string): Promise<string> {
  const base = config.ollamaUrl.replace(/\/$/, '');
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      options: { temperature: 0.82 }
    })
  });
  if (!res.ok) throw new Error('Ollama lỗi ' + res.status + ': ' + await res.text());
  const data: any = await res.json();
  return String(data?.message?.content || '').trim();
}

async function callAi(config: AppConfig, system: string, user: string) {
  return config.aiProvider === 'ollama' ? ollama(config, system, user) : deepseek(config, system, user);
}

function cleanFence(s: string) {
  return s.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
}

function parseStructured(raw: string, fallbackHashtags = ''): AiContentResult {
  const cleaned = cleanFence(raw);
  try {
    const parsed = JSON.parse(cleaned);
    return {
      title: String(parsed.title || '').trim(),
      caption: String(parsed.caption || '').trim(),
      hashtags: String(parsed.hashtags || fallbackHashtags || '').trim()
    };
  } catch {
    const title = cleaned.match(/(?:^|\n)TITLE\s*:\s*(.+)/i)?.[1]?.trim() || '';
    const hashtags = cleaned.match(/(?:^|\n)HASHTAGS\s*:\s*(.+)/i)?.[1]?.trim() || fallbackHashtags;
    const caption = cleaned
      .replace(/(?:^|\n)TITLE\s*:\s*.+/i, '')
      .replace(/(?:^|\n)HASHTAGS\s*:\s*.+/i, '')
      .trim();
    return { title, caption, hashtags: hashtags.trim() };
  }
}

export async function generateProductContent(
  config: AppConfig,
  product: ProductRecord,
  images: ProductImageRecord[],
  examplesRoot?: string
): Promise<AiContentResult> {
  const imageNotes = images
    .filter(i => i.active)
    .map((i, idx) => 'Ảnh ' + (idx + 1) + ': ' + (i.note?.trim() || '(không có ghi chú)'))
    .join('\n');

  const examples = examplesRoot ? loadExamplesFromRoot(examplesRoot) : '';
  const user =
    'Tạo 1 bài đăng Facebook cá nhân cho mặt hàng sau.\n\n' +
    'TÊN SẢN PHẨM:\n' + product.name + '\n\n' +
    'MÔ TẢ:\n' + (product.description || '(không có)') + '\n\n' +
    'THÔNG TIN SẢN PHẨM ĐƯỢC PHÉP DÙNG:\n' + (product.info_text || '(không có)') + '\n\n' +
    'HASHTAG MẶC ĐỊNH:\n' + (product.default_hashtags || '(không có)') + '\n\n' +
    'GHI CHÚ TỪNG ẢNH:\n' + (imageNotes || '(không có)') + '\n\n' +
    (examples ? 'BÀI MẪU PHONG CÁCH CỦA NGƯỜI DÙNG:\n' + examples + '\n\n' : '') +
    'QUY TẮC:\n' +
    '- Chỉ dùng dữ kiện có trong phần trên.\n' +
    '- Không bịa giá, chất liệu, kích thước, xuất xứ, bảo hành, khuyến mại.\n' +
    '- Nếu dữ liệu ít, viết ngắn và tự nhiên.\n' +
    '- Tiêu đề ngắn, không giật gân quá mức.\n' +
    '- Caption giống người bán hàng tự viết trên trang cá nhân.\n' +
    '- Hashtag tối đa 5, ưu tiên hashtag mặc định nếu có.\n' +
    '- Không nhắc đến AI hay tự động hóa.\n\n' +
    'Trả về JSON hợp lệ đúng dạng:\n' +
    '{"title":"...","caption":"...","hashtags":"#tag1 #tag2"}';

  const raw = await callAi(config, config.stylePrompt, user);
  const result = parseStructured(raw, product.default_hashtags);
  if (!result.caption) throw new Error('AI không trả về nội dung bài viết.');
  return result;
}

export async function generateCaption(config: AppConfig, product: ProductFolder): Promise<string> {
  const examples = loadExamplesFromRoot(path.dirname(product.folderPath));
  const user =
    'Hãy viết đúng 1 caption Facebook cá nhân để bán mặt hàng dưới đây.\n\n' +
    'Tên thư mục / tên mặt hàng: ' + product.name + '\n' +
    'Thông tin bổ sung do người dùng cung cấp:\n' + (product.infoText || '(không có)') + '\n\n' +
    (examples ? 'Một số bài mẫu phong cách của người dùng:\n' + examples + '\n\n' : '') +
    'Quy tắc bắt buộc:\n' +
    '- Chỉ dựa vào tên và thông tin đã cung cấp.\n' +
    '- Không bịa thông số kỹ thuật, chất liệu, giá, bảo hành, xuất xứ hay khuyến mại.\n' +
    '- Nếu thiếu dữ liệu, viết ngắn tự nhiên.\n' +
    '- Chỉ trả về nội dung caption, không giải thích.';

  const out = await callAi(config, config.stylePrompt, user);
  if (!out) throw new Error('AI không trả về caption.');
  return out;
}
