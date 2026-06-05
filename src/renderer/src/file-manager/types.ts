export type SortKey = 'name' | 'modifiedAt' | 'size'
export type SortDirection = 'asc' | 'desc'
export type ColumnKey = 'name' | 'modifiedAt' | 'size'
export type SplitDirection = 'horizontal' | 'vertical'
export type MoveDirection = 'left' | 'right' | 'up' | 'down'
export type Platform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
export type FocusState = 'primary' | 'secondary' | 'none'
export type QuickPreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'spreadsheet' | 'archive' | 'model'
export type ArchiveFormat = 'zip' | 'tar.gz'

export type ArchiveCreationOptions = {
  format: ArchiveFormat
  compressionLevel: number
  password: string
  outputName: string
}

export type ArchivePreviewEntry = {
  name: string
  compressedSize: number
  uncompressedSize: number
  isDirectory: boolean
}

export type SpreadsheetPreviewSheet = {
  name: string
  rows: string[][]
}

export type QuickPreviewState =
  | {
      entryName: string
      kind: 'image' | 'video' | 'audio' | 'pdf' | 'model'
      sourceUrl: string
    }
  | {
      entryName: string
      kind: 'text' | 'document'
      text: string
    }
  | {
      entryName: string
      kind: 'spreadsheet'
      sheets: SpreadsheetPreviewSheet[]
    }
  | {
      entryName: string
      kind: 'archive'
      entries: ArchivePreviewEntry[]
      totalEntries: number
    }

export type FavoritePath = {
  id: string
  path: string
  title: string
}

export type PathSegment = {
  label: string
  path: string
}

export type FileTabState = {
  kind: 'file'
  id: string
  currentPath: string
  parentPath: string | null
  entries: FileManagerEntry[]
  selectedPaths: string[]
  activePath: string | null
  selectionAnchorPath: string | null
  errorMessage: string
  isLoading: boolean
  backStack: string[]
  forwardStack: string[]
  sortKey: SortKey
  sortDirection: SortDirection
  isEditingPath: boolean
  editablePath: string
  loadSequence: number
}

export type TerminalTabState = {
  kind: 'terminal'
  id: string
  cwd: string
  title: string
  terminalId: string | null
  exitMessage: string
}

export type FilePaneState = {
  kind: 'files'
  id: string
  isClosing: boolean
  enterFrom: 'right' | 'bottom' | null
  tabs: FileTabState[]
  activeTabId: string
}

export type TerminalPaneState = {
  kind: 'terminal'
  id: string
  isClosing: boolean
  enterFrom: 'right' | 'bottom' | null
  tabs: TerminalTabState[]
  activeTabId: string
}

export type PaneState = FilePaneState | TerminalPaneState

export type SplitNode =
  | {
      type: 'pane'
      paneId: string
    }
  | {
      type: 'split'
      direction: SplitDirection
      ratio: number
      children: [SplitNode, SplitNode]
    }

export type PersistedFileTabLayout = {
  kind: 'file'
  id: string
  currentPath: string
  backStack: string[]
  forwardStack: string[]
  sortKey: SortKey
  sortDirection: SortDirection
}

export type PersistedTerminalTabLayout = {
  kind: 'terminal'
  id: string
  cwd: string
  title: string
}

export type PersistedFilePaneLayout = {
  kind: 'files'
  id: string
  tabs: PersistedFileTabLayout[]
  activeTabId: string
}

export type PersistedTerminalPaneLayout = {
  kind: 'terminal'
  id: string
  tabs: PersistedTerminalTabLayout[]
  activeTabId: string
}

export type PersistedPaneLayout = PersistedFilePaneLayout | PersistedTerminalPaneLayout

export type PersistedFileManagerLayout = {
  version: 1
  rootNode: SplitNode
  panes: PersistedPaneLayout[]
  focusedPaneId: string
  secondaryPaneId: string | null
  lastFocusedFilePath: string
}
