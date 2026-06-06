import type { FilePaneState, FileTabState, SearchPaneState, SearchTabState, TerminalPaneState, TerminalTabState } from './types'

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
      isQuickFilterOpen: false,
      quickFilterQuery: '',
      quickFilterActivePath: null,
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

  const createSearchTab = (searchPath: string, query = '', id = `tab-${nextTabId++}`): SearchTabState => {
    reserveNumericId(id, 'tab')

    return {
      kind: 'search',
      id,
      searchPath,
      query,
      entries: [],
      selectedPaths: [],
      activePath: null,
      selectionAnchorPath: null,
      errorMessage: '',
      isLoading: false,
      sortKey: 'name',
      sortDirection: 'asc',
      loadSequence: 0,
      searchedQuery: '',
      isTruncated: false
    }
  }

  const cloneSearchTab = (sourceTab: SearchTabState): SearchTabState => ({
    ...createSearchTab(sourceTab.searchPath, sourceTab.query),
    entries: [...sourceTab.entries],
    sortKey: sourceTab.sortKey,
    sortDirection: sourceTab.sortDirection,
    searchedQuery: sourceTab.searchedQuery,
    isTruncated: sourceTab.isTruncated
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

  const createSearchPane = (searchPath: string, query = '', id = `pane-${nextPaneId++}`, tabId?: string): SearchPaneState => {
    reserveNumericId(id, 'pane')
    if (tabId) {
      reserveNumericId(tabId, 'tab')
    }
    const tab = createSearchTab(searchPath, query, tabId)

    return {
      kind: 'search',
      id,
      isClosing: false,
      enterFrom: null,
      tabs: [tab],
      activeTabId: tab.id
    }
  }

  return {
    cloneSearchTab,
    cloneTabForPath,
    createPane,
    createSearchPane,
    createSearchTab,
    createTab,
    createTerminalPane,
    createTerminalTab
  }
}
