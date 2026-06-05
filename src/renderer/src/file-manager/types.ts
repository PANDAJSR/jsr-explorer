export type SortKey = 'name' | 'modifiedAt' | 'size'
export type SortDirection = 'asc' | 'desc'
export type ColumnKey = 'name' | 'modifiedAt' | 'size'
export type SplitDirection = 'horizontal' | 'vertical'
export type MoveDirection = 'left' | 'right' | 'up' | 'down'
export type Platform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
export type FocusState = 'primary' | 'secondary' | 'none'
export type QuickPreviewKind = 'image' | 'video' | 'audio'

export type QuickPreviewState = {
  entryName: string
  kind: QuickPreviewKind
  sourceUrl: string
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

export type PaneState = {
  id: string
  isClosing: boolean
  enterFrom: 'right' | 'bottom' | null
  tabs: FileTabState[]
  activeTabId: string
}

export type SplitNode =
  | {
      type: 'pane'
      paneId: string
    }
  | {
      type: 'split'
      direction: SplitDirection
      children: [SplitNode, SplitNode]
    }
