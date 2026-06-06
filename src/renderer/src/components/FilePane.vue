<script setup lang="ts">
import { match } from 'pinyin-pro'
import { computed, nextTick, ref, watch } from 'vue'
import {
  clearActiveFilePathDragPayload,
  createFilePathDragPayload,
  filePathDragMimeType,
  hasDraggedFilePaths,
  readFilePathDragPayload,
  setActiveFilePathDragPayload
} from '../file-manager/dragPayload'
import { formatModifiedAt, formatSize, getPathLabel } from '../file-manager/formatters'
import { getPathSegments } from '../file-manager/pathSegments'
import { sortEntriesForTab } from '../file-manager/sortEntries'
import type { ColumnKey, FileTabState, FocusState, PaneState, Platform, SortKey } from '../file-manager/types'

const props = defineProps<{
  pane: PaneState
  tab: FileTabState
  platform: Platform
  focusState: FocusState
  columns: Record<ColumnKey, number>
  iconCache: Record<string, string>
}>()

const emit = defineEmits<{
  focus: [paneId: string]
  switchTab: [pane: PaneState, tabId: string]
  closeTab: [pane: PaneState, tabId: string]
  navigate: [tab: FileTabState, path: string]
  openEntry: [tab: FileTabState, entry: FileManagerEntry]
  goBack: [tab: FileTabState]
  goForward: [tab: FileTabState]
  goUp: [tab: FileTabState]
  setSort: [tab: FileTabState, key: SortKey]
  resizeColumn: [event: MouseEvent, column: ColumnKey]
  dropPaths: [
    tab: FileTabState,
    payload: { paths: string[]; operation: 'copy' | 'move'; sourcePaneId?: string; sourceTabId?: string }
  ]
  showContextMenu: [tab: FileTabState, event: MouseEvent, hasSelectionTarget: boolean]
}>()

const pathInput = ref<HTMLInputElement | null>(null)
const quickFilterInput = ref<HTMLInputElement | null>(null)

const columnStyle = computed(() => ({
  gridTemplateColumns: `${props.columns.name}px ${props.columns.modifiedAt}px ${props.columns.size}px`
}))

const canGoBack = computed(() => props.tab.backStack.length > 0)
const canGoForward = computed(() => props.tab.forwardStack.length > 0)
const canGoUp = computed(() => props.tab.parentPath !== null)
const pathSeparator = computed(() => (props.platform === 'win32' ? '\\' : '/'))

const pathSegments = computed(() => getPathSegments(props.tab.currentPath, props.platform))
const sortedEntries = computed(() => sortEntriesForTab(props.tab))
const matchesQuickFilter = (entry: FileManagerEntry, query: string): boolean => {
  const normalizedName = entry.name.toLocaleLowerCase()
  const normalizedQuery = query.toLocaleLowerCase()

  return (
    normalizedName.includes(normalizedQuery) ||
    match(entry.name, query, {
      continuous: true,
      insensitive: true,
      space: 'ignore',
      v: true
    }) !== null
  )
}
const quickFilterResults = computed(() => {
  const query = props.tab.quickFilterQuery.trim()

  if (!query) {
    return []
  }

  return sortedEntries.value.filter((entry) => matchesQuickFilter(entry, query))
})
const quickFilterActiveIndex = computed(() =>
  props.tab.quickFilterActivePath
    ? quickFilterResults.value.findIndex((entry) => entry.path === props.tab.quickFilterActivePath)
    : -1
)

const sortIndicator = (key: SortKey): string => {
  if (props.tab.sortKey !== key) {
    return ''
  }

  return props.tab.sortDirection === 'asc' ? '▲' : '▼'
}

const selectRange = (entry: FileManagerEntry): void => {
  const anchorPath = props.tab.selectionAnchorPath ?? props.tab.activePath ?? entry.path
  const anchorIndex = sortedEntries.value.findIndex((item) => item.path === anchorPath)
  const entryIndex = sortedEntries.value.findIndex((item) => item.path === entry.path)

  if (entryIndex === -1) {
    return
  }

  const resolvedAnchorIndex = anchorIndex === -1 ? entryIndex : anchorIndex
  const startIndex = Math.min(resolvedAnchorIndex, entryIndex)
  const endIndex = Math.max(resolvedAnchorIndex, entryIndex)

  props.tab.selectionAnchorPath = sortedEntries.value[resolvedAnchorIndex]?.path ?? entry.path
  props.tab.activePath = entry.path
  props.tab.selectedPaths = sortedEntries.value.slice(startIndex, endIndex + 1).map((item) => item.path)
}

