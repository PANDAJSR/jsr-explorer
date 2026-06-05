<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, type PropType } from 'vue'
import FilePane from './components/FilePane.vue'

type SortKey = 'name' | 'modifiedAt' | 'size'
type SortDirection = 'asc' | 'desc'
type ColumnKey = 'name' | 'modifiedAt' | 'size'
type SplitDirection = 'horizontal' | 'vertical'
type MoveDirection = 'left' | 'right' | 'up' | 'down'

type PaneState = {
  id: string
  isClosing: boolean
  enterFrom: 'right' | 'bottom' | null
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

type SplitNode =
  | {
      type: 'pane'
      paneId: string
    }
  | {
      type: 'split'
      direction: SplitDirection
      children: [SplitNode, SplitNode]
    }

const panes = reactive<Record<string, PaneState>>({})
const platform = ref<'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'>(
  'darwin'
)
const focusedPaneId = ref('')
const secondaryPaneId = ref<string | null>(null)
const iconCache = reactive<Record<string, string>>({})
const columns = reactive<Record<ColumnKey, number>>({
  name: 520,
  modifiedAt: 220,
  size: 150
})

let nextPaneId = 1
let stopColumnResize: (() => void) | null = null

const createPane = (directoryPath: string): PaneState => ({
  id: `pane-${nextPaneId++}`,
  isClosing: false,
  enterFrom: null,
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

const initialPane = createPane('')
panes[initialPane.id] = initialPane
focusedPaneId.value = initialPane.id

const rootNode = ref<SplitNode>({
  type: 'pane',
  paneId: initialPane.id
})

const focusedPane = computed(() => panes[focusedPaneId.value] ?? null)
const secondaryPane = computed(() => (secondaryPaneId.value ? panes[secondaryPaneId.value] ?? null : null))

const getPaneFocusState = (paneId: string): 'primary' | 'secondary' | 'none' => {
  if (paneId === focusedPaneId.value) {
    return 'primary'
  }

  if (paneId === secondaryPaneId.value) {
    return 'secondary'
  }

  return 'none'
}

const focusPane = (paneId: string): void => {
  if (!panes[paneId] || panes[paneId].isClosing || paneId === focusedPaneId.value) {
    return
  }

  secondaryPaneId.value = focusedPaneId.value || null
  focusedPaneId.value = paneId
}

const findFirstPaneId = (node: SplitNode): string => {
  if (node.type === 'pane') {
    return node.paneId
  }

  return findFirstPaneId(node.children[0])
}

const replacePaneNode = (node: SplitNode, paneId: string, replacement: SplitNode): SplitNode => {
  if (node.type === 'pane') {
    return node.paneId === paneId ? replacement : node
  }

  return {
    ...node,
    children: [
      replacePaneNode(node.children[0], paneId, replacement),
      replacePaneNode(node.children[1], paneId, replacement)
    ]
  }
}

const removePaneNode = (node: SplitNode, paneId: string): SplitNode | null => {
  if (node.type === 'pane') {
    return node.paneId === paneId ? null : node
  }

  const first = removePaneNode(node.children[0], paneId)
  const second = removePaneNode(node.children[1], paneId)

  if (!first && !second) {
    return null
  }

  if (!first) {
    return second
  }

  if (!second) {
    return first
  }

  return {
    ...node,
    children: [first, second]
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

const sortEntriesForPane = (pane: PaneState): FileManagerEntry[] => {
  return [...pane.entries].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }

    let result = 0

    if (pane.sortKey === 'name') {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (pane.sortKey === 'modifiedAt') {
      result = left.modifiedAt - right.modifiedAt
    }

    if (pane.sortKey === 'size') {
      const leftSize = left.size ?? -1
      const rightSize = right.size ?? -1
      result = leftSize - rightSize
    }

    if (result === 0) {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return pane.sortDirection === 'asc' ? result : -result
  })
}

const loadDirectory = async (pane: PaneState, directoryPath: string, pushHistory = true): Promise<void> => {
  const sequence = (pane.loadSequence += 1)
  pane.errorMessage = ''
  pane.isLoading = true

  try {
    const payload = await window.electron.fileManager.listDirectory(directoryPath)

    if (sequence !== pane.loadSequence) {
      return
    }

    if (pushHistory && pane.currentPath && pane.currentPath !== payload.path) {
      pane.backStack.push(pane.currentPath)
      pane.forwardStack = []
    }

    pane.currentPath = payload.path
    pane.parentPath = payload.parentPath
    pane.entries = payload.entries
    pane.selectedPaths = []
    pane.activePath = null
    pane.selectionAnchorPath = null
    loadFileIcons(payload.entries)
  } catch (error) {
    if (sequence === pane.loadSequence) {
      pane.errorMessage = error instanceof Error ? error.message : 'Unable to load directory.'
    }
  } finally {
    if (sequence === pane.loadSequence) {
      pane.isLoading = false
    }
  }
}

const openEntry = async (pane: PaneState, entry: FileManagerEntry): Promise<void> => {
  pane.errorMessage = ''

  try {
    const result = await window.electron.fileManager.openPath(entry.path)

    if (result.action === 'enter-directory') {
      await loadDirectory(pane, result.path)
    }
  } catch (error) {
    pane.errorMessage = error instanceof Error ? error.message : 'Unable to open item.'
  }
}

const openSelected = async (): Promise<void> => {
  const pane = focusedPane.value
  const entry = pane?.entries.find((item) => item.path === pane.activePath)

  if (pane && entry) {
    await openEntry(pane, entry)
  }
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

  if (!pane || pane.entries.length === 0) {
    return
  }

  const sortedEntries = sortEntriesForPane(pane)
  const activeIndex = pane.activePath ? sortedEntries.findIndex((entry) => entry.path === pane.activePath) : -1
  const fallbackIndex = direction === 'next' ? -1 : sortedEntries.length
  const currentIndex = activeIndex === -1 ? fallbackIndex : activeIndex
  const nextIndex =
    direction === 'next' ? Math.min(sortedEntries.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1)
  const nextEntry = sortedEntries[nextIndex]

  if (!nextEntry) {
    return
  }

  if (extendSelection) {
    const anchorPath = pane.selectionAnchorPath ?? pane.activePath ?? nextEntry.path
    const anchorIndex = Math.max(0, sortedEntries.findIndex((entry) => entry.path === anchorPath))
    const startIndex = Math.min(anchorIndex, nextIndex)
    const endIndex = Math.max(anchorIndex, nextIndex)

    pane.selectionAnchorPath = sortedEntries[anchorIndex]?.path ?? nextEntry.path
    pane.activePath = nextEntry.path
    pane.selectedPaths = sortedEntries.slice(startIndex, endIndex + 1).map((entry) => entry.path)
    scrollActiveRowIntoView(pane.id)
    return
  }

  pane.activePath = nextEntry.path
  pane.selectionAnchorPath = nextEntry.path
  pane.selectedPaths = [nextEntry.path]
  scrollActiveRowIntoView(pane.id)
}

const goBack = async (pane = focusedPane.value): Promise<void> => {
  const targetPath = pane?.backStack.pop()

  if (!pane || !targetPath || !pane.currentPath) {
    return
  }

  pane.forwardStack.push(pane.currentPath)
  await loadDirectory(pane, targetPath, false)
}

const goForward = async (pane = focusedPane.value): Promise<void> => {
  const targetPath = pane?.forwardStack.pop()

  if (!pane || !targetPath || !pane.currentPath) {
    return
  }

  pane.backStack.push(pane.currentPath)
  await loadDirectory(pane, targetPath, false)
}

const goUp = async (pane = focusedPane.value): Promise<void> => {
  if (pane?.parentPath) {
    await loadDirectory(pane, pane.parentPath)
  }
}

const setSort = (pane: PaneState, key: SortKey): void => {
  if (pane.sortKey === key) {
    pane.sortDirection = pane.sortDirection === 'asc' ? 'desc' : 'asc'
    return
  }

  pane.sortKey = key
  pane.sortDirection = 'asc'
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

const splitFocusedPane = (direction: SplitDirection): void => {
  const sourcePane = focusedPane.value

  if (!sourcePane) {
    return
  }

  const newPane = createPane(sourcePane.currentPath)
  newPane.enterFrom = direction === 'horizontal' ? 'right' : 'bottom'
  newPane.parentPath = sourcePane.parentPath
  newPane.entries = [...sourcePane.entries]
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

const closeFocusedPane = (): void => {
  const paneId = focusedPaneId.value
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

const moveFocus = (direction: MoveDirection): void => {
  const focusedElement = document.querySelector<HTMLElement>(`[data-pane-id="${focusedPaneId.value}"]`)

  if (!focusedElement) {
    return
  }

  const focusedRect = focusedElement.getBoundingClientRect()
  const focusedCenterX = focusedRect.left + focusedRect.width / 2
  const focusedCenterY = focusedRect.top + focusedRect.height / 2
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-pane-id]')]
    .filter((element) => element.dataset.paneId && element.dataset.paneId !== focusedPaneId.value)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const horizontalDistance = centerX - focusedCenterX
      const verticalDistance = centerY - focusedCenterY
      const pane = panes[element.dataset.paneId ?? '']
      const isCandidate =
        Boolean(pane) &&
        !pane.isClosing &&
        ((direction === 'left' && horizontalDistance < 0) ||
          (direction === 'right' && horizontalDistance > 0) ||
          (direction === 'up' && verticalDistance < 0) ||
          (direction === 'down' && verticalDistance > 0))

      return {
        paneId: element.dataset.paneId ?? '',
        isCandidate,
        primaryDistance: direction === 'left' || direction === 'right' ? Math.abs(horizontalDistance) : Math.abs(verticalDistance),
        crossDistance: direction === 'left' || direction === 'right' ? Math.abs(verticalDistance) : Math.abs(horizontalDistance)
      }
    })
    .filter((candidate) => candidate.isCandidate)
    .sort((left, right) => left.primaryDistance + left.crossDistance * 0.4 - (right.primaryDistance + right.crossDistance * 0.4))

  const nextPaneId = candidates[0]?.paneId

  if (nextPaneId) {
    focusPane(nextPaneId)
  }
}

const copySelectedFileToSecondaryPane = async (): Promise<void> => {
  const sourcePane = focusedPane.value
  const targetPane = secondaryPane.value

  if (!sourcePane) {
    return
  }

  sourcePane.errorMessage = ''

  if (!targetPane) {
    sourcePane.errorMessage = 'No secondary pane available.'
    return
  }

  const selectedEntries = sourcePane.selectedPaths
    .map((path) => sourcePane.entries.find((entry) => entry.path === path))
    .filter((entry): entry is FileManagerEntry => Boolean(entry))

  if (selectedEntries.length === 0) {
    sourcePane.errorMessage = 'No file selected.'
    return
  }

  if (selectedEntries.some((entry) => entry.type !== 'file')) {
    sourcePane.errorMessage = 'Only files can be copied.'
    return
  }

  try {
    const copiedPaths: string[] = []

    for (const entry of selectedEntries) {
      copiedPaths.push(await window.electron.fileManager.copyFileToDirectory(entry.path, targetPane.currentPath))
    }

    await loadDirectory(targetPane, targetPane.currentPath, false)
    targetPane.selectedPaths = copiedPaths
    targetPane.activePath = copiedPaths.at(-1) ?? null
    targetPane.selectionAnchorPath = copiedPaths[0] ?? null
  } catch (error) {
    sourcePane.errorMessage = error instanceof Error ? error.message : 'Unable to copy file.'
  }
}

const isTextEditingEvent = (event: KeyboardEvent): boolean => {
  const target = event.target

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isTextEditingEvent(event) && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey) {
    const primaryModifier = platform.value === 'darwin' ? event.metaKey : event.ctrlKey

    if (!primaryModifier) {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 'next' : 'previous', event.shiftKey)
      return
    }
  }

  if (event.altKey) {
    const directionByKey: Partial<Record<string, MoveDirection>> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down'
    }
    const direction = directionByKey[event.key]

    if (direction) {
      event.preventDefault()
      moveFocus(direction)
      return
    }
  }

  const primaryModifier = platform.value === 'darwin' ? event.metaKey : event.ctrlKey

  if (!primaryModifier || isTextEditingEvent(event)) {
    return
  }

  if (event.key === '[') {
    event.preventDefault()
    void goBack()
    return
  }

  if (event.key === ']') {
    event.preventDefault()
    void goForward()
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    void goUp()
    return
  }

  if (event.key.toLowerCase() === 'o') {
    event.preventDefault()
    void openSelected()
    return
  }

  if (event.key.toLowerCase() === 'd') {
    event.preventDefault()
    splitFocusedPane(event.shiftKey ? 'vertical' : 'horizontal')
    return
  }

  if (event.key.toLowerCase() === 'w') {
    event.preventDefault()
    closeFocusedPane()
    return
  }

  if (event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    void copySelectedFileToSecondaryPane()
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

        if (!pane) {
          return null
        }

        return h(FilePane, {
          pane,
          platform: platform.value,
          focusState: getPaneFocusState(pane.id),
          columns,
          iconCache,
          onFocus: focusPane,
          onNavigate: (targetPane: PaneState, path: string) => loadDirectory(targetPane, path),
          onOpenEntry: openEntry,
          onGoBack: goBack,
          onGoForward: goForward,
          onGoUp: goUp,
          onSetSort: setSort,
          onResizeColumn: startColumnResize
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
  platform.value = await window.electron.fileManager.getPlatform()
  const homeDirectory = await window.electron.fileManager.getHomeDirectory()
  const pane = focusedPane.value

  if (pane) {
    pane.currentPath = homeDirectory
    await loadDirectory(pane, homeDirectory, false)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopColumnResize?.()
})
</script>

<template>
  <main class="file-manager">
    <SplitNodeView :node="rootNode" />
  </main>
</template>
