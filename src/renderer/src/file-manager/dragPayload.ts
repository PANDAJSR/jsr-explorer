export const filePathDragMimeType = 'application/x-jsr-explorer-file-paths'

export type FilePathDragPayload = {
  paths: string[]
  sourcePaneId?: string
  sourceTabId?: string
}

export const createFilePathDragPayload = (
  paths: string[],
  sourcePaneId: string,
  sourceTabId: string
): FilePathDragPayload => ({
  paths,
  sourcePaneId,
  sourceTabId
})

export const readFilePathDragPayload = (event: DragEvent): FilePathDragPayload => {
  const internalPayload = event.dataTransfer?.getData(filePathDragMimeType)

  if (internalPayload) {
    try {
      const payload = JSON.parse(internalPayload) as unknown

      if (Array.isArray(payload)) {
        return { paths: payload.filter((path): path is string => typeof path === 'string') }
      }

      if (payload && typeof payload === 'object' && 'paths' in payload && Array.isArray(payload.paths)) {
        return {
          paths: payload.paths.filter((path): path is string => typeof path === 'string'),
          sourcePaneId: typeof payload.sourcePaneId === 'string' ? payload.sourcePaneId : undefined,
          sourceTabId: typeof payload.sourceTabId === 'string' ? payload.sourceTabId : undefined
        }
      }
    } catch {
      return { paths: [] }
    }
  }

  const uriList = event.dataTransfer?.getData('text/uri-list')
  if (uriList) {
    return {
      paths: uriList
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => (line.startsWith('file://') ? decodeURIComponent(line.replace('file://', '')) : line))
    }
  }

  return {
    paths: [...(event.dataTransfer?.files ?? [])]
      .map((file) => window.electron.fileManager.getPathForFile(file))
      .filter(Boolean)
  }
}

export const readDraggedFilePaths = (event: DragEvent): string[] => {
  return readFilePathDragPayload(event).paths
}

export const hasDraggedFilePaths = (event: DragEvent): boolean =>
  Boolean(
    event.dataTransfer?.types.includes(filePathDragMimeType) ||
      event.dataTransfer?.types.includes('Files') ||
      event.dataTransfer?.types.includes('text/uri-list')
  )
