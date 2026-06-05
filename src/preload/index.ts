import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  fileManager: {
    getHomeDirectory: () => ipcRenderer.invoke('file-manager:get-home-directory'),
    listDirectory: (directoryPath: string) => ipcRenderer.invoke('file-manager:list-directory', directoryPath),
    openPath: (targetPath: string) => ipcRenderer.invoke('file-manager:open-path', targetPath),
    getParentDirectory: (directoryPath: string) =>
      ipcRenderer.invoke('file-manager:get-parent-directory', directoryPath),
    getFileIcon: (targetPath: string) => ipcRenderer.invoke('file-manager:get-file-icon', targetPath),
    copyPathsToDirectory: (sourcePaths: string[], destinationDirectory: string) =>
      ipcRenderer.invoke('file-manager:copy-paths-to-directory', sourcePaths, destinationDirectory),
    startNativeDrag: (sourcePaths: string[]) => ipcRenderer.send('file-manager:start-native-drag', sourcePaths),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    getPlatform: () => ipcRenderer.invoke('file-manager:get-platform')
  }
})
