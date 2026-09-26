import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('autoSocial', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (data: any) => ipcRenderer.invoke('config:save', data),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  scan: () => ipcRenderer.invoke('products:scan'),

  listCategories: () => ipcRenderer.invoke('categories:list'),
  createCategory: (data: any) => ipcRenderer.invoke('categories:create', data),
  updateCategory: (id: number, data: any) => ipcRenderer.invoke('categories:update', id, data),
  deleteCategory: (id: number) => ipcRenderer.invoke('categories:delete', id),

  listProducts: (categoryId?: number | null) => ipcRenderer.invoke('catalog:products:list', categoryId),
  createProduct: (data: any) => ipcRenderer.invoke('catalog:products:create', data),
  updateProduct: (id: number, data: any) => ipcRenderer.invoke('catalog:products:update', id, data),
  deleteProduct: (id: number) => ipcRenderer.invoke('catalog:products:delete', id),

  listImages: (productId: number) => ipcRenderer.invoke('catalog:images:list', productId),
  addImages: (productId: number) => ipcRenderer.invoke('catalog:images:add', productId),
  updateImage: (id: number, data: any) => ipcRenderer.invoke('catalog:images:update', id, data),
  deleteImage: (id: number) => ipcRenderer.invoke('catalog:images:delete', id),

  listContents: (productId?: number) => ipcRenderer.invoke('content:list', productId),
  generateContent: (productId: number) => ipcRenderer.invoke('content:generate', productId),
  saveManualContent: (productId: number, data: any) => ipcRenderer.invoke('content:create-manual', productId, data),
  updateContent: (id: number, data: any) => ipcRenderer.invoke('content:update', id, data),
  deleteContent: (id: number) => ipcRenderer.invoke('content:delete', id),

  listScheduledPosts: () => ipcRenderer.invoke('schedule:list'),
  schedulePost: (data: any) => ipcRenderer.invoke('schedule:create', data),
  cancelPost: (id: number) => ipcRenderer.invoke('schedule:cancel', id),
  postNow: (postId: number) => ipcRenderer.invoke('schedule:post-now', postId),
  listHistory: () => ipcRenderer.invoke('history:list'),

  openLogin: () => ipcRenderer.invoke('facebook:login'),
  generateDraft: (folderPath?: string) => ipcRenderer.invoke('draft:generate', folderPath),
  postDraft: (draft: any) => ipcRenderer.invoke('facebook:post', draft),
  recentPosts: () => ipcRenderer.invoke('posts:recent'),
  onStatus: (cb: (message: string) => void) => ipcRenderer.on('status', (_e, msg) => cb(msg))
});
