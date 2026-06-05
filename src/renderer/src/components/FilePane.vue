<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

type SortKey = 'name' | 'modifiedAt' | 'size'
type SortDirection = 'asc' | 'desc'
type ColumnKey = 'name' | 'modifiedAt' | 'size'
type Platform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
type FocusState = 'primary' | 'secondary' | 'none'
type PathSegment = {
  label: string
  path: string
}

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

const props = defineProps<{
  pane: PaneState
  platform: Platform
  focusState: FocusState
  columns: Record<ColumnKey, number>
  iconCache: Record<string, string>
}>()

const emit = defineEmits<{
  focus: [paneId: string]
  navigate: [pane: PaneState, path: string]
  openEntry: [pane: PaneState, entry: FileManagerEntry]
  goBack: [pane: PaneState]
  goForward: [pane: PaneState]
  goUp: [pane: PaneState]
  setSort: [pane: PaneState, key: SortKey]
  resizeColumn: [event: MouseEvent, column: ColumnKey]
}>()

const pathInput = ref<HTMLInputElement | null>(null)

const columnStyle = computed(() => ({
  gridTemplateColumns: `${props.columns.name}px ${props.columns.modifiedAt}px ${props.columns.size}px`
}))

const canGoBack = computed(() => props.pane.backStack.length > 0)
const canGoForward = computed(() => props.pane.forwardStack.length > 0)
const canGoUp = computed(() => props.pane.parentPath !== null)
const pathSeparator = computed(() => (props.platform === 'win32' ? '\\' : '/'))

const pathSegments = computed<PathSegment[]>(() => {
  if (!props.pane.currentPath) {
    return []
  }

  if (props.platform === 'win32') {
    return getWindowsPathSegments(props.pane.currentPath)
  }

  return getPosixPathSegments(props.pane.currentPath)
})

const sortedEntries = computed(() => {
  return [...props.pane.entries].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }

    let result = 0

    if (props.pane.sortKey === 'name') {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (props.pane.sortKey === 'modifiedAt') {
      result = left.modifiedAt - right.modifiedAt
    }

    if (props.pane.sortKey === 'size') {
      const leftSize = left.size ?? -1
      const rightSize = right.size ?? -1
      result = leftSize - rightSize
    }

    if (result === 0) {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return props.pane.sortDirection === 'asc' ? result : -result
  })
})

const formatModifiedAt = (modifiedAt: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(modifiedAt))
}

