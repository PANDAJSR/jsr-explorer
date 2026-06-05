import type { FileTabState } from './types'

export const sortEntriesForTab = (tab: FileTabState): FileManagerEntry[] => {
  return [...tab.entries].sort((left, right) => {
    if (tab.sortKey === 'size' && left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1
    }

    let result = 0

    if (tab.sortKey === 'name') {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    if (tab.sortKey === 'modifiedAt') {
      result = left.modifiedAt - right.modifiedAt
    }

    if (tab.sortKey === 'size') {
      const leftSize = left.size ?? -1
      const rightSize = right.size ?? -1
      result = leftSize - rightSize
    }

    if (result === 0) {
      result = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return tab.sortDirection === 'asc' ? result : -result
  })
}
