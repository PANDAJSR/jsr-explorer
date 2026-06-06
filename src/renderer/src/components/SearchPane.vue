<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  clearActiveFilePathDragPayload,
  createFilePathDragPayload,
  filePathDragMimeType,
  setActiveFilePathDragPayload
} from '../file-manager/dragPayload'
import { formatModifiedAt, formatSize, getPathLabel } from '../file-manager/formatters'
import { sortEntriesForTab } from '../file-manager/sortEntries'
import type { ColumnKey, FocusState, Platform, SearchPaneState, SearchTabState, SortKey } from '../file-manager/types'

const props = defineProps<{
  pane: SearchPaneState
  tab: SearchTabState
  platform: Platform
  focusState: FocusState
  columns: Record<ColumnKey, number>
  iconCache: Record<string, string>
}>()

const emit = defineEmits<{
  focus: [paneId: string]
  switchTab: [pane: SearchPaneState, tabId: string]
  closeTab: [pane: SearchPaneState, tabId: string]
  search: [tab: SearchTabState]
  openEntry: [tab: SearchTabState, entry: FileManagerEntry]
  setSort: [tab: SearchTabState, key: SortKey]
  resizeColumn: [event: MouseEvent, column: ColumnKey]
  showContextMenu: [tab: SearchTabState, event: MouseEvent, hasSelectionTarget: boolean]
}>()

const queryInput = ref<HTMLInputElement | null>(null)

const columnStyle = computed(() => ({
  gridTemplateColumns: `${props.columns.name}px ${props.columns.modifiedAt}px ${props.columns.size}px`
}))
const sortedEntries = computed(() => sortEntriesForTab(props.tab))
const resultLabel = computed(() => {
  if (props.tab.isLoading) {
    return '搜索中...'
  }

  if (props.tab.errorMessage) {
    return props.tab.errorMessage
  }

  const suffix = props.tab.isTruncated ? '，已截断' : ''
  return `${sortedEntries.value.length} 个结果${suffix}`
})

const getParentPath = (path: string): string => {
  const separator = props.platform === 'win32' ? '\\' : '/'
  const index = path.lastIndexOf(separator)

  if (index <= 0) {
    return path
  }

  return path.slice(0, index)
}

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

const getDraggedPaths = (entry: FileManagerEntry): string[] =>
  props.tab.selectedPaths.includes(entry.path) ? props.tab.selectedPaths : [entry.path]

const startEntryDrag = (event: DragEvent, entry: FileManagerEntry): void => {
  if (!props.tab.selectedPaths.includes(entry.path)) {
    selectSingleEntry(entry)
  }

  const draggedPaths = getDraggedPaths(entry)
  const payload = createFilePathDragPayload(draggedPaths, props.pane.id, props.tab.id)

  setActiveFilePathDragPayload(payload)
  event.dataTransfer?.setData(filePathDragMimeType, JSON.stringify(payload))

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copyMove'
  }

  window.electron.fileManager.startNativeDrag(draggedPaths, props.iconCache[entry.path])
}

const finishEntryDrag = (): void => {
  clearActiveFilePathDragPayload()
}

const submitSearch = (): void => {
  emit('search', props.tab)
}

watch(
  () => [props.focusState, props.tab.id] as const,
  async ([focusState]) => {
    if (focusState !== 'primary') {
      return
    }

    await nextTick()
    queryInput.value?.focus()
  },
  { immediate: true }
)
</script>

<template>
  <section
    class="file-pane search-pane"
    :class="{
      'is-active': focusState === 'primary',
      'is-secondary': focusState === 'secondary',
      'is-closing': pane.isClosing,
      'is-entering-from-right': pane.enterFrom === 'right',
      'is-entering-from-bottom': pane.enterFrom === 'bottom'
    }"
    :data-pane-id="pane.id"
    @mousedown="emit('focus', pane.id)"
  >
    <nav class="tab-strip" aria-label="搜索标签页">
      <button
        v-for="paneTab in pane.tabs"
        :key="paneTab.id"
        class="tab-button"
        :class="{ active: pane.activeTabId === paneTab.id }"
        type="button"
        :title="paneTab.searchPath"
        @click="emit('switchTab', pane, paneTab.id)"
      >
        <span class="tab-title">{{ paneTab.query || getPathLabel(paneTab.searchPath) }}</span>
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

    <header class="toolbar search-toolbar">
      <input v-model="tab.searchPath" class="search-path-input" type="text" spellcheck="false" :title="tab.searchPath" />
      <form class="search-form" @submit.prevent="submitSearch">
        <input
          ref="queryInput"
          v-model="tab.query"
          class="search-query-input"
          type="search"
          spellcheck="false"
          placeholder="名称"
        />
        <button class="primary-button search-submit" type="submit">搜索</button>
      </form>
    </header>

    <section
      class="status-line"
      :class="{ 'error-text': tab.errorMessage }"
      aria-live="polite"
      @click="clearSelection"
      @contextmenu="emit('showContextMenu', tab, $event, false)"
    >
      {{ resultLabel }}
    </section>

    <section
      class="file-list"
      aria-label="搜索结果"
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
          class="file-row file-grid search-result-row"
          :class="{ selected: tab.selectedPaths.includes(entry.path), active: tab.activePath === entry.path }"
          type="button"
          draggable="true"
          :style="columnStyle"
          :title="entry.path"
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
            <span class="search-result-name">
              <span class="file-name">{{ entry.name }}</span>
              <span class="search-result-path">{{ getParentPath(entry.path) }}</span>
            </span>
          </span>
          <span class="file-cell muted">{{ formatModifiedAt(entry.modifiedAt) }}</span>
          <span class="file-cell size-cell muted">{{ formatSize(entry.size) }}</span>
        </button>
      </div>
    </section>
  </section>
</template>
