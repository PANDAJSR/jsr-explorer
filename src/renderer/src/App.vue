<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

type SortKey = 'name' | 'modifiedAt' | 'size'
type SortDirection = 'asc' | 'desc'
type ColumnKey = 'name' | 'modifiedAt' | 'size'
type PathSegment = {
  label: string
  path: string
}

const entries = ref<FileManagerEntry[]>([])
const currentPath = ref('')
const parentPath = ref<string | null>(null)
const selectedPath = ref<string | null>(null)
const errorMessage = ref('')
const isLoading = ref(false)
const platform = ref<'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'>(
  'darwin'
)
const backStack = ref<string[]>([])
const forwardStack = ref<string[]>([])
const sortKey = ref<SortKey>('name')
const sortDirection = ref<SortDirection>('asc')
const isEditingPath = ref(false)
const editablePath = ref('')
const pathInput = ref<HTMLInputElement | null>(null)
const iconCache = reactive<Record<string, string>>({})
const columns = reactive<Record<ColumnKey, number>>({
  name: 520,
  modifiedAt: 220,
  size: 150
})

let loadSequence = 0
let stopColumnResize: (() => void) | null = null

const columnStyle = computed(() => ({
  gridTemplateColumns: `${columns.name}px ${columns.modifiedAt}px ${columns.size}px`
}))

const canGoBack = computed(() => backStack.value.length > 0)
const canGoForward = computed(() => forwardStack.value.length > 0)
const canGoUp = computed(() => parentPath.value !== null)

const pathSegments = computed<PathSegment[]>(() => {
  if (!currentPath.value) {
    return []
  }

  if (platform.value === 'win32') {
    return getWindowsPathSegments(currentPath.value)
  }

  return getPosixPathSegments(currentPath.value)
})