const toggleDiscontinuousSelection = (entry: FileManagerEntry): void => {
  const selectedPaths = new Set(props.tab.selectedPaths)
  let activePath = entry.path

  if (selectedPaths.has(entry.path)) {
    selectedPaths.delete(entry.path)
    activePath = [...selectedPaths].at(-1) ?? ''
  } else {
    selectedPaths.add(entry.path)
  }

  props.tab.selectedPaths = [...selectedPaths]
  props.tab.activePath = activePath || null
  props.tab.selectionAnchorPath = activePath || null
}

const selectSingleEntry = (entry: FileManagerEntry): void => {
  props.tab.selectedPaths = [entry.path]
  props.tab.activePath = entry.path
  props.tab.selectionAnchorPath = entry.path
}

const clearSelection = (): void => {
  props.tab.selectedPaths = []
  props.tab.activePath = null
  props.tab.selectionAnchorPath = null
}

const closeQuickFilter = (): void => {
  props.tab.isQuickFilterOpen = false
  props.tab.quickFilterQuery = ''
  props.tab.quickFilterActivePath = null
}

const scrollActiveEntryIntoView = (): void => {
  nextTick(() => {
    document.querySelector<HTMLElement>(`[data-pane-id="${props.pane.id}"] .file-row.active`)?.scrollIntoView({
      block: 'nearest'
    })
  })
}

const selectQuickFilterEntry = (entry: FileManagerEntry): void => {
  selectSingleEntry(entry)
  closeQuickFilter()
  scrollActiveEntryIntoView()
}

const moveQuickFilterSelection = (direction: 'previous' | 'next'): void => {
  const results = quickFilterResults.value

  if (results.length === 0) {
    props.tab.quickFilterActivePath = null
    return
  }

  const currentIndex = quickFilterActiveIndex.value === -1 ? 0 : quickFilterActiveIndex.value
  const nextIndex =
    direction === 'next'
      ? Math.min(results.length - 1, currentIndex + 1)
      : Math.max(0, currentIndex - 1)

  props.tab.quickFilterActivePath = results[nextIndex].path
}

const selectActiveQuickFilterEntry = (): void => {
  const entry = quickFilterResults.value[quickFilterActiveIndex.value] ?? quickFilterResults.value[0]

  if (entry) {
    selectQuickFilterEntry(entry)
  }
}

const handleQuickFilterKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveQuickFilterSelection(event.key === 'ArrowDown' ? 'next' : 'previous')
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    selectActiveQuickFilterEntry()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    closeQuickFilter()
  }
}

const selectEntry = (event: MouseEvent, entry: FileManagerEntry): void => {
  const primaryModifier = props.platform === 'darwin' ? event.metaKey : event.ctrlKey

  if (event.shiftKey) {
    selectRange(entry)
    return
  }

  if (primaryModifier) {
    toggleDiscontinuousSelection(entry)
    return
  }

  selectSingleEntry(entry)
}

const selectEntryForContextMenu = (event: MouseEvent, entry: FileManagerEntry): void => {
  if (!props.tab.selectedPaths.includes(entry.path)) {
    selectSingleEntry(entry)
  }

  emit('showContextMenu', props.tab, event, true)
}

const ensureDraggedEntryIsSelected = (entry: FileManagerEntry): void => {
  if (props.tab.selectedPaths.includes(entry.path)) {
    return
  }

  selectSingleEntry(entry)
}

const getDraggedPaths = (entry: FileManagerEntry): string[] => {
  if (props.tab.selectedPaths.includes(entry.path)) {
    return props.tab.selectedPaths
  }

  return [entry.path]
}

const startEntryDrag = (event: DragEvent, entry: FileManagerEntry): void => {
  ensureDraggedEntryIsSelected(entry)

  const draggedPaths = getDraggedPaths(entry)
  const payload = createFilePathDragPayload(draggedPaths, props.pane.id, props.tab.id)

  setActiveFilePathDragPayload(payload)
  event.dataTransfer?.setData(filePathDragMimeType, JSON.stringify(payload))

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  window.electron.fileManager.startNativeDrag(draggedPaths)
}

const finishEntryDrag = (): void => {
  clearActiveFilePathDragPayload()
}

