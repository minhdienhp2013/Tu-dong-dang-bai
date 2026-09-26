export {};
declare global {
  interface Window {
    autoSocial: {
      getConfig(): Promise<any>;
      saveConfig(data: any): Promise<any>;
      chooseFolder(): Promise<any>;
      scan(): Promise<any[]>;

      listCategories(): Promise<any[]>;
      createCategory(data: any): Promise<any>;
      updateCategory(id: number, data: any): Promise<any>;
      deleteCategory(id: number): Promise<any>;

      listProducts(categoryId?: number | null): Promise<any[]>;
      createProduct(data: any): Promise<any>;
      updateProduct(id: number, data: any): Promise<any>;
      deleteProduct(id: number): Promise<any>;

      listImages(productId: number): Promise<any[]>;
      addImages(productId: number): Promise<any[]>;
      updateImage(id: number, data: any): Promise<any>;
      deleteImage(id: number): Promise<any>;

      listContents(productId?: number): Promise<any[]>;
      generateContent(productId: number): Promise<any>;
      saveManualContent(productId: number, data: any): Promise<any>;
      updateContent(id: number, data: any): Promise<any>;
      deleteContent(id: number): Promise<any>;

      listScheduledPosts(): Promise<any[]>;
      schedulePost(data: any): Promise<any>;
      cancelPost(id: number): Promise<any>;
      postNow(postId: number): Promise<any>;
      listHistory(): Promise<any[]>;

      listStyles(): Promise<any[]>;
      createStyle(data: any): Promise<any>;
      updateStyle(id: number, data: any): Promise<any>;
      deleteStyle(id: number): Promise<any>;
      setDefaultStyle(id: number): Promise<any>;

      openLogin(): Promise<any>;
      checkFacebookStatus(): Promise<any>;
      generateDraft(folderPath?: string): Promise<any>;
      postDraft(draft: any): Promise<any>;
      recentPosts(): Promise<any[]>;

      pauseScheduler(): Promise<any>;
      resumeScheduler(): Promise<any>;
      postNext(): Promise<any>;
      getDashboard(): Promise<any>;
      getLogPath(): Promise<string>;
      onStatus(cb: (message: string) => void): void;
    };
  }
}
