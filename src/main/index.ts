import { constants } from 'node:fs'
import { copyFile, cp, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, ipcMain, nativeImage, net, protocol, shell } from 'electron'

type FileManagerEntry = {
  name: string
  path: string
  type: 'directory' | 'file'
  modifiedAt: number
  size: number | null
}

type DirectoryPayload = {
  path: string
  parentPath: string | null
  entries: FileManagerEntry[]
}

type ClipboardMode = 'copy' | 'cut'

type QuickPreviewKind = 'image' | 'video' | 'audio'

type QuickPreviewPayload = {
  kind: QuickPreviewKind
  sourceUrl: string
}

let internalClipboard: {
  mode: ClipboardMode
  paths: string[]
} | null = null

const getParentPath = (directoryPath: string): string | null => {
  const root = parse(directoryPath).root
  if (directoryPath === root) {
    return null
  }

  return dirname(directoryPath)
}

const getAvailableCopyPath = async (sourcePath: string, destinationDirectory: string): Promise<string> => {
  const originalName = basename(sourcePath)
  const extension = extname(originalName)
  const stem = extension ? originalName.slice(0, -extension.length) : originalName

  for (let index = 0; index < 1000; index += 1) {
    const copyName = index === 0 ? originalName : `${stem} copy${index === 1 ? '' : ` ${index}`}${extension}`
    const copyPath = join(destinationDirectory, copyName)

    try {
      await stat(copyPath)
    } catch {
      return copyPath
    }
  }

  throw new Error(`无法为 ${originalName} 找到可用名称`)
}

const fallbackDragIcon = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lkR6WQAAAABJRU5ErkJggg=='
)

const previewScheme = 'jsr-file-preview'

protocol.registerSchemesAsPrivileged([
  {
    scheme: previewScheme,
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true
    }
  }
])

const previewExtensions: Record<QuickPreviewKind, Set<string>> = {
  image: new Set(['.apng', '.avif', '.bmp', '.gif', '.ico', '.jpg', '.jpeg', '.png', '.svg', '.webp']),
  video: new Set(['.m4v', '.mov', '.mp4', '.ogg', '.ogv', '.webm']),
  audio: new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.webm'])
}

const getPreviewKind = (targetPath: string): QuickPreviewKind | null => {
  const extension = extname(targetPath).toLowerCase()

  for (const [kind, extensions] of Object.entries(previewExtensions) as Array<[QuickPreviewKind, Set<string>]>) {
    if (extensions.has(extension)) {
      return kind
    }
  }

  return null
}

const createPreviewUrl = (targetPath: string): string =>
  `${previewScheme}://file/${encodeURIComponent(targetPath)}`

const decodePreviewPath = (requestUrl: string): string | null => {
  try {
    const url = new URL(requestUrl)
    return decodeURIComponent(url.pathname.slice(1))
  } catch {
    return null
  }
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

const unescapeXml = (value: string): string =>
  value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')

const copyPathToDirectory = async (sourcePath: string, destinationDirectory: string): Promise<string> => {
  const sourceStats = await stat(sourcePath)
  const destinationStats = await stat(destinationDirectory)

  if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
    throw new Error('只能复制文件和文件夹。')
  }

  if (!destinationStats.isDirectory()) {
    throw new Error(`${destinationDirectory} 不是文件夹`)
  }

  const destinationPath = await getAvailableCopyPath(sourcePath, destinationDirectory)

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, destinationPath, {
      errorOnExist: true,
      force: false,
      recursive: true
    })
  } else {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
  }

  return destinationPath
}

const movePathToDirectory = async (sourcePath: string, destinationDirectory: string): Promise<string> => {
  const destinationStats = await stat(destinationDirectory)

  if (!destinationStats.isDirectory()) {
    throw new Error(`${destinationDirectory} 不是文件夹`)
  }

  const destinationPath = await getAvailableCopyPath(sourcePath, destinationDirectory)

  try {
    await rename(sourcePath, destinationPath)
  } catch {
    await cp(sourcePath, destinationPath, {
      errorOnExist: true,
      force: false,
      recursive: true
    })
    await shell.trashItem(sourcePath)
  }

  return destinationPath
}