const handlePaneDragOver = (event: DragEvent): void => {
  if (!event.dataTransfer) {
    return
  }

  if (hasDraggedFilePaths(event)) {
    event.preventDefault()
    event.dataTransfer.dropEffect = event.shiftKey ? 'move' : 'copy'
  }
}

const handlePaneDrop = (event: DragEvent): void => {
  const payload = readFilePathDragPayload(event)

  if (payload.paths.length === 0) {
    return
  }

  event.preventDefault()

  if (payload.sourcePaneId === props.pane.id) {
    return
  }

  emit('dropPaths', props.tab, {
    paths: payload.paths,
    operation: payload.sourcePaneId && event.shiftKey ? 'move' : 'copy',
    sourcePaneId: payload.sourcePaneId,
    sourceTabId: payload.sourceTabId
  })
}

const startPathEditing = async (): Promise<void> => {
  props.tab.editablePath = props.tab.currentPath
  props.tab.isEditingPath = true
  await nextTick()
  pathInput.value?.focus()
  pathInput.value?.select()
}

const stopPathEditing = (): void => {
  props.tab.isEditingPath = false
}

const submitPathEditing = (): void => {
  const targetPath = props.tab.editablePath.trim()
  props.tab.isEditingPath = false

  if (!targetPath || targetPath === props.tab.currentPath) {
    return
  }

  emit('navigate', props.tab, targetPath)
}

watch(
  () => props.tab.isQuickFilterOpen,
  async (isOpen) => {
    if (!isOpen) {
      return
    }

    await nextTick()
    quickFilterInput.value?.focus()
    quickFilterInput.value?.setSelectionRange(props.tab.quickFilterQuery.length, props.tab.quickFilterQuery.length)
  }
)

watch(
  [quickFilterResults, () => props.tab.quickFilterQuery, () => props.tab.isQuickFilterOpen],
  ([results]) => {
    if (!props.tab.isQuickFilterOpen) {
      return
    }

    if (results.length === 0) {
      props.tab.quickFilterActivePath = null
      return
    }

    if (!results.some((entry) => entry.path === props.tab.quickFilterActivePath)) {
      props.tab.quickFilterActivePath = results[0].path
    }
  },
  { immediate: true }
)
</script>

