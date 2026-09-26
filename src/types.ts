export type AppConfig = {
  rootFolder: string;
  aiProvider: 'deepseek' | 'ollama';
  deepseekApiKey: string;
  deepseekModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  stylePrompt: string;
  postingTimes: string[];
  autoPostEnabled: boolean;
  daysBeforeRepeatProduct: number;
  imagesPerPost: number;
  browserProfileDir: string;
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
  status: 'draft' | 'scheduled' | 'posting' | 'posted' | 'failed' | 'cancelled';
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
  productName: string;
  productFolder: string;
  caption: string;
  images: string[];
};
