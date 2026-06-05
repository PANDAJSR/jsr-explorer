import type { ArchiveCreationOptions, FileTabState } from './types'

type LoadDirectory = (tab: FileTabState, directoryPath: string, pushHistory?: boolean) => Promise<void>
type RequestName = (message: string, defaultValue?: string) => Promise<string | null>

export const getSelectedEntries = (tab: FileTabState): FileManagerEntry[] =>
  tab.selectedPaths
    .map((path) => tab.entries.find((entry) => entry.path === path))
    .filter((entry): entry is FileManagerEntry => Boolean(entry))

export const getSelectedPaths = (tab: FileTabState): string[] => getSelectedEntries(tab).map((entry) => entry.path)

const refreshAndSelect = async (tab: FileTabState, paths: string[], loadDirectory: LoadDirectory): Promise<void> => {
  await loadDirectory(tab, tab.currentPath, false)
  tab.selectedPaths = paths
  tab.activePath = paths.at(-1) ?? null
  tab.selectionAnchorPath = paths[0] ?? null
}

export const copySelectionToClipboard = async (tab: FileTabState): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)

  if (selectedPaths.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  await window.electron.fileManager.writeClipboardPaths(selectedPaths, 'copy')
}

export const cutSelectionToClipboard = async (tab: FileTabState): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)

  if (selectedPaths.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  await window.electron.fileManager.writeClipboardPaths(selectedPaths, 'cut')
}

export const pasteClipboardIntoTab = async (tab: FileTabState, loadDirectory: LoadDirectory): Promise<void> => {
  try {
    const pastedPaths = await window.electron.fileManager.pasteClipboardPaths(tab.currentPath)
    await refreshAndSelect(tab, pastedPaths, loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法粘贴对象。'
  }
}

export const duplicateSelection = async (tab: FileTabState, loadDirectory: LoadDirectory): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)

  if (selectedPaths.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  try {
    const copiedPaths = await window.electron.fileManager.copyPathsToDirectory(selectedPaths, tab.currentPath)
    await refreshAndSelect(tab, copiedPaths, loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法复制并粘贴对象。'
  }
}

export const createArchiveFromSelection = async (
  tab: FileTabState,
  loadDirectory: LoadDirectory,
  options: ArchiveCreationOptions
): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)

  if (selectedPaths.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  try {
    const archivePath = await window.electron.fileManager.createArchive(selectedPaths, tab.currentPath, options)
    await refreshAndSelect(tab, [archivePath], loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法创建压缩包。'
  }
}

export const renameActiveItem = async (
  tab: FileTabState,
  loadDirectory: LoadDirectory,
  requestName: RequestName
): Promise<void> => {
  const activeEntry = tab.entries.find((entry) => entry.path === tab.activePath)

  if (!activeEntry) {
    tab.errorMessage = '未选择对象。'
    return
  }

  const newName = await requestName('重命名对象：', activeEntry.name)

  if (!newName || newName === activeEntry.name) {
    return
  }

  try {
    const renamedPath = await window.electron.fileManager.renamePath(activeEntry.path, newName)
    await refreshAndSelect(tab, [renamedPath], loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法重命名对象。'
  }
}

export const trashSelection = async (tab: FileTabState, loadDirectory: LoadDirectory): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)

  if (selectedPaths.length === 0) {
    tab.errorMessage = '未选择对象。'
    return
  }

  try {
    await window.electron.fileManager.trashPaths(selectedPaths)
    await refreshAndSelect(tab, [], loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法移入回收站。'
  }
}

export const createFolder = async (
  tab: FileTabState,
  loadDirectory: LoadDirectory,
  requestName: RequestName
): Promise<void> => {
  const selectedPaths = getSelectedPaths(tab)
  const folderName = await requestName(
    selectedPaths.length > 0 ? '新建文件夹，并将选中对象移入其中：' : '新建文件夹：'
  )

  if (!folderName) {
    return
  }

  if (selectedPaths.length > 0 && !window.confirm(`将 ${selectedPaths.length} 个选中对象移入“${folderName}”？`)) {
    return
  }

  try {
    const folderPath = await window.electron.fileManager.createDirectory(tab.currentPath, folderName)

    if (selectedPaths.length > 0) {
      await window.electron.fileManager.movePathsToDirectory(selectedPaths, folderPath)
    }

    await refreshAndSelect(tab, [folderPath], loadDirectory)
  } catch (error) {
    tab.errorMessage = error instanceof Error ? error.message : '无法新建文件夹。'
  }
}

export const copySelectionToSecondary = async (
  sourceTab: FileTabState,
  targetTab: FileTabState | null,
  loadDirectory: LoadDirectory
): Promise<void> => {
  const selectedPaths = getSelectedPaths(sourceTab)

  sourceTab.errorMessage = ''

  if (!targetTab) {
    sourceTab.errorMessage = '没有可用的次焦点窗格。'
    return
  }

  if (selectedPaths.length === 0) {
    sourceTab.errorMessage = '未选择对象。'
    return
  }

  try {
    const copiedPaths = await window.electron.fileManager.copyPathsToDirectory(selectedPaths, targetTab.currentPath)
    await refreshAndSelect(targetTab, copiedPaths, loadDirectory)
  } catch (error) {
    sourceTab.errorMessage = error instanceof Error ? error.message : '无法复制对象。'
  }
}
