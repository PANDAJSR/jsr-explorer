export const formatModifiedAt = (modifiedAt: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(modifiedAt))
}

export const formatSize = (size: number | null): string => {
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

export const getPathLabel = (targetPath: string): string => {
  if (!targetPath) {
    return '加载中'
  }

  const normalizedPath = targetPath.replaceAll('\\', '/')
  const parts = normalizedPath.split('/').filter(Boolean)
  return parts.at(-1) ?? targetPath
}
