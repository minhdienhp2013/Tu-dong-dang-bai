import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('autoSocial', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (data: any) => ipcRenderer.invoke('config:save', data),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  scan: () => ipcRenderer.invoke('products:scan'),
  generateDraft: (folderPath?: string) => ipcRenderer.invoke('draft:generate', folderPath),
  postDraft: (draft: any) => ipcRenderer.invoke('facebook:post', draft),
  openLogin: () => ipcRenderer.invoke('facebook:login'),
  recentPosts: () => ipcRenderer.invoke('posts:recent'),
  onStatus: (cb: (message: string) => void) => ipcRenderer.on('status', (_e, msg) => cb(msg))
});
