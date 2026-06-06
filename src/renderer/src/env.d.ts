/// <reference types="vite/client" />

type FileManagerEntry = {
  name: string
  path: string
  type: 'directory' | 'file'
  modifiedAt: number
  size: number | null
}

type DirectoryPayload = {
  path: string
  parentPath: string | null
  entries: FileManagerEntry[]
}

type OpenPathResult =
  | {
      action: 'enter-directory'
      path: string
    }
  | {
      action: 'open-file'
      path: string
    }

type ArchiveFormat = 'zip' | 'tar.gz'

type ArchiveCreationOptions = {
  format: ArchiveFormat
  compressionLevel: number
  password: string
  outputName: string
}

type ArchivePreviewEntry = {
  name: string
  compressedSize: number
  uncompressedSize: number
  isDirectory: boolean
}

type SpreadsheetPreviewSheet = {
  name: string
  rows: string[][]
}

type QuickPreviewPayload =
  | {
      kind: 'image' | 'video' | 'audio' | 'pdf' | 'model'
      sourceUrl: string
    }
  | {
      kind: 'text' | 'document'
      text: string
    }
  | {
      kind: 'spreadsheet'
      sheets: SpreadsheetPreviewSheet[]
    }
  | {
      kind: 'archive'
      entries: ArchivePreviewEntry[]
      totalEntries: number
    }

type PersistedSplitNode =
  | {
      type: 'pane'
      paneId: string
    }
  | {
      type: 'split'
      direction: 'horizontal' | 'vertical'
      ratio: number
      children: [PersistedSplitNode, PersistedSplitNode]
    }

type PersistedFileManagerLayout = {
  version: 1
  rootNode: PersistedSplitNode
  panes: Array<
    | {
        kind: 'files'
        id: string
        tabs: Array<{
          kind: 'file'
          id: string
          currentPath: string
          backStack: string[]
          forwardStack: string[]
          sortKey: 'name' | 'modifiedAt' | 'size'
          sortDirection: 'asc' | 'desc'
        }>
        activeTabId: string
      }
    | {
        kind: 'terminal'
        id: string
        tabs: Array<{
          kind: 'terminal'
          id: string
          cwd: string
          title: string
        }>
        activeTabId: string
      }
  >
  focusedPaneId: string
  secondaryPaneId: string | null
  lastFocusedFilePath: string
}

interface Window {
  electron: {
    fileManager: {
      getHomeDirectory: () => Promise<string>
      listDirectory: (directoryPath: string) => Promise<DirectoryPayload>
      watchDirectories: (directoryPaths: string[]) => Promise<void>
      onDirectoryChanged: (handler: (directoryPath: string) => void) => () => void
      openPath: (targetPath: string) => Promise<OpenPathResult>
      getParentDirectory: (directoryPath: string) => Promise<string | null>
      getFileIcon: (targetPath: string) => Promise<string>
      getQuickPreview: (targetPath: string) => Promise<QuickPreviewPayload>
      copyPathsToDirectory: (sourcePaths: string[], destinationDirectory: string) => Promise<string[]>
      movePathsToDirectory: (sourcePaths: string[], destinationDirectory: string) => Promise<string[]>
      renamePath: (sourcePath: string, newName: string) => Promise<string>
      createDirectory: (parentPath: string, name: string) => Promise<string>
      createArchive: (
        sourcePaths: string[],
        destinationDirectory: string,
        options: ArchiveCreationOptions
      ) => Promise<string>
      trashPaths: (sourcePaths: string[]) => Promise<void>
      writeClipboardPaths: (sourcePaths: string[], mode: 'copy' | 'cut') => Promise<void>
      pasteClipboardPaths: (destinationDirectory: string) => Promise<string[]>
      startNativeDrag: (sourcePaths: string[], iconDataUrl?: string) => void
      getPathForFile: (file: File) => string
      getPlatform: () => Promise<'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'>
      readLayout: () => Promise<unknown>
      saveLayout: (layout: PersistedFileManagerLayout) => Promise<void>
      saveLayoutBeforeUnload: (layout: PersistedFileManagerLayout) => void
    }
    terminal: {
      create: (options: { id: string; cwd: string; cols: number; rows: number }) => Promise<{
        id: string
        cwd: string
        shellName: string
      }>
      write: (terminalId: string, data: string) => void
      resize: (terminalId: string, cols: number, rows: number) => void
      dispose: (terminalId: string) => void
      onData: (handler: (terminalId: string, data: string) => void) => () => void
      onExit: (handler: (terminalId: string, exit: { exitCode: number | null; signal?: number }) => void) => () => void
    }
  }
}
