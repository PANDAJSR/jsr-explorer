import type {
  PaneState,
  PersistedFileManagerLayout,
  PersistedFilePaneLayout,
  PersistedFileTabLayout,
  PersistedPaneLayout,
  PersistedTerminalPaneLayout,
  PersistedTerminalTabLayout,
  SortDirection,
  SortKey,
  SplitDirection,
  SplitNode
} from './types'

const layoutVersion = 1
const sortKeys = new Set<SortKey>(['name', 'modifiedAt', 'size'])
const sortDirections = new Set<SortDirection>(['asc', 'desc'])
const splitDirections = new Set<SplitDirection>(['horizontal', 'vertical'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const cloneSplitNode = (node: SplitNode): SplitNode => {
  if (node.type === 'pane') {
    return {
      type: 'pane',
      paneId: node.paneId
    }
  }

  return {
    type: 'split',
    direction: node.direction,
    ratio: node.ratio,
    children: [cloneSplitNode(node.children[0]), cloneSplitNode(node.children[1])]
  }
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []

const normalizeFileTab = (value: unknown): PersistedFileTabLayout | null => {
  if (!isRecord(value) || value.kind !== 'file' || typeof value.id !== 'string' || typeof value.currentPath !== 'string') {
    return null
  }

  if (value.currentPath.length === 0) {
    return null
  }

  const sortKey = sortKeys.has(value.sortKey as SortKey) ? (value.sortKey as SortKey) : 'name'
  const sortDirection = sortDirections.has(value.sortDirection as SortDirection)
    ? (value.sortDirection as SortDirection)
    : 'asc'

  return {
    kind: 'file',
    id: value.id,
    currentPath: value.currentPath,
    backStack: stringArray(value.backStack),
    forwardStack: stringArray(value.forwardStack),
    sortKey,
    sortDirection
  }
}

const normalizeTerminalTab = (value: unknown): PersistedTerminalTabLayout | null => {
  if (!isRecord(value) || value.kind !== 'terminal' || typeof value.id !== 'string' || typeof value.cwd !== 'string') {
    return null
  }

  return {
    kind: 'terminal',
    id: value.id,
    cwd: value.cwd,
    title: typeof value.title === 'string' && value.title.length > 0 ? value.title : 'Terminal'
  }
}

const normalizePane = (value: unknown): PersistedPaneLayout | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || !Array.isArray(value.tabs)) {
    return null
  }

  if (value.kind === 'files') {
    const tabs = value.tabs.map(normalizeFileTab).filter((tab): tab is PersistedFileTabLayout => tab !== null)

    if (tabs.length === 0) {
      return null
    }

    return {
      kind: 'files',
      id: value.id,
      tabs,
      activeTabId:
        typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
          ? value.activeTabId
          : tabs[0].id
    } satisfies PersistedFilePaneLayout
  }

  if (value.kind === 'terminal') {
    const tabs = value.tabs
      .map(normalizeTerminalTab)
      .filter((tab): tab is PersistedTerminalTabLayout => tab !== null)

    if (tabs.length === 0) {
      return null
    }

    return {
      kind: 'terminal',
      id: value.id,
      tabs,
      activeTabId:
        typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
          ? value.activeTabId
          : tabs[0].id
    } satisfies PersistedTerminalPaneLayout
  }

  return null
}

const normalizeSplitNode = (value: unknown, paneIds: Set<string>): SplitNode | null => {
  if (!isRecord(value)) {
    return null
  }

  if (value.type === 'pane' && typeof value.paneId === 'string' && paneIds.has(value.paneId)) {
    return {
      type: 'pane',
      paneId: value.paneId
    }
  }

  if (value.type !== 'split' || !splitDirections.has(value.direction as SplitDirection) || !Array.isArray(value.children)) {
    return null
  }

  const first = normalizeSplitNode(value.children[0], paneIds)
  const second = normalizeSplitNode(value.children[1], paneIds)

  if (!first || !second) {
    return null
  }

  const ratio = typeof value.ratio === 'number' && Number.isFinite(value.ratio) ? value.ratio : 0.5

  return {
    type: 'split',
    direction: value.direction as SplitDirection,
    ratio: Math.max(0.1, Math.min(0.9, ratio)),
    children: [first, second]
  }
}

export const normalizeFileManagerLayout = (value: unknown): PersistedFileManagerLayout | null => {
  if (!isRecord(value) || value.version !== layoutVersion || !Array.isArray(value.panes)) {
    return null
  }

  const panes = value.panes.map(normalizePane).filter((pane): pane is PersistedPaneLayout => pane !== null)
  const uniquePanes = panes.filter((pane, index) => panes.findIndex((item) => item.id === pane.id) === index)

  if (uniquePanes.length === 0) {
    return null
  }

  const paneIds = new Set(uniquePanes.map((pane) => pane.id))
  const rootNode = normalizeSplitNode(value.rootNode, paneIds)

  if (!rootNode) {
    return null
  }

  const focusedPaneId =
    typeof value.focusedPaneId === 'string' && paneIds.has(value.focusedPaneId) ? value.focusedPaneId : uniquePanes[0].id
  const secondaryPaneId =
    typeof value.secondaryPaneId === 'string' && paneIds.has(value.secondaryPaneId) ? value.secondaryPaneId : null

  return {
    version: layoutVersion,
    rootNode,
    panes: uniquePanes,
    focusedPaneId,
    secondaryPaneId,
    lastFocusedFilePath: typeof value.lastFocusedFilePath === 'string' ? value.lastFocusedFilePath : ''
  }
}

export const createFileManagerLayoutSnapshot = (
  panes: Record<string, PaneState>,
  rootNode: SplitNode,
  focusedPaneId: string,
  secondaryPaneId: string | null,
  lastFocusedFilePath: string
): PersistedFileManagerLayout => ({
  version: layoutVersion,
  rootNode: cloneSplitNode(rootNode),
  focusedPaneId,
  secondaryPaneId,
  lastFocusedFilePath,
  panes: Object.values(panes).map((pane): PersistedPaneLayout => {
    if (pane.kind === 'terminal') {
      return {
        kind: 'terminal',
        id: pane.id,
        activeTabId: pane.activeTabId,
        tabs: pane.tabs.map((tab) => ({
          kind: 'terminal',
          id: tab.id,
          cwd: tab.cwd,
          title: tab.title
        }))
      }
    }

    return {
      kind: 'files',
      id: pane.id,
      activeTabId: pane.activeTabId,
      tabs: pane.tabs.map((tab) => ({
          kind: 'file',
          id: tab.id,
          currentPath: tab.currentPath,
          backStack: [...tab.backStack],
          forwardStack: [...tab.forwardStack],
          sortKey: tab.sortKey,
          sortDirection: tab.sortDirection
      }))
    }
  })
})
