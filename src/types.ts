export type RunMode = 'test' | 'auto';
export type FacebookLoginStatus = 'logged_in' | 'needs_check' | 'logged_out';
export type PostErrorCode =
  | 'NETWORK_ERROR'
  | 'AI_ERROR'
  | 'FACEBOOK_UI_CHANGED'
  | 'NOT_LOGGED_IN'
  | 'SECURITY_CHECK'
  | 'UPLOAD_ERROR'
  | 'POST_UNCERTAIN'
  | 'UNKNOWN';

export type AppConfig = {
  aiProvider: 'deepseek' | 'ollama';
  deepseekApiKey: string;
  deepseekModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  stylePrompt: string;
  postingTimes: string[];
  autoPostEnabled: boolean;
  schedulerPaused: boolean;
  daysBeforeRepeatProduct: number;
  imageReuseAfterDays: number;
  imagesPerPost: number;
  browserProfileDir: string;
  runMode: RunMode;
  autoStartWindows: boolean;
  startMinimized: boolean;
  minimizeToTray: boolean;
  keepRunningInTray: boolean;
  defaultStyleId: number | null;
};

export type CategoryRecord = {
  id: number;
  parent_id: number | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ProductRecord = {
  id: number;
  category_id: number | null;
  category_name?: string | null;
  name: string;
  description: string;
  info_text: string;
  default_hashtags: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export type ProductImageRecord = {
  id: number;
  product_id: number;
  file_path: string;
  note: string;
  sort_order: number;
  active: number;
  used_count: number;
  last_used_at: string | null;
  created_at: string;
};

export type ContentDraftRecord = {
  id: number;
  product_id: number;
  product_name?: string;
  title: string;
  caption: string;
  hashtags: string;
  source: 'ai' | 'manual';
  status: 'draft' | 'approved' | 'used';
  ai_original?: string | null;
  style_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type SocialPostRecord = {
  id: number;
  product_id: number;
  product_name?: string;
  content_id: number | null;
  platform: 'facebook';
  image_ids_json: string;
  scheduled_at: string | null;
  scheduled_local_key?: string | null;
  mode?: RunMode;
  status: 'draft' | 'pending' | 'preparing' | 'scheduled' | 'posting' | 'prepared' | 'posted' | 'failed' | 'uncertain' | 'cancelled';
  error_code?: PostErrorCode | null;
  retry_count?: number;
  next_retry_at?: string | null;
  posted_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  title?: string;
  caption?: string;
  hashtags?: string;
};

export type AiContentResult = {
  title: string;
  caption: string;
  hashtags: string;
};

export type ProductFolder = {
  name: string;
  folderPath: string;
  infoText: string;
  images: string[];
  unusedImages: string[];
  lastPostedAt?: string | null;
};

export type DraftPost = {
  productId?: number;
  contentId?: number | null;
  imageIds?: number[];
  productName: string;
  productFolder: string;
  caption: string;
  aiOriginal?: string;
  images: string[];
  mode?: RunMode;
  jobKey?: string;
};

export type StyleRecord = {
  id: number;
  name: string;
  prompt: string;
  enabled: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

export type LearningRecord = {
  id: number;
  product_name: string;
  ai_original: string;
  user_final: string;
  created_at: string;
};

export type FacebookPublishResult = {
  prepared: boolean;
  posted: boolean;
  submitted?: boolean;
  confirmation?: 'prepared' | 'confirmed' | 'uncertain';
};

export type DashboardSummary = {
  productCount: number;
  imageCount: number;
  postedToday: number;
  failedToday: number;
  nextPostAt: string | null;
  nextProduct: string | null;
};
