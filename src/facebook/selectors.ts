export const FACEBOOK_URLS = {
  home: 'https://www.facebook.com/',
  personalProfile: 'https://www.facebook.com/me/'
};

export const FACEBOOK_SELECTORS = {
  composerTexts: [
    'Bạn đang nghĩ gì?',
    'Bạn đang nghĩ gì',
    "What's on your mind?"
  ],
  photoTexts: [
    'Ảnh/video',
    'Ảnh / video',
    'Thêm ảnh/video',
    'Thêm ảnh hoặc video',
    'Photo/video',
    'Photo / video',
    'Add photos/videos',
    'Add photos or videos'
  ],
  photoButtonSelectors: [
    '[role="button"][aria-label*="Ảnh/video"]',
    '[role="button"][aria-label*="Ảnh / video"]',
    '[role="button"][aria-label*="Photo/video"]',
    '[role="button"][aria-label*="Photo / video"]',
    '[role="button"][aria-label*="Add photos"]',
    '[aria-label*="Thêm ảnh"]'
  ],
  imageFileInputs: [
    'input[type="file"][accept*="image"]',
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"][accept*=".jpeg"]',
    'input[type="file"][accept*=".png"]',
    'input[type="file"][multiple]',
    'input[type="file"]'
  ],
  postButtonNames: [
    /^Đăng$/i,
    /^Post$/i
  ],
  editorCandidates: [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][contenteditable]:not([contenteditable="false"])',
    '[aria-placeholder*="Bạn đang nghĩ gì"]',
    "[aria-placeholder*=\"What's on your mind\"]",
    '[aria-label*="Bạn đang nghĩ gì"]',
    "[aria-label*=\"What's on your mind\"]",
    'div[contenteditable="true"]',
    '[contenteditable]:not([contenteditable="false"])'
  ],
  composerDialogSignals: [
    'Tạo bài viết',
    'Create post'
  ],
  fileInput: 'input[type="file"]',
  dialog: '[role="dialog"]'
};

export const SECURITY_SIGNALS = [
  'captcha',
  'checkpoint',
  'security check',
  'enter security code',
  'login approval',
  'two-factor authentication',
  'two factor authentication',
  'confirm your identity',
  'session expired',
  'xác minh tài khoản',
  'xác nhận danh tính',
  'xác nhận đây là bạn',
  'kiểm tra bảo mật',
  'nhập mã bảo mật',
  'phê duyệt đăng nhập',
  'mã xác thực hai yếu tố',
  'phiên đã hết hạn'
];

export const LOGIN_PAGE_SIGNALS = [
  'log into facebook',
  'đăng nhập facebook',
  'email or phone number',
  'email hoặc số điện thoại'
];

export const POST_FAILURE_SIGNALS = [
  'we couldn\'t post',
  'couldn\'t post',
  'unable to post',
  'something went wrong',
  'try again later',
  'không thể đăng',
  'không đăng được',
  'đã xảy ra lỗi',
  'vui lòng thử lại sau'
];