const formatSize = (size: number | null): string => {
  if (size === null) {
    return '--'
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

const getPosixPathSegments = (targetPath: string): PathSegment[] => {
  if (targetPath === '/') {
    return [{ label: '/', path: '/' }]
  }

  const segments: PathSegment[] = []
  const names = targetPath.split('/').filter(Boolean)
  let path = targetPath.startsWith('/') ? '/' : ''

  if (targetPath.startsWith('/')) {
    segments.push({ label: '/', path: '/' })
  }

  for (const name of names) {
    path = path === '/' || path === '' ? `${path}${name}` : `${path}/${name}`
    segments.push({ label: name, path })
  }

  return segments
}

const getWindowsPathSegments = (targetPath: string): PathSegment[] => {
  const normalizedPath = targetPath.replaceAll('/', '\\')
  const driveMatch = normalizedPath.match(/^[A-Za-z]:\\?/)

  if (driveMatch) {
    const driveRoot = `${driveMatch[0].slice(0, 2)}\\`
    const segments: PathSegment[] = [{ label: driveRoot, path: driveRoot }]
    const names = normalizedPath.slice(driveMatch[0].length).split('\\').filter(Boolean)
    let path = driveRoot

    for (const name of names) {
      path = path.endsWith('\\') ? `${path}${name}` : `${path}\\${name}`
      segments.push({ label: name, path })
    }

    return segments
  }

  if (normalizedPath.startsWith('\\\\')) {
    const names = normalizedPath.split('\\').filter(Boolean)
    const shareRoot = names.length >= 2 ? `\\\\${names[0]}\\${names[1]}\\` : normalizedPath
    const segments: PathSegment[] = [{ label: shareRoot, path: shareRoot }]
    let path = shareRoot

    for (const name of names.slice(2)) {
      path = path.endsWith('\\') ? `${path}${name}` : `${path}\\${name}`
      segments.push({ label: name, path })
    }

    return segments
  }

  return normalizedPath.split('\\').filter(Boolean).map((name, index, names) => ({
    label: name,
    path: names.slice(0, index + 1).join('\\')
  }))
}

const sortIndicator = (key: SortKey): string => {
  if (props.pane.sortKey !== key) {
    return ''
  }

  return props.pane.sortDirection === 'asc' ? '▲' : '▼'
}

const selectRange = (entry: FileManagerEntry): void => {
  const anchorPath = props.pane.selectionAnchorPath ?? props.pane.activePath ?? entry.path
  const anchorIndex = sortedEntries.value.findIndex((item) => item.path === anchorPath)
  const entryIndex = sortedEntries.value.findIndex((item) => item.path === entry.path)

  if (entryIndex === -1) {
    return
  }

  const resolvedAnchorIndex = anchorIndex === -1 ? entryIndex : anchorIndex
  const startIndex = Math.min(resolvedAnchorIndex, entryIndex)
  const endIndex = Math.max(resolvedAnchorIndex, entryIndex)

  props.pane.selectionAnchorPath = sortedEntries.value[resolvedAnchorIndex]?.path ?? entry.path
  props.pane.activePath = entry.path
  props.pane.selectedPaths = sortedEntries.value.slice(startIndex, endIndex + 1).map((item) => item.path)
}

const toggleDiscontinuousSelection = (entry: FileManagerEntry): void => {
  const selectedPaths = new Set(props.pane.selectedPaths)
  let activePath = entry.path

  if (selectedPaths.has(entry.path)) {
    selectedPaths.delete(entry.path)
    activePath = [...selectedPaths].at(-1) ?? ''
  } else {
    selectedPaths.add(entry.path)
  }

  props.pane.selectedPaths = [...selectedPaths]
  props.pane.activePath = activePath || null
  props.pane.selectionAnchorPath = activePath || null
}

const selectSingleEntry = (entry: FileManagerEntry): void => {
  props.pane.selectedPaths = [entry.path]
  props.pane.activePath = entry.path
  props.pane.selectionAnchorPath = entry.path
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

const startPathEditing = async (): Promise<void> => {
  props.pane.editablePath = props.pane.currentPath
  props.pane.isEditingPath = true
  await nextTick()
  pathInput.value?.focus()
  pathInput.value?.select()
}

const stopPathEditing = (): void => {
  props.pane.isEditingPath = false
}

const submitPathEditing = (): void => {
  const targetPath = props.pane.editablePath.trim()
  props.pane.isEditingPath = false

  if (!targetPath || targetPath === props.pane.currentPath) {
    return
  }

  emit('navigate', props.pane, targetPath)
}
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
  >
    <header class="toolbar">
      <div class="navigation">
        <button class="icon-button" type="button" :disabled="!canGoBack" title="Back" @click="emit('goBack', pane)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button
          class="icon-button"
          type="button"
          :disabled="!canGoForward"
          title="Forward"
          @click="emit('goForward', pane)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="!canGoUp" title="Up" @click="emit('goUp', pane)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div class="path-bar" :title="pane.currentPath">
        <input
          v-if="pane.isEditingPath"
          ref="pathInput"
          v-model="pane.editablePath"
          class="path-input"
          type="text"
          spellcheck="false"
          @keydown.enter.prevent="submitPathEditing"
          @keydown.escape.prevent="stopPathEditing"
          @blur="stopPathEditing"
        />
        <div v-else class="path-breadcrumbs">
          <template v-for="(segment, index) in pathSegments" :key="segment.path">
            <button class="path-segment" type="button" @click="emit('navigate', pane, segment.path)">
              {{ segment.label }}
            </button>
            <span v-if="index < pathSegments.length - 1" class="path-separator">{{ pathSeparator }}</span>
          </template>
          <button
            class="path-empty-space"
            type="button"
            aria-label="Edit path"
            title="Edit path"
            @click="startPathEditing"
          ></button>
        </div>
      </div>
    </header>

    <section class="status-line" aria-live="polite">
      <span v-if="pane.isLoading">Loading...</span>
      <span v-else-if="pane.errorMessage" class="error-text">{{ pane.errorMessage }}</span>
      <span v-else>{{ sortedEntries.length }} items</span>
    </section>

    <section class="file-list" aria-label="Files">
      <div class="file-header file-grid" :style="columnStyle">
        <button class="header-cell name-header" type="button" @click="emit('setSort', pane, 'name')">
          <span>Name</span>
          <span class="sort-mark">{{ sortIndicator('name') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'name')"></span>
        </button>
        <button class="header-cell" type="button" @click="emit('setSort', pane, 'modifiedAt')">
          <span>Modified</span>
          <span class="sort-mark">{{ sortIndicator('modifiedAt') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'modifiedAt')"></span>
        </button>
        <button class="header-cell size-header" type="button" @click="emit('setSort', pane, 'size')">
          <span>Size</span>
          <span class="sort-mark">{{ sortIndicator('size') }}</span>
          <span class="column-resizer" @mousedown="emit('resizeColumn', $event, 'size')"></span>
        </button>
      </div>

      <div class="file-rows">
        <button
          v-for="entry in sortedEntries"
          :key="entry.path"
          class="file-row file-grid"
          :class="{ selected: pane.selectedPaths.includes(entry.path), active: pane.activePath === entry.path }"
          type="button"
          :style="columnStyle"
          @click="selectEntry($event, entry)"
          @dblclick="emit('openEntry', pane, entry)"
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
  </section>
</template>
