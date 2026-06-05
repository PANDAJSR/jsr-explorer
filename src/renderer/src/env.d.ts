/// <reference types="vite/client" />

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

type OpenPathResult =
  | {
      action: 'enter-directory'
      path: string
    }
  | {
      action: 'open-file'
      path: string
    }

interface Window {
  electron: {
    fileManager: {
      getHomeDirectory: () => Promise<string>
      listDirectory: (directoryPath: string) => Promise<DirectoryPayload>
      openPath: (targetPath: string) => Promise<OpenPathResult>
      getParentDirectory: (directoryPath: string) => Promise<string | null>
      getFileIcon: (targetPath: string) => Promise<string>
      getPlatform: () => Promise<'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'>
    }
  }
}
