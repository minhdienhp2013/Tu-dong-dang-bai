export {};
declare global {
  interface Window {
    autoSocial: {
      getConfig(): Promise<any>;
      saveConfig(data: any): Promise<any>;
      chooseFolder(): Promise<any>;
      scan(): Promise<any[]>;
      generateDraft(folderPath?: string): Promise<any>;
      postDraft(draft: any): Promise<any>;
      openLogin(): Promise<any>;
      recentPosts(): Promise<any[]>;
      onStatus(cb: (message: string) => void): void;
    };
  }
}
