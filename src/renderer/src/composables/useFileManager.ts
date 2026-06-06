import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch, type PropType } from 'vue'
import ArchiveDialog from '../components/ArchiveDialog.vue'
import ContextMenu from '../components/ContextMenu.vue'
import FavoritesManager from '../components/FavoritesManager.vue'
import FilePane from '../components/FilePane.vue'
import NameDialog from '../components/NameDialog.vue'
import QuickPreview from '../components/QuickPreview.vue'
import ShortcutHelp from '../components/ShortcutHelp.vue'
import TerminalPane from '../components/TerminalPane.vue'
import {
  copySelectionToClipboard,
  copySelectionToSecondary,
  createArchiveFromSelection,
  createFolder,
  cutSelectionToClipboard,
  duplicateSelection,
  getSelectedEntries,
  moveSelectionToSecondary,
  pasteClipboardIntoTab,
  renameActiveItem,
  trashSelection
} from '../file-manager/fileActions'
import { getDirectionalPaneId } from '../file-manager/focusNavigation'
import { getPathLabel } from '../file-manager/formatters'
import { createKeyboardHandler } from '../file-manager/keyboard'
import { createFileManagerLayoutSnapshot, normalizeFileManagerLayout } from '../file-manager/layoutPersistence'
import { createStateFactory } from '../file-manager/stateFactory'
import { sortEntriesForTab } from '../file-manager/sortEntries'
import { findFirstPaneId, removePaneNode, replacePaneNode } from '../file-manager/splitTree'
import type { ArchiveCreationOptions, ColumnKey, FavoritePath, FileTabState, MoveDirection, PaneState, PersistedFileManagerLayout, Platform, QuickPreviewState, SortKey, SplitDirection, SplitNode, TerminalPaneState } from '../file-manager/types'

const favoriteStorageKey = 'jsr-explorer.favorite-paths'

const readFavoritePaths = (): FavoritePath[] => {
  try {
    const payload = JSON.parse(window.localStorage.getItem(favoriteStorageKey) ?? '[]') as FavoritePath[]

    if (!Array.isArray(payload)) {
      return []
    }

    return payload.filter(
      (favorite): favorite is FavoritePath =>
        typeof favorite?.id === 'string' &&
        typeof favorite.path === 'string' &&
        favorite.path.length > 0 &&
        typeof favorite.title === 'string'
    )
  } catch {
    return []
  }
}

const writeFavoritePaths = (favorites: FavoritePath[]): void => {
  window.localStorage.setItem(favoriteStorageKey, JSON.stringify(favorites))
}

const createFavoritePath = (path: string): FavoritePath => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  path,
  title: getPathLabel(path)
})

export const useFileManager = () => {
const panes = reactive<Record<string, PaneState>>({})
const platform = ref<Platform>('darwin')
const focusedPaneId = ref('')
const secondaryPaneId = ref<string | null>(null)
const favorites = ref<FavoritePath[]>([])
const isFavoritesManagerOpen = ref(false)
const isShortcutHelpOpen = ref(false)
const quickPreview = ref<QuickPreviewState | null>(null)
const archiveDialog = ref<{
  defaultFileName: string
  selectedCount: number
  tab: FileTabState
} | null>(null)
const iconCache = reactive<Record<string, string>>({})
const columns = reactive<Record<ColumnKey, number>>({
  name: 520,
  modifiedAt: 220,
  size: 150
})
const contextMenu = ref<{
  items: Array<{ enabled: boolean; label: string; action: () => void }>
  x: number
  y: number
} | null>(null)
const nameDialog = ref<{
  defaultValue: string
  resolve: (value: string | null) => void
  title: string
} | null>(null)
let stopColumnResize: (() => void) | null = null
let stopSplitResize: (() => void) | null = null
let stopDirectoryChanged: (() => void) | null = null
let persistLayoutTimer: number | null = null
let isLayoutHydrated = false
const { cloneTabForPath, createPane, createTab, createTerminalPane, createTerminalTab } = createStateFactory()
const initialPane = createPane('')
panes[initialPane.id] = initialPane
focusedPaneId.value = initialPane.id
const lastFocusedFilePath = ref('')
const rootNode = ref<SplitNode>({
  type: 'pane',
  paneId: initialPane.id
})
const focusedPane = computed(() => panes[focusedPaneId.value] ?? null)
const secondaryPane = computed(() => (secondaryPaneId.value ? panes[secondaryPaneId.value] ?? null : null))
const getActiveFileTab = (pane: PaneState | null): FileTabState | null =>
  pane?.kind === 'files' ? pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0] ?? null : null
