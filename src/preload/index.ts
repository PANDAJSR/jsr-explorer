import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  fileManager: {
    getHomeDirectory: () => ipcRenderer.invoke('file-manager:get-home-directory'),
    listDirectory: (directoryPath: string) => ipcRenderer.invoke('file-manager:list-directory', directoryPath),
    watchDirectories: (directoryPaths: string[]) => ipcRenderer.invoke('file-manager:watch-directories', directoryPaths),
    onDirectoryChanged: (handler: (directoryPath: string) => void) => {
      const listener = (_: IpcRendererEvent, directoryPath: string): void => handler(directoryPath)
      ipcRenderer.on('file-manager:directory-changed', listener)
      return () => ipcRenderer.removeListener('file-manager:directory-changed', listener)
    },
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
    writeClipboardText: (text: string) => ipcRenderer.invoke('file-manager:write-clipboard-text', text),
    writeClipboardPaths: (sourcePaths: string[], mode: 'copy' | 'cut') =>
      ipcRenderer.invoke('file-manager:write-clipboard-paths', sourcePaths, mode),
    pasteClipboardPaths: (destinationDirectory: string) =>
      ipcRenderer.invoke('file-manager:paste-clipboard-paths', destinationDirectory),
    startNativeDrag: (sourcePaths: string[], iconDataUrl?: string) =>
      ipcRenderer.send('file-manager:start-native-drag', sourcePaths, iconDataUrl),
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    getPlatform: () => ipcRenderer.invoke('file-manager:get-platform'),
    readLayout: () => ipcRenderer.invoke('file-manager:read-layout'),
    saveLayout: (layout: unknown) => ipcRenderer.invoke('file-manager:save-layout', layout),
    saveLayoutBeforeUnload: (layout: unknown) => ipcRenderer.send('file-manager:save-layout-before-unload', layout)
  },
  terminal: {
    create: (options: { id: string; cwd: string; cols: number; rows: number }) => ipcRenderer.invoke('terminal:create', options),
    write: (terminalId: string, data: string) => ipcRenderer.send('terminal:write', terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', terminalId, cols, rows),
    dispose: (terminalId: string) => ipcRenderer.send('terminal:dispose', terminalId),
    onData: (handler: (terminalId: string, data: string) => void) => {
      const listener = (_: IpcRendererEvent, terminalId: string, data: string): void => handler(terminalId, data)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (handler: (terminalId: string, exit: { exitCode: number | null; signal?: number }) => void) => {
      const listener = (
        _: IpcRendererEvent,
        terminalId: string,
        exit: { exitCode: number | null; signal?: number }
      ): void => handler(terminalId, exit)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    }
  }
})
