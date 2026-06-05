export const filePathDragMimeType = 'application/x-jsr-explorer-file-paths'

export const readDraggedFilePaths = (event: DragEvent): string[] => {
  const internalPayload = event.dataTransfer?.getData(filePathDragMimeType)

  if (internalPayload) {
    try {
      const paths = JSON.parse(internalPayload) as unknown
      return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : []
    } catch {
      return []
    }
  }

  const uriList = event.dataTransfer?.getData('text/uri-list')
  if (uriList) {
    return uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => (line.startsWith('file://') ? decodeURIComponent(line.replace('file://', '')) : line))
  }

  return [...(event.dataTransfer?.files ?? [])]
    .map((file) => window.electron.fileManager.getPathForFile(file))
    .filter(Boolean)
}

export const hasDraggedFilePaths = (event: DragEvent): boolean =>
  Boolean(
    event.dataTransfer?.types.includes(filePathDragMimeType) ||
      event.dataTransfer?.types.includes('Files') ||
      event.dataTransfer?.types.includes('text/uri-list')
  )
