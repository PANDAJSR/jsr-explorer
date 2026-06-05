import type { FileTabState, PaneState } from './types'

export const createStateFactory = () => {
  let nextPaneId = 1
  let nextTabId = 1

  const createTab = (directoryPath: string): FileTabState => ({
    id: `tab-${nextTabId++}`,
    currentPath: directoryPath,
    parentPath: null,
    entries: [],
    selectedPaths: [],
    activePath: null,
    selectionAnchorPath: null,
    errorMessage: '',
    isLoading: false,
    backStack: [],
    forwardStack: [],
    sortKey: 'name',
    sortDirection: 'asc',
    isEditingPath: false,
    editablePath: '',
    loadSequence: 0
  })

  const cloneTabForPath = (sourceTab: FileTabState): FileTabState => ({
    ...createTab(sourceTab.currentPath),
    parentPath: sourceTab.parentPath,
    entries: [...sourceTab.entries],
    sortKey: sourceTab.sortKey,
    sortDirection: sourceTab.sortDirection
  })

  const createPane = (directoryPath: string): PaneState => {
    const tab = createTab(directoryPath)

    return {
      id: `pane-${nextPaneId++}`,
      isClosing: false,
      enterFrom: null,
      tabs: [tab],
      activeTabId: tab.id
    }
  }

  return {
    cloneTabForPath,
    createPane,
    createTab
  }
}
