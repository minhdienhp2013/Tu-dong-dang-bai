import type { PostErrorCode } from '../types';

export class FacebookAutomationError extends Error {
  constructor(public code: PostErrorCode, message: string) {
    super(message);
    this.name = 'FacebookAutomationError';
  }
}

export function classifyUnknownError(error: unknown): PostErrorCode {
  const message = String((error as any)?.message || error || '').toLowerCase();
  if (/timeout|net::|econnreset|enotfound|network|socket|connection/.test(message)) return 'NETWORK_ERROR';
  if (/upload|filechooser|setinputfiles|không tìm thấy ảnh/.test(message)) return 'UPLOAD_ERROR';
  if (/đăng nhập|log into facebook|not logged/.test(message)) return 'NOT_LOGGED_IN';
  if (/captcha|checkpoint|security|xác minh|xác nhận danh tính|2fa|two-factor/.test(message)) return 'SECURITY_CHECK';
  if (/selector|không tìm thấy ô|không tìm thấy nút|facebook có thể đã đổi giao diện/.test(message)) return 'FACEBOOK_UI_CHANGED';
  return 'UNKNOWN';
}

export function isAutoRetryable(code: PostErrorCode) {
  return code === 'NETWORK_ERROR';
}