const getActiveTerminalTab = (pane: PaneState | null) =>
  pane?.kind === 'terminal' ? pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0] ?? null : null
const focusedTab = computed(() => getActiveFileTab(focusedPane.value))
const secondaryTab = computed(() => getActiveFileTab(secondaryPane.value))
const getOpenTabs = (): FileTabState[] =>
  Object.values(panes).flatMap((pane) => (pane.kind === 'files' ? pane.tabs : []))
const getOpenDirectoryPaths = (): string[] => [
  ...new Set(getOpenTabs().map((tab) => tab.currentPath).filter((path) => path.length > 0))
]
const syncWatchedDirectories = (): void => {
  window.electron.fileManager.watchDirectories(getOpenDirectoryPaths()).catch((error) => {
    const tab = focusedTab.value

    if (tab) {
      tab.errorMessage = error instanceof Error ? error.message : '无法监听文件夹变化。'
    }
  })
}
const getPaneFocusState = (paneId: string): 'primary' | 'secondary' | 'none' =>
  paneId === focusedPaneId.value ? 'primary' : paneId === secondaryPaneId.value ? 'secondary' : 'none'
const focusPane = (paneId: string): void => {
  if (!panes[paneId] || panes[paneId].isClosing || paneId === focusedPaneId.value) {
    return
  }
  secondaryPaneId.value = focusedPaneId.value || null
  focusedPaneId.value = paneId
  const tab = getActiveFileTab(panes[paneId])
  if (tab?.currentPath) {
    lastFocusedFilePath.value = tab.currentPath
  }
}
const hideContextMenu = (): void => {
  contextMenu.value = null
}
const requestName = (title: string, defaultValue = ''): Promise<string | null> =>
  new Promise((resolve) => {
    nameDialog.value?.resolve(null)
    nameDialog.value = {
      defaultValue,
      resolve,
      title
    }
  })
const closeNameDialog = (value: string | null): void => {
  const dialog = nameDialog.value

  if (!dialog) {
    return
  }

  nameDialog.value = null
  dialog.resolve(value)
}
const switchTab = (pane: PaneState, tabId: string): void => {
  pane.activeTabId = pane.tabs.some((tab) => tab.id === tabId) ? tabId : pane.activeTabId
  const tab = getActiveFileTab(pane)
  if (tab?.currentPath) {
    lastFocusedFilePath.value = tab.currentPath
  }
}
const loadFileIcons = (directoryEntries: FileManagerEntry[]): void => {
  for (const entry of directoryEntries) {
    if (entry.type !== 'file' || iconCache[entry.path]) {
      continue
    }
    window.electron.fileManager
      .getFileIcon(entry.path)
      .then((iconDataUrl) => {
        iconCache[entry.path] = iconDataUrl
      })
      .catch(() => {
        iconCache[entry.path] = ''
      })
  }
}
const applyDirectoryPayload = (
  tab: FileTabState,
  payload: DirectoryPayload,
  options: {
    preserveSelection: boolean
    pushHistory: boolean
  }
): void => {
  if (options.pushHistory && tab.currentPath && tab.currentPath !== payload.path) {
    tab.backStack.push(tab.currentPath)
    tab.forwardStack = []
  }

  const entryPaths = new Set(payload.entries.map((entry) => entry.path))
  const activePath = options.preserveSelection && tab.activePath && entryPaths.has(tab.activePath) ? tab.activePath : null
  const selectedPaths = options.preserveSelection
    ? tab.selectedPaths.filter((selectedPath) => entryPaths.has(selectedPath))
    : []

  tab.currentPath = payload.path
  tab.parentPath = payload.parentPath
  tab.entries = payload.entries
  tab.selectedPaths = selectedPaths
  tab.activePath = activePath ?? selectedPaths.at(-1) ?? null
  tab.selectionAnchorPath =
    tab.selectionAnchorPath && entryPaths.has(tab.selectionAnchorPath)
      ? tab.selectionAnchorPath
      : selectedPaths[0] ?? tab.activePath
  tab.isQuickFilterOpen = false
  tab.quickFilterQuery = ''
  tab.quickFilterActivePath = null
  loadFileIcons(payload.entries)
}
const loadDirectory = async (tab: FileTabState, directoryPath: string, pushHistory = true): Promise<void> => {
  const sequence = (tab.loadSequence += 1)
  tab.errorMessage = ''
  tab.isLoading = true
  try {
    const payload = await window.electron.fileManager.listDirectory(directoryPath)
    if (sequence !== tab.loadSequence) {
      return
    }
    applyDirectoryPayload(tab, payload, { preserveSelection: false, pushHistory })
    if (tab === focusedTab.value) {
      lastFocusedFilePath.value = payload.path
    }
  } catch (error) {
    if (sequence === tab.loadSequence) {
      tab.errorMessage = error instanceof Error ? error.message : '无法加载文件夹。'
    }
  } finally {
    if (sequence === tab.loadSequence) {
      tab.isLoading = false
    }
  }
}
const refreshDirectory = async (tab: FileTabState, directoryPath: string): Promise<void> => {
  if (tab.isLoading) {
    return
  }

  const sequence = tab.loadSequence

  try {
    const payload = await window.electron.fileManager.listDirectory(directoryPath)

    if (sequence !== tab.loadSequence || tab.currentPath !== directoryPath) {
      return
    }

    tab.errorMessage = ''
    applyDirectoryPayload(tab, payload, { preserveSelection: true, pushHistory: false })
  } catch (error) {
    if (sequence === tab.loadSequence && tab.currentPath === directoryPath) {
      tab.errorMessage = error instanceof Error ? error.message : '无法刷新文件夹。'
    }
  }
}
const createLayoutSnapshot = (): PersistedFileManagerLayout =>
  createFileManagerLayoutSnapshot(
    panes,
    rootNode.value,
    focusedPaneId.value,
    secondaryPaneId.value,
    lastFocusedFilePath.value
  )
