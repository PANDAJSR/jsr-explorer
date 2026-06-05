import type { FilePaneState, FileTabState, TerminalPaneState, TerminalTabState } from './types'

export const createStateFactory = () => {
  let nextPaneId = 1
  let nextTabId = 1

  const reserveNumericId = (id: string, prefix: 'pane' | 'tab'): void => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id)

    if (!match) {
      return
    }

    const nextId = Number(match[1]) + 1

    if (prefix === 'pane') {
      nextPaneId = Math.max(nextPaneId, nextId)
      return
    }

    nextTabId = Math.max(nextTabId, nextId)
  }

  const createTab = (directoryPath: string, id = `tab-${nextTabId++}`): FileTabState => {
    reserveNumericId(id, 'tab')

    return {
      kind: 'file',
      id,
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
    }
  }

  const cloneTabForPath = (sourceTab: FileTabState): FileTabState => ({
    ...createTab(sourceTab.currentPath),
    parentPath: sourceTab.parentPath,
    entries: [...sourceTab.entries],
    sortKey: sourceTab.sortKey,
    sortDirection: sourceTab.sortDirection
  })

  const createTerminalTab = (cwd: string, id = `tab-${nextTabId++}`): TerminalTabState => {
    reserveNumericId(id, 'tab')

    return {
      kind: 'terminal',
      id,
      cwd,
      title: 'Terminal',
      terminalId: null,
      exitMessage: ''
    }
  }

  const createPane = (directoryPath: string, id = `pane-${nextPaneId++}`, tabId?: string): FilePaneState => {
    reserveNumericId(id, 'pane')
    if (tabId) {
      reserveNumericId(tabId, 'tab')
    }
    const tab = createTab(directoryPath, tabId)

    return {
      kind: 'files',
      id,
      isClosing: false,
      enterFrom: null,
      tabs: [tab],
      activeTabId: tab.id
    }
  }

  const createTerminalPane = (cwd: string, id = `pane-${nextPaneId++}`, tabId?: string): TerminalPaneState => {
    reserveNumericId(id, 'pane')
    if (tabId) {
      reserveNumericId(tabId, 'tab')
    }
    const tab = createTerminalTab(cwd, tabId)

    return {
      kind: 'terminal',
      id,
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