<template>
  <section
    class="file-pane"
    :class="{
      'is-active': focusState === 'primary',
      'is-secondary': focusState === 'secondary',
      'is-closing': pane.isClosing,
      'is-entering-from-right': pane.enterFrom === 'right',
      'is-entering-from-bottom': pane.enterFrom === 'bottom'
    }"
    :data-pane-id="pane.id"
    @mousedown="emit('focus', pane.id)"
    @dragover="handlePaneDragOver"
    @drop="handlePaneDrop"
  >
    <nav class="tab-strip" aria-label="标签页">
      <button
        v-for="paneTab in pane.tabs"
        :key="paneTab.id"
        class="tab-button"
        :class="{ active: pane.activeTabId === paneTab.id }"
        type="button"
        :title="paneTab.currentPath"
        @click="emit('switchTab', pane, paneTab.id)"
      >
        <span class="tab-title">{{ getPathLabel(paneTab.currentPath) }}</span>
        <span
          class="tab-close"
          role="button"
          tabindex="-1"
          title="关闭标签页"
          @click.stop="emit('closeTab', pane, paneTab.id)"
        >
          ×
        </span>
      </button>
    </nav>

    <header class="toolbar">
      <div class="navigation">
        <button class="icon-button" type="button" :disabled="!canGoBack" title="后退" @click="emit('goBack', tab)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          class="icon-button"
          type="button"
          :disabled="!canGoForward"
          title="前进"
          @click="emit('goForward', tab)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="!canGoUp" title="上一级" @click="emit('goUp', tab)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div class="path-bar" :title="tab.currentPath">
        <input
          v-if="tab.isEditingPath"
          ref="pathInput"
          v-model="tab.editablePath"
          class="path-input"
          type="text"
          spellcheck="false"
          @keydown.enter.prevent="submitPathEditing"
          @keydown.escape.prevent="stopPathEditing"
          @blur="stopPathEditing"
        />
        <div v-else class="path-breadcrumbs">
          <template v-for="(segment, index) in pathSegments" :key="segment.path">
            <button class="path-segment" type="button" @click="emit('navigate', tab, segment.path)">
              {{ segment.label }}
            </button>
            <span v-if="index < pathSegments.length - 1" class="path-separator">{{ pathSeparator }}</span>
          </template>
          <button
            class="path-empty-space"
            type="button"
            aria-label="编辑路径"
            title="编辑路径"
            @click="startPathEditing"
          ></button>
        </div>
      </div>
    </header>

    <section
      class="status-line"
      aria-live="polite"
      @click="clearSelection"
      @contextmenu="emit('showContextMenu', tab, $event, false)"
    >
      <span v-if="tab.isLoading">加载中...</span>
      <span v-else-if="tab.errorMessage" class="error-text">{{ tab.errorMessage }}</span>
      <span v-else>{{ sortedEntries.length }} 个对象</span>
    </section>

    <section
      class="file-list"
      aria-label="文件"
      @click.self="clearSelection"
      @contextmenu="emit('showContextMenu', tab, $event, false)"
    >
      <div class="file-header file-grid" :style="columnStyle">
        <button class="header-cell name-header" type="button" @click="emit('setSort', tab, 'name')">
          <span>名称</span>
          <span class="sort-mark">{{ sortIndicator('name') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'name')"></span>
        </button>
        <button class="header-cell" type="button" @click="emit('setSort', tab, 'modifiedAt')">
          <span>修改日期</span>
          <span class="sort-mark">{{ sortIndicator('modifiedAt') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'modifiedAt')"></span>
        </button>
        <button class="header-cell size-header" type="button" @click="emit('setSort', tab, 'size')">
          <span>大小</span>
          <span class="sort-mark">{{ sortIndicator('size') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'size')"></span>
        </button>
      </div>

      <div class="file-rows">
        <button
          v-for="entry in sortedEntries"
          :key="entry.path"
          class="file-row file-grid"
          :class="{ selected: tab.selectedPaths.includes(entry.path), active: tab.activePath === entry.path }"
          type="button"
          draggable="true"
          :style="columnStyle"
          @click="selectEntry($event, entry)"
          @contextmenu.stop.prevent="selectEntryForContextMenu($event, entry)"
          @dblclick="emit('openEntry', tab, entry)"
          @dragstart="startEntryDrag($event, entry)"
          @dragend="finishEntryDrag"
        >
          <span class="file-cell name-cell">
            <span v-if="entry.type === 'directory'" class="folder-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path class="folder-back" d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2 2H18a3 3 0 0 1 3 3v.5H3z" />
                <path class="folder-front" d="M3 9.5h18l-1.5 8A3 3 0 0 1 16.6 20H5.4a3 3 0 0 1-2.9-2.5z" />
              </svg>
            </span>
            <img v-else-if="iconCache[entry.path]" class="system-icon" :src="iconCache[entry.path]" alt="" />
            <span v-else class="generic-file-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M7 3h7l4 4v14H7z" />
                <path d="M14 3v5h4" />
              </svg>
            </span>
            <span class="file-name" :title="entry.name">{{ entry.name }}</span>
          </span>
          <span class="file-cell muted">{{ formatModifiedAt(entry.modifiedAt) }}</span>
          <span class="file-cell size-cell muted">{{ formatSize(entry.size) }}</span>
        </button>
      </div>
    </section>

    <div v-if="tab.isQuickFilterOpen" class="quick-filter" @mousedown.stop>
      <div class="quick-filter-results" role="listbox" aria-label="过滤结果">
        <button
          v-for="entry in quickFilterResults"
          :key="entry.path"
          class="quick-filter-result"
          :class="{ active: tab.quickFilterActivePath === entry.path }"
          type="button"
          role="option"
          :aria-selected="tab.quickFilterActivePath === entry.path"
          :title="entry.path"
          @click="selectQuickFilterEntry(entry)"
          @mouseenter="tab.quickFilterActivePath = entry.path"
        >
          <span class="quick-filter-kind">{{ entry.type === 'directory' ? '文件夹' : '文件' }}</span>
          <span class="quick-filter-name">{{ entry.name }}</span>
        </button>
        <div v-if="quickFilterResults.length === 0" class="quick-filter-empty">没有匹配项</div>
      </div>
      <input
        ref="quickFilterInput"
        v-model="tab.quickFilterQuery"
        class="quick-filter-input"
        type="text"
        spellcheck="false"
        aria-label="过滤当前文件列表"
        @keydown="handleQuickFilterKeydown"
      />
    </div>
  </section>
</template>