const writeClipboardPaths = (sourcePaths: string[], mode: ClipboardMode): void => {
  const paths = sourcePaths.filter(Boolean)
  internalClipboard = { mode, paths }

  const uriList = paths.map((path) => `file://${encodeURI(path)}`).join('\n')
  clipboard.writeText(uriList || paths.join('\n'))

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array>${paths.map((path) => `<string>${escapeXml(path)}</string>`).join('')}</array></plist>`
    clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plist))
  }

  if (process.platform === 'win32') {
    clipboard.writeBuffer('FileNameW', Buffer.from(`${paths.join('\0')}\0\0`, 'utf16le'))
    const effect = Buffer.alloc(4)
    effect.writeUInt32LE(mode === 'cut' ? 2 : 1, 0)
    clipboard.writeBuffer('Preferred DropEffect', effect)
  }
}

const readClipboardPaths = (): {
  mode: ClipboardMode
  paths: string[]
} => {
  const formats = clipboard.availableFormats()
  const text = clipboard.readText()
  const parsedTextPaths = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('file://') ? decodeURIComponent(line.replace('file://', '')) : line))

  if (parsedTextPaths.length > 0) {
    return { mode: internalClipboard?.mode ?? 'copy', paths: parsedTextPaths }
  }

  if (process.platform === 'darwin' && formats.includes('NSFilenamesPboardType')) {
    const plist = clipboard.readBuffer('NSFilenamesPboardType').toString()
    const paths = [...plist.matchAll(/<string>(.*?)<\/string>/g)].map((match) => unescapeXml(match[1]))
    return { mode: internalClipboard?.mode ?? 'copy', paths }
  }

  if (process.platform === 'win32' && formats.includes('FileNameW')) {
    const paths = clipboard.readBuffer('FileNameW').toString('utf16le').split('\0').filter(Boolean)
    const effect = clipboard.readBuffer('Preferred DropEffect')
    return { mode: effect.readUInt32LE(0) === 2 ? 'cut' : 'copy', paths }
  }

  return internalClipboard ?? { mode: 'copy', paths: [] }
}

const registerFileManagerHandlers = (): void => {
  ipcMain.handle('file-manager:get-home-directory', () => homedir())

  ipcMain.handle('file-manager:list-directory', async (_, directoryPath: string): Promise<DirectoryPayload> => {
    const directoryStats = await stat(directoryPath)

    if (!directoryStats.isDirectory()) {
      throw new Error(`${directoryPath} 不是文件夹`)
    }

    const directoryEntries = await readdir(directoryPath, { withFileTypes: true })
    const entries = await Promise.all(
      directoryEntries.map(async (entry): Promise<FileManagerEntry | null> => {
        const entryPath = join(directoryPath, entry.name)

        try {
          const entryStats = await stat(entryPath)

          if (!entryStats.isDirectory() && !entryStats.isFile()) {
            return null
          }

          return {
            name: entry.name,
            path: entryPath,
            type: entryStats.isDirectory() ? 'directory' : 'file',
            modifiedAt: entryStats.mtimeMs,
            size: entryStats.isFile() ? entryStats.size : null
          }
        } catch {
          return null
        }
      })
    )

    return {
      path: directoryPath,
      parentPath: getParentPath(directoryPath),
      entries: entries.filter((entry): entry is FileManagerEntry => entry !== null)
    }
  })

  ipcMain.handle('file-manager:open-path', async (_, targetPath: string) => {
    const targetStats = await stat(targetPath)

    if (targetStats.isDirectory()) {
      return { action: 'enter-directory' as const, path: targetPath }
    }

    const errorMessage = await shell.openPath(targetPath)

    if (errorMessage) {
      throw new Error(errorMessage)
    }

    return { action: 'open-file' as const, path: targetPath }
  })

  ipcMain.handle('file-manager:get-parent-directory', (_, directoryPath: string) => getParentPath(directoryPath))

  ipcMain.handle('file-manager:get-file-icon', async (_, targetPath: string) => {
    const icon = await app.getFileIcon(targetPath, { size: 'normal' })
    return icon.toDataURL()
  })

  ipcMain.handle('file-manager:get-quick-preview', async (_, targetPath: string): Promise<QuickPreviewPayload> => {
    const targetStats = await stat(targetPath)

    if (!targetStats.isFile()) {
      throw new Error('只能预览文件。')
    }

    const kind = getPreviewKind(targetPath)

    if (!kind) {
      throw new Error('暂不支持预览该文件格式。')
    }

    return {
      kind,
      sourceUrl: createPreviewUrl(targetPath)
    }
  })

  ipcMain.handle('file-manager:copy-paths-to-directory', async (_, sourcePaths: string[], destinationDirectory: string) => {
    const copiedPaths: string[] = []

    for (const sourcePath of sourcePaths) {
      copiedPaths.push(await copyPathToDirectory(sourcePath, destinationDirectory))
    }

    return copiedPaths
  })

  ipcMain.handle('file-manager:move-paths-to-directory', async (_, sourcePaths: string[], destinationDirectory: string) => {
    const movedPaths: string[] = []

    for (const sourcePath of sourcePaths) {
      movedPaths.push(await movePathToDirectory(sourcePath, destinationDirectory))
    }

    return movedPaths
  })

  ipcMain.handle('file-manager:rename-path', async (_, sourcePath: string, newName: string) => {
    const destinationPath = join(dirname(sourcePath), newName)
    await rename(sourcePath, destinationPath)
    return destinationPath
  })

  ipcMain.handle('file-manager:create-directory', async (_, parentPath: string, name: string) => {
    const directoryPath = join(parentPath, name)
    await mkdir(directoryPath)
    return directoryPath
  })

  ipcMain.handle('file-manager:trash-paths', async (_, sourcePaths: string[]) => {
    for (const sourcePath of sourcePaths) {
      await shell.trashItem(sourcePath)
    }
  })

  ipcMain.handle('file-manager:write-clipboard-paths', (_, sourcePaths: string[], mode: ClipboardMode) => {
    writeClipboardPaths(sourcePaths, mode)
  })

  ipcMain.handle('file-manager:paste-clipboard-paths', async (_, destinationDirectory: string) => {
    const payload = readClipboardPaths()
    const pastedPaths: string[] = []

    for (const sourcePath of payload.paths) {
      pastedPaths.push(
        payload.mode === 'cut'
          ? await movePathToDirectory(sourcePath, destinationDirectory)
          : await copyPathToDirectory(sourcePath, destinationDirectory)
      )
    }

    if (payload.mode === 'cut') {
      internalClipboard = null
      clipboard.clear()
    }

    return pastedPaths
  })

  ipcMain.on('file-manager:start-native-drag', async (event, sourcePaths: string[]) => {
    const validPaths = sourcePaths.filter(Boolean)

    if (validPaths.length === 0) {
      return
    }

    try {
      const icon = await app.getFileIcon(validPaths[0], { size: 'normal' })
      event.sender.startDrag({
        file: validPaths[0],
        files: validPaths,
        icon: icon.isEmpty() ? fallbackDragIcon : icon
      })
    } catch {
      event.sender.startDrag({
        file: validPaths[0],
        files: validPaths,
        icon: fallbackDragIcon
      })
    }
  })

  ipcMain.handle('file-manager:get-platform', () => process.platform)
}

const registerPreviewProtocol = (): void => {
  protocol.handle(previewScheme, async (request) => {
    const targetPath = decodePreviewPath(request.url)

    if (!targetPath) {
      return new Response(null, { status: 400 })
    }

    const targetStats = await stat(targetPath)

    if (!targetStats.isFile() || !getPreviewKind(targetPath)) {
      return new Response(null, { status: 404 })
    }

    return net.fetch(pathToFileURL(targetPath).toString())
  })
}

const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'JSR Explorer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerPreviewProtocol()
  registerFileManagerHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
