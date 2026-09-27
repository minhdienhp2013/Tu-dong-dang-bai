import type { AiContentResult, AppConfig, LearningRecord, ProductImageRecord, ProductRecord } from './types';
import { FacebookAutomationError } from './facebook/errors';

function learningBlock(rows: LearningRecord[]) {
  if (!rows.length) return '';
  return rows.slice(0, 10).map((r, i) =>
    `Ví dụ sửa ${i + 1} - ${r.product_name}\nAI viết: ${r.ai_original}\nNgười dùng sửa: ${r.user_final}`
  ).join('\n\n');
}

async function deepseek(config: AppConfig, system: string, user: string): Promise<string> {
  if (!config.deepseekApiKey) throw new Error('Chưa nhập DeepSeek API key.');
  try {
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
  } catch (error: any) {
    throw new FacebookAutomationError('AI_ERROR', error?.message || String(error));
  }
}

async function ollama(config: AppConfig, system: string, user: string): Promise<string> {
  const base = config.ollamaUrl.replace(/\/$/, '');
  try {
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
  } catch (error: any) {
    throw new FacebookAutomationError('AI_ERROR', error?.message || String(error));
  }
}

async function callAi(config: AppConfig, system: string, user: string) {
  return config.aiProvider === 'ollama' ? ollama(config, system, user) : deepseek(config, system, user);
}

function cleanFence(s: string) {
  return s.replace(/^\s*\`\`\`(?:json)?/i, '').replace(/\`\`\`\s*$/i, '').trim();
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
    const caption = cleaned.replace(/(?:^|\n)TITLE\s*:\s*.+/i, '').replace(/(?:^|\n)HASHTAGS\s*:\s*.+/i, '').trim();
    return { title, caption, hashtags: hashtags.trim() };
  }
}

export async function generateProductContent(
  config: AppConfig,
  product: ProductRecord,
  images: ProductImageRecord[],
  learning: LearningRecord[] = [],
  stylePrompt?: string
): Promise<AiContentResult> {
  const imageNotes = images.filter(i => i.active)
    .map((i, idx) => 'Ảnh ' + (idx + 1) + ': ' + (i.note?.trim() || '(không có ghi chú)'))
    .join('\n');
  const edits = learningBlock(learning);
  const user =
    'Tạo 1 bài đăng Facebook cá nhân cho mặt hàng sau.\n\n' +
    'TÊN SẢN PHẨM:\n' + product.name + '\n\n' +
    'MÔ TẢ:\n' + (product.description || '(không có)') + '\n\n' +
    'THÔNG TIN SẢN PHẨM ĐƯỢC PHÉP DÙNG:\n' + (product.info_text || '(không có)') + '\n\n' +
    'HASHTAG MẶC ĐỊNH:\n' + (product.default_hashtags || '(không có)') + '\n\n' +
    'GHI CHÚ TỪNG ẢNH:\n' + (imageNotes || '(không có)') + '\n\n' +
    (edits ? 'CÁC VÍ DỤ NGƯỜI DÙNG ĐÃ SỬA AI TRƯỚC ĐÂY:\n' + edits + '\n\n' : '') +
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

  const raw = await callAi(config, stylePrompt || config.stylePrompt, user);
  const result = parseStructured(raw, product.default_hashtags);
  if (!result.caption) throw new FacebookAutomationError('AI_ERROR', 'AI không trả về nội dung bài viết.');
  return result;
}

