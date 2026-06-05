import type { FilePaneState, FileTabState, TerminalPaneState, TerminalTabState } from './types'

export const createStateFactory = () => {
  let nextPaneId = 1
  let nextTabId = 1

  const createTab = (directoryPath: string): FileTabState => ({
    kind: 'file',
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

  const createTerminalTab = (cwd: string): TerminalTabState => ({
    kind: 'terminal',
    id: `tab-${nextTabId++}`,
    cwd,
    title: 'Terminal',
    terminalId: null,
    exitMessage: ''
  })

  const createPane = (directoryPath: string): FilePaneState => {
    const tab = createTab(directoryPath)

    return {
      kind: 'files',
      id: `pane-${nextPaneId++}`,
      isClosing: false,
      enterFrom: null,
      tabs: [tab],
      activeTabId: tab.id
    }
  }

  const createTerminalPane = (cwd: string): TerminalPaneState => {
    const tab = createTerminalTab(cwd)

    return {
      kind: 'terminal',
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
    createTab,
    createTerminalPane,
    createTerminalTab
  }
}
