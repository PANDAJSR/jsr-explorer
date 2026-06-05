import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, type PropType } from 'vue'
import ContextMenu from '../components/ContextMenu.vue'
import FavoritesManager from '../components/FavoritesManager.vue'
import FilePane from '../components/FilePane.vue'
import NameDialog from '../components/NameDialog.vue'
import QuickPreview from '../components/QuickPreview.vue'
import {
  copySelectionToClipboard,
  copySelectionToSecondary,
  createFolder,
  cutSelectionToClipboard,
  duplicateSelection,
  pasteClipboardIntoTab,
  renameActiveItem,
  trashSelection
} from '../file-manager/fileActions'
import { getDirectionalPaneId } from '../file-manager/focusNavigation'
import { getPathLabel } from '../file-manager/formatters'
import { createKeyboardHandler } from '../file-manager/keyboard'
import { createStateFactory } from '../file-manager/stateFactory'
import { sortEntriesForTab } from '../file-manager/sortEntries'
import { findFirstPaneId, removePaneNode, replacePaneNode } from '../file-manager/splitTree'
import type { ColumnKey, FavoritePath, FileTabState, MoveDirection, PaneState, Platform, QuickPreviewState, SortKey, SplitDirection, SplitNode } from '../file-manager/types'

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
const quickPreview = ref<QuickPreviewState | null>(null)
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
const { cloneTabForPath, createPane } = createStateFactory()
const initialPane = createPane('')
panes[initialPane.id] = initialPane
focusedPaneId.value = initialPane.id
const rootNode = ref<SplitNode>({
  type: 'pane',
  paneId: initialPane.id
})
const focusedPane = computed(() => panes[focusedPaneId.value] ?? null)
const secondaryPane = computed(() => (secondaryPaneId.value ? panes[secondaryPaneId.value] ?? null : null))
const getActiveTab = (pane: PaneState | null): FileTabState | null =>
  pane ? pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0] ?? null : null
const focusedTab = computed(() => getActiveTab(focusedPane.value))
const secondaryTab = computed(() => getActiveTab(secondaryPane.value))
const getPaneFocusState = (paneId: string): 'primary' | 'secondary' | 'none' =>
  paneId === focusedPaneId.value ? 'primary' : paneId === secondaryPaneId.value ? 'secondary' : 'none'
const focusPane = (paneId: string): void => {
  if (!panes[paneId] || panes[paneId].isClosing || paneId === focusedPaneId.value) {
    return
  }
  secondaryPaneId.value = focusedPaneId.value || null
  focusedPaneId.value = paneId
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
const loadDirectory = async (tab: FileTabState, directoryPath: string, pushHistory = true): Promise<void> => {
  const sequence = (tab.loadSequence += 1)
  tab.errorMessage = ''
  tab.isLoading = true
  try {
    const payload = await window.electron.fileManager.listDirectory(directoryPath)
    if (sequence !== tab.loadSequence) {
      return
    }
    if (pushHistory && tab.currentPath && tab.currentPath !== payload.path) {
      tab.backStack.push(tab.currentPath)
      tab.forwardStack = []
    }
    tab.currentPath = payload.path
    tab.parentPath = payload.parentPath
    tab.entries = payload.entries
    tab.selectedPaths = []
    tab.activePath = null
    tab.selectionAnchorPath = null
    loadFileIcons(payload.entries)
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
    quickPreview.value = {
      entryName: entry.name,
      kind: preview.kind,
      sourceUrl: preview.sourceUrl
    }
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法预览对象。'
  }
}
const closeQuickPreview = (): void => {
  quickPreview.value = null
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
const createTabInFocusedPane = (): void => {
  const pane = focusedPane.value
  const tab = focusedTab.value
  if (!pane || !tab) {
    return
  }
  const newTab = cloneTabForPath(tab)
  pane.tabs.push(newTab)
  pane.activeTabId = newTab.id
}
const splitFocusedPane = (direction: SplitDirection): void => {
  const sourcePane = focusedPane.value
  const sourceTab = focusedTab.value
  if (!sourcePane || !sourceTab) {
    return
  }
  const newPane = createPane(sourceTab.currentPath)
  const newTab = cloneTabForPath(sourceTab)
  newPane.enterFrom = direction === 'horizontal' ? 'right' : 'bottom'
  newPane.tabs = [newTab]
  newPane.activeTabId = newTab.id
  panes[newPane.id] = reactive(newPane) as PaneState
  rootNode.value = replacePaneNode(rootNode.value, sourcePane.id, {
    type: 'split',
    direction,
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
      { label: '重命名', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void renameActiveItem(tab, loadDirectory, requestName)) },
      { label: '删除', enabled: hasSelectionTarget && hasSelection, action: wrap(() => void trashSelection(tab, loadDirectory)) },
      { label: '粘贴', enabled: true, action: wrap(() => void pasteClipboardIntoTab(tab, loadDirectory)) },
      { label: '新建文件夹', enabled: true, action: wrap(() => void createFolder(tab, loadDirectory, requestName)) }
    ]
  }
}
const handleFileManagerKeydown = createKeyboardHandler(platform, {
  closeTab: closeFocusedTab,
  copy: () => runOnFocusedTab(copySelectionToClipboard),
  copySelectedToSecondary: () => void copySelectedFileToSecondaryPane(),
  createTab: createTabInFocusedPane,
  cut: () => runOnFocusedTab(cutSelectionToClipboard),
  goBack: () => void goBack(),
  goForward: () => void goForward(),
  goUp: () => void goUp(),
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
  splitPane: splitFocusedPane,
  jumpToFavorite: jumpToFavoriteIndex,
  trash: () => runOnFocusedTab((tab) => trashSelection(tab, loadDirectory))
})
const handleKeydown = (event: KeyboardEvent): void => {
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

  if (event.shiftKey && event.code.startsWith('Digit')) {
    const digit = Number(event.code.replace('Digit', ''))

    if (digit >= 1 && digit <= 9) {
      event.preventDefault()
      jumpToFavoriteIndex(digit - 1)
      return
    }
  }
}
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
        const tab = getActiveTab(pane)
        if (!pane || !tab) {
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
        [h(SplitNodeView, { node: node.children[0] }), h(SplitNodeView, { node: node.children[1] })]
      )
    }
  }
})
onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mousedown', hideContextMenu)
  favorites.value = readFavoritePaths()
  platform.value = await window.electron.fileManager.getPlatform()
  const homeDirectory = await window.electron.fileManager.getHomeDirectory()
  const tab = focusedTab.value
  if (tab) {
    tab.currentPath = homeDirectory
    await loadDirectory(tab, homeDirectory, false)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mousedown', hideContextMenu)
  stopColumnResize?.()
})
return {
  ContextMenu,
  contextMenu,
  cancelNameDialog: () => closeNameDialog(null),
  closeQuickPreview,
  addCurrentPathToFavorites,
  FavoritesManager,
  favorites,
  focusedTab,
  isFavoritesManagerOpen,
  jumpToFavorite: (favorite: FavoritePath) => void jumpToFavorite(favorite),
  NameDialog,
  nameDialog,
  QuickPreview,
  quickPreview,
  removeFavoritePath,
  reorderFavoritePaths,
  rootNode,
  submitNameDialog: (value: string) => closeNameDialog(value),
  SplitNodeView
}
}