const saveLayout = (): void => {
  if (!isLayoutHydrated) {
    return
  }

  window.electron.fileManager.saveLayout(createLayoutSnapshot()).catch((error) => {
    console.error('Failed to save file manager layout.', error)
  })
}
const scheduleLayoutSave = (): void => {
  if (!isLayoutHydrated) {
    return
  }

  if (persistLayoutTimer !== null) {
    window.clearTimeout(persistLayoutTimer)
  }

  persistLayoutTimer = window.setTimeout(() => {
    persistLayoutTimer = null
    saveLayout()
  }, 200)
}
const loadDefaultHomeLayout = async (): Promise<void> => {
  const homeDirectory = await window.electron.fileManager.getHomeDirectory()
  const tab = focusedTab.value

  if (tab) {
    tab.currentPath = homeDirectory
    lastFocusedFilePath.value = homeDirectory
    await loadDirectory(tab, homeDirectory, false)
  }
}
const replacePanes = (nextPanes: PaneState[]): void => {
  for (const paneId of Object.keys(panes)) {
    delete panes[paneId]
  }

  for (const pane of nextPanes) {
    panes[pane.id] = reactive(pane) as PaneState
  }
}
const restoreLayout = async (layout: PersistedFileManagerLayout): Promise<void> => {
  const nextPanes = layout.panes.map((paneLayout): PaneState => {
    if (paneLayout.kind === 'terminal') {
      const pane = createTerminalPane(paneLayout.tabs[0].cwd, paneLayout.id, paneLayout.tabs[0].id)
      pane.tabs = paneLayout.tabs.map((tabLayout) => ({
        ...createTerminalTab(tabLayout.cwd, tabLayout.id),
        title: tabLayout.title || 'Terminal'
      }))
      pane.activeTabId = pane.tabs.some((tab) => tab.id === paneLayout.activeTabId)
        ? paneLayout.activeTabId
        : pane.tabs[0].id
      return pane
    }

    const pane = createPane(paneLayout.tabs[0].currentPath, paneLayout.id, paneLayout.tabs[0].id)
    pane.tabs = paneLayout.tabs.map((tabLayout) => ({
      ...createTab(tabLayout.currentPath, tabLayout.id),
      backStack: [...tabLayout.backStack],
      forwardStack: [...tabLayout.forwardStack],
      sortKey: tabLayout.sortKey,
      sortDirection: tabLayout.sortDirection
    }))
    pane.activeTabId = pane.tabs.some((tab) => tab.id === paneLayout.activeTabId) ? paneLayout.activeTabId : pane.tabs[0].id
    return pane
  })

  replacePanes(nextPanes)
  rootNode.value = layout.rootNode
  focusedPaneId.value = panes[layout.focusedPaneId] ? layout.focusedPaneId : findFirstPaneId(rootNode.value)
  secondaryPaneId.value = layout.secondaryPaneId && panes[layout.secondaryPaneId] ? layout.secondaryPaneId : null
  lastFocusedFilePath.value = layout.lastFocusedFilePath

  await Promise.all(getOpenTabs().map((tab) => loadDirectory(tab, tab.currentPath, false)))
}
const hydrateLayout = async (): Promise<void> => {
  const persistedLayout = normalizeFileManagerLayout(await window.electron.fileManager.readLayout())

  if (persistedLayout) {
    await restoreLayout(persistedLayout)
    return
  }

  await loadDefaultHomeLayout()
}
const openEntry = async (tab: FileTabState, entry: FileManagerEntry): Promise<void> => {
  tab.errorMessage = ''
  try {
    const result = await window.electron.fileManager.openPath(entry.path)
    if (result.action === 'enter-directory') {
      await loadDirectory(tab, result.path)
    }
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法打开对象。'
  }
}
const openSelected = async (): Promise<void> => {
  const tab = focusedTab.value
  const entry = tab?.entries.find((item) => item.path === tab.activePath)
  if (tab && entry) {
    await openEntry(tab, entry)
  }
}
const previewSelected = async (): Promise<void> => {
  const tab = focusedTab.value
  const entry = tab?.entries.find((item) => item.path === tab.activePath)

  if (!tab || !entry || entry.type !== 'file') {
    return
  }

  tab.errorMessage = ''

  try {
    const preview = await window.electron.fileManager.getQuickPreview(entry.path)
    quickPreview.value = { entryName: entry.name, ...preview }
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法预览对象。'
  }
}
const closeQuickPreview = (): void => {
  quickPreview.value = null
}
const clearSelection = (): void => {
  const tab = focusedTab.value

  if (!tab) {
    return
  }

  tab.selectedPaths = []
  tab.activePath = null
  tab.selectionAnchorPath = null
}
const scrollActiveRowIntoView = (paneId: string): void => {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-pane-id="${paneId}"] .file-row.active`)?.scrollIntoView({
      block: 'nearest'
    })
  })
}
const moveSelection = (direction: 'previous' | 'next', extendSelection: boolean): void => {
  const pane = focusedPane.value
  const tab = focusedTab.value
  if (!pane || !tab || tab.entries.length === 0) {
    return
  }
  const sortedEntries = sortEntriesForTab(tab)
  const activeIndex = tab.activePath ? sortedEntries.findIndex((entry) => entry.path === tab.activePath) : -1
  const fallbackIndex = direction === 'next' ? -1 : sortedEntries.length
  const currentIndex = activeIndex === -1 ? fallbackIndex : activeIndex
  const nextIndex =
    direction === 'next' ? Math.min(sortedEntries.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1)
  const nextEntry = sortedEntries[nextIndex]
  if (!nextEntry) {
    return
  }
  if (extendSelection) {
    const anchorPath = tab.selectionAnchorPath ?? tab.activePath ?? nextEntry.path
    const anchorIndex = Math.max(0, sortedEntries.findIndex((entry) => entry.path === anchorPath))
    const startIndex = Math.min(anchorIndex, nextIndex)
    const endIndex = Math.max(anchorIndex, nextIndex)
    tab.selectionAnchorPath = sortedEntries[anchorIndex]?.path ?? nextEntry.path
    tab.activePath = nextEntry.path
    tab.selectedPaths = sortedEntries.slice(startIndex, endIndex + 1).map((entry) => entry.path)
    scrollActiveRowIntoView(pane.id)
    return
  }
  tab.activePath = nextEntry.path
  tab.selectionAnchorPath = nextEntry.path
  tab.selectedPaths = [nextEntry.path]
  scrollActiveRowIntoView(pane.id)
}
const goBack = async (tab = focusedTab.value): Promise<void> => {
  const targetPath = tab?.backStack.pop()
  if (!tab || !targetPath || !tab.currentPath) {
    return
  }
  tab.forwardStack.push(tab.currentPath)
  await loadDirectory(tab, targetPath, false)
}
const goForward = async (tab = focusedTab.value): Promise<void> => {
  const targetPath = tab?.forwardStack.pop()
  if (!tab || !targetPath || !tab.currentPath) {
    return
  }
  tab.backStack.push(tab.currentPath)
  await loadDirectory(tab, targetPath, false)
}
const goUp = async (tab = focusedTab.value): Promise<void> => {
  if (tab?.parentPath) {
    await loadDirectory(tab, tab.parentPath)
  }
}
const setSort = (tab: FileTabState, key: SortKey): void => {
  if (tab.sortKey === key) {
    tab.sortDirection = tab.sortDirection === 'asc' ? 'desc' : 'asc'
    return
  }
  tab.sortKey = key
  tab.sortDirection = 'asc'
}
const startQuickFilter = (initialQuery: string): void => {
  const tab = focusedTab.value

  if (!tab || initialQuery.trim().length === 0) {
    return
  }

  tab.quickFilterQuery = initialQuery
  tab.quickFilterActivePath = null
  tab.isQuickFilterOpen = true
}
const startColumnResize = (event: MouseEvent, column: ColumnKey): void => {
  event.preventDefault()
  event.stopPropagation()
  const startX = event.clientX
  const startWidth = columns[column]
  const minWidth = column === 'name' ? 240 : 120
  const handleMove = (moveEvent: MouseEvent): void => {
    columns[column] = Math.max(minWidth, startWidth + moveEvent.clientX - startX)
  }
  const handleUp = (): void => {
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    stopColumnResize = null
  }
  stopColumnResize?.()
  stopColumnResize = handleUp
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}
const startSplitResize = (event: MouseEvent, node: Extract<SplitNode, { type: 'split' }>): void => {
  event.preventDefault()
  event.stopPropagation()

  const container = (event.currentTarget as HTMLElement).parentElement

  if (!container) {
    return
  }

  const minPaneSize = node.direction === 'horizontal' ? 280 : 220
  const updateRatio = (clientPosition: number): void => {
    const rect = container.getBoundingClientRect()
    const size = node.direction === 'horizontal' ? rect.width : rect.height
    const start = node.direction === 'horizontal' ? rect.left : rect.top

    if (size <= 0) {
      return
    }

    const minRatio = Math.min(0.45, minPaneSize / size)
    const maxRatio = 1 - minRatio
    const nextRatio = (clientPosition - start) / size

    node.ratio = Math.min(maxRatio, Math.max(minRatio, nextRatio))
  }
  const handleMove = (moveEvent: MouseEvent): void => {
    updateRatio(node.direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY)
  }
  const handleUp = (): void => {
    document.body.classList.remove('is-resizing-split')
    document.body.classList.remove('is-resizing-split-horizontal')
    document.body.classList.remove('is-resizing-split-vertical')
    document.removeEventListener('mousemove', handleMove)
    document.removeEventListener('mouseup', handleUp)
    stopSplitResize = null
  }

  stopSplitResize?.()
  stopSplitResize = handleUp
  document.body.classList.add('is-resizing-split')
  document.body.classList.add(`is-resizing-split-${node.direction}`)
  document.addEventListener('mousemove', handleMove)
  document.addEventListener('mouseup', handleUp)
}
const getTerminalCwd = (): string => lastFocusedFilePath.value || focusedTab.value?.currentPath || ''
const createTabInFocusedPane = (): void => {
  const pane = focusedPane.value
  if (!pane) {
    return
  }

  if (pane.kind === 'terminal') {
    const newTab = createTerminalTab(getTerminalCwd() || getActiveTerminalTab(pane)?.cwd || '')
    pane.tabs.push(newTab)
    pane.activeTabId = newTab.id
    return
  }

  const tab = getActiveFileTab(pane)
  if (tab) {
    const newTab = cloneTabForPath(tab)
    pane.tabs.push(newTab)
    pane.activeTabId = newTab.id
    lastFocusedFilePath.value = newTab.currentPath
  }
}
const createTerminalTabInPane = (pane: TerminalPaneState): void => {
  const newTab = createTerminalTab(getTerminalCwd() || getActiveTerminalTab(pane)?.cwd || '')
  pane.tabs.push(newTab)
  pane.activeTabId = newTab.id
}
const splitFocusedPane = (direction: SplitDirection, kind: 'files' | 'terminal' = 'files'): void => {
  const sourcePane = focusedPane.value
  if (!sourcePane) {
    return
  }

  const sourceTab = focusedTab.value
  const cwd = getTerminalCwd() || sourceTab?.currentPath

  if (!cwd) {
    return
  }

  const newPane =
    kind === 'terminal'
      ? createTerminalPane(cwd)
      : createPane(sourceTab?.currentPath || lastFocusedFilePath.value || cwd)

  if (kind === 'files' && sourceTab) {
    const newTab = cloneTabForPath(sourceTab)
    newPane.tabs = [newTab]
    newPane.activeTabId = newTab.id
  }

  newPane.enterFrom = direction === 'horizontal' ? 'right' : 'bottom'
  panes[newPane.id] = reactive(newPane) as PaneState
  rootNode.value = replacePaneNode(rootNode.value, sourcePane.id, {
    type: 'split',
    direction,
    ratio: 0.5,
    children: [
      {
        type: 'pane',
        paneId: sourcePane.id
      },
      {
        type: 'pane',
        paneId: newPane.id
      }
    ]
  })
  focusPane(newPane.id)
  window.setTimeout(() => {
    if (panes[newPane.id]) {
      panes[newPane.id].enterFrom = null
    }
  }, 220)
}
const closePane = (paneId: string): void => {
  const paneIds = Object.keys(panes)
  if (paneIds.length <= 1 || !paneId || panes[paneId]?.isClosing) {
    return
  }
  panes[paneId].isClosing = true
  window.setTimeout(() => {
    const nextRootNode = removePaneNode(rootNode.value, paneId)
    if (!nextRootNode) {
      panes[paneId].isClosing = false
      return
    }
    rootNode.value = nextRootNode
    delete panes[paneId]
    const preferredPaneId = secondaryPaneId.value && panes[secondaryPaneId.value] ? secondaryPaneId.value : null
    focusedPaneId.value = preferredPaneId ?? findFirstPaneId(rootNode.value)
    secondaryPaneId.value = null
  }, 180)
}
const closeTab = (pane: PaneState, tabId = pane.activeTabId): void => {
  if (pane.tabs.length <= 1) {
    closePane(pane.id)
    return
  }
  const tabIndex = pane.tabs.findIndex((tab) => tab.id === tabId)
  if (tabIndex === -1) {
    return
  }
  pane.tabs.splice(tabIndex, 1)
  if (pane.activeTabId === tabId) {
    pane.activeTabId = pane.tabs[Math.max(0, tabIndex - 1)]?.id ?? pane.tabs[0].id
  }
}
const closeFocusedTab = (): void => {
  const pane = focusedPane.value
  if (pane) {
    closeTab(pane)
  }
}
const moveFocus = (direction: MoveDirection): void => {
  const nextPaneId = getDirectionalPaneId(focusedPaneId.value, panes, direction)
  if (nextPaneId) {
    focusPane(nextPaneId)
  }
}
const copySelectedFileToSecondaryPane = async (): Promise<void> => {
  if (focusedTab.value) {
    await copySelectionToSecondary(focusedTab.value, secondaryTab.value, loadDirectory)
  }
}
const moveSelectedFileToSecondaryPane = async (): Promise<void> => {
  if (focusedTab.value) {
    await moveSelectionToSecondary(focusedTab.value, secondaryTab.value, loadDirectory)
  }
}
const copyDroppedPathsToTab = async (tab: FileTabState, sourcePaths: string[]): Promise<void> => {
  const filteredPaths = [...new Set(sourcePaths.filter(Boolean))]
  if (filteredPaths.length === 0) {
    return
  }
  tab.errorMessage = ''
  try {
    const copiedPaths = await window.electron.fileManager.copyPathsToDirectory(filteredPaths, tab.currentPath)
    await loadDirectory(tab, tab.currentPath, false)
    tab.selectedPaths = copiedPaths
    tab.activePath = copiedPaths.at(-1) ?? null
    tab.selectionAnchorPath = copiedPaths[0] ?? null
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法复制拖入对象。'
  }
}
const runOnFocusedTab = (action: (tab: FileTabState) => void | Promise<void>): void => {
  if (focusedTab.value) {
    void action(focusedTab.value)
  }
}
const persistFavorites = (): void => {
  writeFavoritePaths(favorites.value)
}
const addCurrentPathToFavorites = (): void => {
  const path = focusedTab.value?.currentPath

  if (!path || favorites.value.some((favorite) => favorite.path === path)) {
    return
  }

  favorites.value = [...favorites.value, createFavoritePath(path)]
  persistFavorites()
}
const removeFavoritePath = (favoriteId: string): void => {
  favorites.value = favorites.value.filter((favorite) => favorite.id !== favoriteId)
  persistFavorites()
}
const reorderFavoritePaths = (sourceIndex: number, targetIndex: number): void => {
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= favorites.value.length ||
    targetIndex >= favorites.value.length ||
    sourceIndex === targetIndex
  ) {
    return
  }

  const nextFavorites = [...favorites.value]
  const [favorite] = nextFavorites.splice(sourceIndex, 1)
  nextFavorites.splice(targetIndex, 0, favorite)
  favorites.value = nextFavorites
  persistFavorites()
}
const jumpToFavorite = async (favorite: FavoritePath): Promise<void> => {
  const tab = focusedTab.value

  if (!tab) {
    return
  }

  isFavoritesManagerOpen.value = false
  await loadDirectory(tab, favorite.path)
}
const jumpToFavoriteIndex = (index: number): void => {
  const favorite = favorites.value[index]

  if (favorite) {
    void jumpToFavorite(favorite)
  }
}
const getArchiveDefaultFileName = (tab: FileTabState): string => {
  const selectedEntries = getSelectedEntries(tab)

  if (selectedEntries.length === 1) {
    return `${selectedEntries[0].name}.zip`
  }

  return `${getPathLabel(tab.currentPath) || 'Archive'}.zip`
}
const showArchiveDialog = (tab = focusedTab.value): void => {
  if (!tab) {
    return
  }

  const selectedEntries = getSelectedEntries(tab)

  if (selectedEntries.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  archiveDialog.value = {
    defaultFileName: getArchiveDefaultFileName(tab),
    selectedCount: selectedEntries.length,
    tab
  }
}
const closeArchiveDialog = (): void => {
  archiveDialog.value = null
}
const submitArchiveDialog = (options: ArchiveCreationOptions): void => {
  const dialog = archiveDialog.value

  if (!dialog) {
    return
  }

  archiveDialog.value = null
  void createArchiveFromSelection(dialog.tab, loadDirectory, options)
}
const showContextMenu = (tab: FileTabState, event: MouseEvent, hasSelectionTarget: boolean): void => {
  event.preventDefault()
  const hasSelection = tab.selectedPaths.length > 0
  const wrap = (action: () => void): (() => void) => () => {
    hideContextMenu()
    action()
  }
  contextMenu.value = {
    x: event.clientX,
    y: event.clientY,
    items: [
      { label: '复制', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void copySelectionToClipboard(tab)) },
      { label: '剪切', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void cutSelectionToClipboard(tab)) },
      { label: '复制并粘贴', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void duplicateSelection(tab, loadDirectory)) },
      { label: '打压缩包', enabled: hasSelectionTarget && hasSelection, action: wrap(() => showArchiveDialog(tab)) },
      { label: '重命名', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void renameActiveItem(tab, loadDirectory, requestName)) },
      { label: '删除', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void trashSelection(tab, loadDirectory)) },
      { label: '粘贴', enabled: true, action: wrap(() => void pasteClipboardIntoTab(tab, loadDirectory)) },
      { label: '新建文件夹', enabled: true, action: wrap(() => void createFolder(tab, loadDirectory, requestName)) }
    ]
  }
}
const handleFileManagerKeydown = createKeyboardHandler(platform, {
  archive: () => showArchiveDialog(),
  clearSelection,
  closeTab: closeFocusedTab,
  copy: () => runOnFocusedTab(copySelectionToClipboard),
  copySelectedToSecondary: () => void copySelectedFileToSecondaryPane(),
  createTab: createTabInFocusedPane,
  cut: () => runOnFocusedTab(cutSelectionToClipboard),
  goBack: () => void goBack(),
  goForward: () => void goForward(),
  goUp: () => void goUp(),
  moveSelectedToSecondary: () => void moveSelectedFileToSecondaryPane(),
  moveFocus,
  moveSelection,
  newFolder: () => runOnFocusedTab((tab) => createFolder(tab, loadDirectory, requestName)),
  openSelected: () => void openSelected(),
  paste: () => runOnFocusedTab((tab) => pasteClipboardIntoTab(tab, loadDirectory)),
  previewSelected: () => void previewSelected(),
  rename: () => runOnFocusedTab((tab) => renameActiveItem(tab, loadDirectory, requestName)),
  showFavoritesManager: () => {
    isFavoritesManagerOpen.value = true
  },
  showShortcutHelp: () => {
    isShortcutHelpOpen.value = true
  },
  splitPane: splitFocusedPane,
  startQuickFilter,
  jumpToFavorite: jumpToFavoriteIndex,
  trash: () => runOnFocusedTab((tab) => trashSelection(tab, loadDirectory))
})
const handleKeydown = (event: KeyboardEvent): void => {
  if (isShortcutHelpOpen.value) {
    if (event.key === 'Escape' || (event.shiftKey && event.code === 'KeyH')) {
      event.preventDefault()
      isShortcutHelpOpen.value = false
    }

    return
  }

  if (archiveDialog.value) {
    return
  }

  if (quickPreview.value) {
    if (event.key === 'Escape' || event.code === 'Space') {
      event.preventDefault()
      closeQuickPreview()
    }

    return
  }

  if (!isFavoritesManagerOpen.value) {
    handleFileManagerKeydown(event)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    isFavoritesManagerOpen.value = false
    return
  }

  if (event.altKey && event.shiftKey && event.code === 'KeyF') {
    event.preventDefault()
    isFavoritesManagerOpen.value = false
    return
  }

  if (event.shiftKey && event.code === 'KeyH') {
    event.preventDefault()
    isShortcutHelpOpen.value = true
    return
  }

  if (event.shiftKey && event.code.startsWith('Digit')) {
    const digit = Number(event.code.replace('Digit', ''))

    if (digit >= 1 && digit <= 9) {
      event.preventDefault()
      jumpToFavoriteIndex(digit - 1)
      return
    }
  }
}
const handleBeforeUnload = (): void => {
  if (isLayoutHydrated) {
    window.electron.fileManager.saveLayoutBeforeUnload(createLayoutSnapshot())
  }
}
const stopWatchedDirectorySync = watch(
  () => getOpenDirectoryPaths().sort((left, right) => left.localeCompare(right)).join('\n'),
  syncWatchedDirectories
)
const stopLayoutPersistence = watch(
  () => createLayoutSnapshot(),
  scheduleLayoutSave,
  { deep: true, flush: 'post' }
)
const SplitNodeView = defineComponent({
  name: 'SplitNodeView',
  props: {
    node: {
      type: Object as PropType<SplitNode>,
      required: true
    }
  },
  setup(props) {
    return () => {
      const node = props.node
      if (node.type === 'pane') {
        const pane = panes[node.paneId]
        if (!pane) {
          return null
        }
        if (pane.kind === 'terminal') {
          return h(TerminalPane, {
            pane,
            focusState: getPaneFocusState(pane.id),
            platform: platform.value,
            onFocus: focusPane,
            onSwitchTab: switchTab,
            onCloseTab: closeTab,
            onCreateTab: createTerminalTabInPane,
            onSplitPane: splitFocusedPane
          })
        }
        const tab = getActiveFileTab(pane)
        if (!tab) {
          return null
        }
        return h(FilePane, {
          pane,
          tab,
          platform: platform.value,
          focusState: getPaneFocusState(pane.id),
          columns,
          iconCache,
          onFocus: focusPane,
          onSwitchTab: switchTab,
          onCloseTab: closeTab,
          onNavigate: (targetTab: FileTabState, path: string) => loadDirectory(targetTab, path),
          onOpenEntry: openEntry,
          onGoBack: goBack,
          onGoForward: goForward,
          onGoUp: goUp,
          onSetSort: setSort,
          onResizeColumn: startColumnResize,
          onDropPaths: copyDroppedPathsToTab,
          onShowContextMenu: showContextMenu
        })
      }
      return h(
        'div',
        {
          class: ['split-node', `split-node-${node.direction}`]
        },
        [
          h(
            'div',
            {
              class: 'split-child',
              style: {
                flex: `${node.ratio} 1 0`
              }
            },
            [h(SplitNodeView, { node: node.children[0] })]
          ),
          h('button', {
            'aria-label': '调整窗格大小',
            'aria-orientation': node.direction === 'horizontal' ? 'vertical' : 'horizontal',
            class: ['split-resizer', `split-resizer-${node.direction}`],
            role: 'separator',
            title: '拖动调整窗格大小',
            type: 'button',
            onMousedown: (event: MouseEvent) => startSplitResize(event, node)
          }),
          h(
            'div',
            {
              class: 'split-child',
              style: {
                flex: `${1 - node.ratio} 1 0`
              }
            },
            [h(SplitNodeView, { node: node.children[1] })]
          )
        ]
      )
    }
  }
})
onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mousedown', hideContextMenu)
  window.addEventListener('beforeunload', handleBeforeUnload)
  stopDirectoryChanged = window.electron.fileManager.onDirectoryChanged((directoryPath) => {
    for (const tab of getOpenTabs()) {
      if (tab.currentPath === directoryPath) {
        void refreshDirectory(tab, directoryPath)
      }
    }
  })
  favorites.value = readFavoritePaths()
  platform.value = await window.electron.fileManager.getPlatform()
  await hydrateLayout()
  isLayoutHydrated = true
  saveLayout()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousedown', hideContextMenu)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  stopDirectoryChanged?.()
  stopWatchedDirectorySync()
  stopLayoutPersistence()
  void window.electron.fileManager.watchDirectories([])
  stopColumnResize?.()
  stopSplitResize?.()
  if (persistLayoutTimer !== null) {
    window.clearTimeout(persistLayoutTimer)
    persistLayoutTimer = null
  }
  saveLayout()
})
return {
  ArchiveDialog,
  archiveDialog,
  ContextMenu,
  contextMenu,
  cancelArchiveDialog: closeArchiveDialog,
  cancelNameDialog: () => closeNameDialog(null),
  closeQuickPreview,
  addCurrentPathToFavorites,
  FavoritesManager,
  favorites,
  focusedTab,
  isFavoritesManagerOpen,
  isShortcutHelpOpen,
  jumpToFavorite: (favorite: FavoritePath) => void jumpToFavorite(favorite),
  NameDialog,
  nameDialog,
  QuickPreview,
  quickPreview,
  removeFavoritePath,
  reorderFavoritePaths,
  rootNode,
  ShortcutHelp,
  platform,
  submitArchiveDialog,
  submitNameDialog: (value: string) => closeNameDialog(value),
  SplitNodeView
}
}
