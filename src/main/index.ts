import { readdir, stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { homedir } from 'node:os'
import { app, BrowserWindow, ipcMain, shell } from 'electron'

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

const getParentPath = (directoryPath: string): string | null => {
  const root = parse(directoryPath).root
  if (directoryPath === root) {
    return null
  }

  return dirname(directoryPath)
}

const registerFileManagerHandlers = (): void => {
  ipcMain.handle('file-manager:get-home-directory', () => homedir())

  ipcMain.handle('file-manager:list-directory', async (_, directoryPath: string): Promise<DirectoryPayload> => {
    const directoryStats = await stat(directoryPath)

    if (!directoryStats.isDirectory()) {
      throw new Error(`${directoryPath} is not a directory`)
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

  ipcMain.handle('file-manager:get-platform', () => process.platform)
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