const sortedEntries = computed(() => {
  return [...entries.value].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }

    let result = 0

    if (sortKey.value === 'name') {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (sortKey.value === 'modifiedAt') {
      result = left.modifiedAt - right.modifiedAt
    }

    if (sortKey.value === 'size') {
      const leftSize = left.size ?? -1
      const rightSize = right.size ?? -1
      result = leftSize - rightSize
    }

    if (result === 0) {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return sortDirection.value === 'asc' ? result : -result
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

const loadDirectory = async (directoryPath: string, pushHistory = true): Promise<void> => {
  const sequence = (loadSequence += 1)
  errorMessage.value = ''
  isLoading.value = true

  try {
    const payload = await window.electron.fileManager.listDirectory(directoryPath)

    if (sequence !== loadSequence) {
      return
    }

    if (pushHistory && currentPath.value && currentPath.value !== payload.path) {
      backStack.value.push(currentPath.value)
      forwardStack.value = []
    }

    currentPath.value = payload.path
    parentPath.value = payload.parentPath
    entries.value = payload.entries
    selectedPath.value = null
    loadFileIcons(payload.entries)
  } catch (error) {
    if (sequence === loadSequence) {
      errorMessage.value = error instanceof Error ? error.message : 'Unable to load directory.'
    }
  } finally {
    if (sequence === loadSequence) {
      isLoading.value = false
    }
  }
}

const openEntry = async (entry: FileManagerEntry): Promise<void> => {
  errorMessage.value = ''

  try {
    const result = await window.electron.fileManager.openPath(entry.path)

    if (result.action === 'enter-directory') {
      await loadDirectory(result.path)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to open item.'
  }
}

const openSelected = async (): Promise<void> => {
  const entry = entries.value.find((item) => item.path === selectedPath.value)

  if (entry) {
    await openEntry(entry)
  }
}

const goBack = async (): Promise<void> => {
  const targetPath = backStack.value.pop()

  if (!targetPath || !currentPath.value) {
    return
  }

  forwardStack.value.push(currentPath.value)
  await loadDirectory(targetPath, false)
}

const goForward = async (): Promise<void> => {
  const targetPath = forwardStack.value.pop()

  if (!targetPath || !currentPath.value) {
    return
  }

  backStack.value.push(currentPath.value)
  await loadDirectory(targetPath, false)
}

const goUp = async (): Promise<void> => {
  if (parentPath.value) {
    await loadDirectory(parentPath.value)
  }
}

const startPathEditing = async (): Promise<void> => {
  editablePath.value = currentPath.value
  isEditingPath.value = true
  await nextTick()
  pathInput.value?.focus()
  pathInput.value?.select()
}

const stopPathEditing = (): void => {
  isEditingPath.value = false
}

const submitPathEditing = async (): Promise<void> => {
  const targetPath = editablePath.value.trim()
  isEditingPath.value = false

  if (!targetPath || targetPath === currentPath.value) {
    return
  }

  await loadDirectory(targetPath)
}

const setSort = (key: SortKey): void => {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
    return
  }

  sortKey.value = key
  sortDirection.value = 'asc'
}

const sortIndicator = (key: SortKey): string => {
  if (sortKey.value !== key) {
    return ''
  }

  return sortDirection.value === 'asc' ? '▲' : '▼'
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

const handleKeydown = (event: KeyboardEvent): void => {
  const primaryModifier = platform.value === 'darwin' ? event.metaKey : event.ctrlKey

  if (!primaryModifier) {
    return
  }

  if (event.key === '[') {
    event.preventDefault()
    void goBack()
  }

  if (event.key === ']') {
    event.preventDefault()
    void goForward()
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    void goUp()
  }

  if (event.key.toLowerCase() === 'o') {
    event.preventDefault()
    void openSelected()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  platform.value = await window.electron.fileManager.getPlatform()
  const homeDirectory = await window.electron.fileManager.getHomeDirectory()
  await loadDirectory(homeDirectory, false)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  stopColumnResize?.()
})
</script>

<template>
  <main class="file-manager">
    <header class="toolbar">
      <div class="navigation">
        <button class="icon-button" type="button" :disabled="!canGoBack" title="Back" @click="goBack">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="!canGoForward" title="Forward" @click="goForward">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button class="icon-button" type="button" :disabled="!canGoUp" title="Up" @click="goUp">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>

      <div class="path-bar" :title="currentPath">
        <input
          v-if="isEditingPath"
          ref="pathInput"
          v-model="editablePath"
          class="path-input"
          type="text"
          spellcheck="false"
          @keydown.enter.prevent="submitPathEditing"
          @keydown.escape.prevent="stopPathEditing"
          @blur="stopPathEditing"
        />
        <div v-else class="path-breadcrumbs">
          <template v-for="(segment, index) in pathSegments" :key="segment.path">
            <button class="path-segment" type="button" @click="loadDirectory(segment.path)">
              {{ segment.label }}
            </button>
            <span v-if="index < pathSegments.length - 1" class="path-separator">/</span>
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
      <span v-if="isLoading">Loading...</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else>{{ sortedEntries.length }} items</span>
    </section>

    <section class="file-list" aria-label="Files">
      <div class="file-header file-grid" :style="columnStyle">
        <button class="header-cell name-header" type="button" @click="setSort('name')">
          <span>Name</span>
          <span class="sort-mark">{{ sortIndicator('name') }}</span>
          <span class="column-resizer" @mousedown="startColumnResize($event, 'name')"></span>
        </button>
        <button class="header-cell" type="button" @click="setSort('modifiedAt')">
          <span>Modified</span>
          <span class="sort-mark">{{ sortIndicator('modifiedAt') }}</span>
          <span class="column-resizer" @mousedown="startColumnResize($event, 'modifiedAt')"></span>
        </button>
        <button class="header-cell size-header" type="button" @click="setSort('size')">
          <span>Size</span>
          <span class="sort-mark">{{ sortIndicator('size') }}</span>
          <span class="column-resizer" @mousedown="startColumnResize($event, 'size')"></span>
        </button>
      </div>

      <div class="file-rows">
        <button
          v-for="entry in sortedEntries"
          :key="entry.path"
          class="file-row file-grid"
          :class="{ selected: selectedPath === entry.path }"
          type="button"
          :style="columnStyle"
          @click="selectedPath = entry.path"
          @dblclick="openEntry(entry)"
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
  </main>
</template>
