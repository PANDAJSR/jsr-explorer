import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  fileManager: {
    getHomeDirectory: () => ipcRenderer.invoke('file-manager:get-home-directory'),
    listDirectory: (directoryPath: string) => ipcRenderer.invoke('file-manager:list-directory', directoryPath),
    openPath: (targetPath: string) => ipcRenderer.invoke('file-manager:open-path', targetPath),
    getParentDirectory: (directoryPath: string) =>
      ipcRenderer.invoke('file-manager:get-parent-directory', directoryPath),
    getFileIcon: (targetPath: string) => ipcRenderer.invoke('file-manager:get-file-icon', targetPath),
    getQuickPreview: (targetPath: string) => ipcRenderer.invoke('file-manager:get-quick-preview', targetPath),
    copyPathsToDirectory: (sourcePaths: string[], destinationDirectory: string) =>
      ipcRenderer.invoke('file-manager:copy-paths-to-directory', sourcePaths, destinationDirectory),
    movePathsToDirectory: (sourcePaths: string[], destinationDirectory: string) =>
      ipcRenderer.invoke('file-manager:move-paths-to-directory', sourcePaths, destinationDirectory),
    renamePath: (sourcePath: string, newName: string) => ipcRenderer.invoke('file-manager:rename-path', sourcePath, newName),
    createDirectory: (parentPath: string, name: string) => ipcRenderer.invoke('file-manager:create-directory', parentPath, name),
    createArchive: (
      sourcePaths: string[],
      destinationDirectory: string,
      options: {
        format: 'zip' | 'tar.gz'
        compressionLevel: number
        password: string
        outputName: string
      }
    ) => ipcRenderer.invoke('file-manager:create-archive', sourcePaths, destinationDirectory, options),
    trashPaths: (sourcePaths: string[]) => ipcRenderer.invoke('file-manager:trash-paths', sourcePaths),
    writeClipboardPaths: (sourcePaths: string[], mode: 'copy' | 'cut') =>
      ipcRenderer.invoke('file-manager:write-clipboard-paths', sourcePaths, mode),
    pasteClipboardPaths: (destinationDirectory: string) =>
      ipcRenderer.invoke('file-manager:paste-clipboard-paths', destinationDirectory),
    startNativeDrag: (sourcePaths: string[]) => ipcRenderer.send('file-manager:start-native-drag', sourcePaths),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    getPlatform: () => ipcRenderer.invoke('file-manager:get-platform')
  }
})
