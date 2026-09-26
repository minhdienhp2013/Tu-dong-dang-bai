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
