import { constants, watch, type FSWatcher } from 'node:fs'
import { access, chmod, copyFile, cp, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { inflateRawSync } from 'node:zlib'
import { spawn } from 'node:child_process'
import { app, BrowserWindow, clipboard, ipcMain, nativeImage, net, protocol, shell, type WebContents } from 'electron'
import * as pty from 'node-pty'

const require = createRequire(import.meta.url)

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

type DirectoryWatcherState = {
  sender: WebContents
  timers: Map<string, NodeJS.Timeout>
  watchers: Map<string, FSWatcher>
}

type TerminalSession = {
  id: string
  ownerWebContentsId: number
  process: pty.IPty
}

type TerminalCreateOptions = {
  id?: string
  cwd: string
  cols: number
  rows: number
}

type ClipboardMode = 'copy' | 'cut'
type ArchiveFormat = 'zip' | 'tar.gz'

type ArchiveCreationOptions = {
  format: ArchiveFormat
  compressionLevel: number
  password: string
  outputName: string
}

type QuickPreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'spreadsheet' | 'archive' | 'model'

type ArchivePreviewEntry = {
  name: string
  compressedSize: number
  uncompressedSize: number
  isDirectory: boolean
}

type SpreadsheetPreviewSheet = {
  name: string
  rows: string[][]
}

type QuickPreviewPayload =
  | {
      kind: 'image' | 'video' | 'audio' | 'pdf' | 'model'
      sourceUrl: string
    }
  | {
      kind: 'text' | 'document'
      text: string
    }
  | {
      kind: 'spreadsheet'
      sheets: SpreadsheetPreviewSheet[]
    }
  | {
      kind: 'archive'
      entries: ArchivePreviewEntry[]
      totalEntries: number
    }

let internalClipboard: {
  mode: ClipboardMode
  paths: string[]
} | null = null

const directoryWatcherStates = new Map<number, DirectoryWatcherState>()
const terminalSessions = new Map<string, TerminalSession>()
const terminalCleanupWebContentsIds = new Set<number>()
let nextTerminalId = 1

const closeDirectoryWatcherState = (webContentsId: number): void => {
  const state = directoryWatcherStates.get(webContentsId)

  if (!state) {
    return
  }

  for (const timer of state.timers.values()) {
    clearTimeout(timer)
  }

  for (const watcher of state.watchers.values()) {
    watcher.close()
  }

  directoryWatcherStates.delete(webContentsId)
}

const getDirectoryWatcherState = (sender: WebContents): DirectoryWatcherState => {
  const existingState = directoryWatcherStates.get(sender.id)

  if (existingState) {
    return existingState
  }

  const state: DirectoryWatcherState = {
    sender,
    timers: new Map(),
    watchers: new Map()
  }

  directoryWatcherStates.set(sender.id, state)
  sender.once('destroyed', () => closeDirectoryWatcherState(sender.id))

  return state
}

const disposeTerminalSession = (terminalId: string): void => {
  const session = terminalSessions.get(terminalId)

  if (!session) {
    return
  }

  terminalSessions.delete(terminalId)
  session.process.kill()
}

const disposeTerminalSessionsForWebContents = (webContentsId: number): void => {
  for (const terminalId of [...terminalSessions.values()]
    .filter((session) => session.ownerWebContentsId === webContentsId)
    .map((session) => session.id)) {
    disposeTerminalSession(terminalId)
  }

  terminalCleanupWebContentsIds.delete(webContentsId)
}

const canAccessPath = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const getTerminalShell = async (): Promise<{ command: string; args: string[]; shellName: string }> => {
  if (process.platform === 'win32') {
    const candidates = [
      `${process.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`,
      `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\Git\\bin\\bash.exe`,
      `${process.env.LOCALAPPDATA ?? ''}\\Programs\\Git\\bin\\bash.exe`
    ]

    for (const candidate of candidates.filter(Boolean)) {
      if (await canAccessPath(candidate)) {
        return {
          command: candidate,
          args: ['--login', '-i'],
          shellName: 'Git Bash'
        }
      }
    }

    return {
      command: process.env.ComSpec ?? 'powershell.exe',
      args: [],
      shellName: basename(process.env.ComSpec ?? 'powershell.exe')
    }
  }

  if (await canAccessPath('/bin/zsh')) {
    return {
      command: '/bin/zsh',
      args: ['-l'],
      shellName: 'zsh'
    }
  }

  const shell = process.env.SHELL || '/bin/bash'

  return {
    command: shell,
    args: ['-l'],
    shellName: basename(shell)
  }
}

const resolveTerminalCwd = async (cwd: string): Promise<string> => {
  try {
    const cwdStats = await stat(cwd)

    if (cwdStats.isDirectory()) {
      return cwd
    }
  } catch {
    // Fall through to the user's home directory.
  }

  return homedir()
}

const ensurePtySpawnHelperExecutable = async (): Promise<void> => {
  if (process.platform === 'win32') {
    return
  }

  try {
    const nodePtyIndexPath = require.resolve('node-pty')
    const helperPath = resolve(
      dirname(nodePtyIndexPath),
      '..',
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    )

    await chmod(helperPath, 0o755)
  } catch {
    // node-pty will surface a concrete spawn error if the helper is unavailable.
  }
}

const notifyDirectoryChanged = (state: DirectoryWatcherState, directoryPath: string): void => {
  const existingTimer = state.timers.get(directoryPath)

  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  state.timers.set(
    directoryPath,
    setTimeout(() => {
      state.timers.delete(directoryPath)

      if (!state.sender.isDestroyed()) {
        state.sender.send('file-manager:directory-changed', directoryPath)
      }
    }, 100)
  )
}

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

const getArchiveNameParts = (fileName: string): { extension: string; stem: string } => {
  if (fileName.toLowerCase().endsWith('.tar.gz')) {
    return {
      extension: '.tar.gz',
      stem: fileName.slice(0, -'.tar.gz'.length)
    }
  }

  const extension = extname(fileName)

  return {
    extension,
    stem: extension ? fileName.slice(0, -extension.length) : fileName
  }
}

const getAvailableOutputPath = async (destinationDirectory: string, fileName: string): Promise<string> => {
  const { extension, stem } = getArchiveNameParts(fileName)

  for (let index = 0; index < 1000; index += 1) {
    const nextName = index === 0 ? fileName : `${stem} copy${index === 1 ? '' : ` ${index}`}${extension}`
    const outputPath = join(destinationDirectory, nextName)

    try {
      await stat(outputPath)
    } catch {
      return outputPath
    }
  }

  throw new Error(`无法为 ${fileName} 找到可用名称`)
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
  audio: new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.opus', '.wav', '.webm']),
  pdf: new Set(['.pdf']),
  text: new Set([
    '.c',
    '.conf',
    '.cpp',
    '.cs',
    '.css',
    '.csv',
    '.go',
    '.h',
    '.hpp',
    '.html',
    '.ini',
    '.java',
    '.js',
    '.json',
    '.jsx',
    '.log',
    '.md',
    '.mjs',
    '.py',
    '.rb',
    '.rs',
    '.sh',
    '.sql',
    '.svelte',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml'
  ]),
  document: new Set(['.docx']),
  spreadsheet: new Set(['.xlsx']),
  archive: new Set(['.zip']),
  model: new Set(['.glb', '.stl'])
}

const streamPreviewKinds = new Set<QuickPreviewKind>(['image', 'video', 'audio', 'pdf', 'model'])
const maxTextPreviewBytes = 512 * 1024
const maxZipPreviewEntries = 250
const maxDocumentTextLength = 120_000
const maxSpreadsheetRows = 200
const maxSpreadsheetColumns = 80

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

const decodeXmlText = (value: string): string => unescapeXml(value.replaceAll(/<[^>]+>/g, ''))

const isLikelyTextBuffer = (buffer: Buffer): boolean => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))

  if (sample.includes(0)) {
    return false
  }

  const suspiciousBytes = sample.filter((byte) => byte < 7 || (byte > 14 && byte < 32)).length
  return sample.length === 0 || suspiciousBytes / sample.length < 0.08
}

const readTextPreview = async (targetPath: string): Promise<string> => {
  const buffer = await readFile(targetPath)

  if (!isLikelyTextBuffer(buffer)) {
    throw new Error('暂不支持预览该文件格式。')
  }

  const previewBuffer = buffer.subarray(0, maxTextPreviewBytes)
  const text = previewBuffer.toString('utf8')

  return buffer.length > maxTextPreviewBytes ? `${text}\n\n... 文件较大，仅显示前 ${maxTextPreviewBytes} 字节。` : text
}

type ZipEntry = ArchivePreviewEntry & {
  compressionMethod: number
  dataOffset: number
}

const readZipEntries = (buffer: Buffer): ZipEntry[] => {
  const eocdSignature = 0x06054b50
  const centralDirectorySignature = 0x02014b50
  const localFileSignature = 0x04034b50
  const searchStart = Math.max(0, buffer.length - 66000)
  let eocdOffset = -1

  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset
      break
    }
  }

  if (eocdOffset === -1) {
    throw new Error('无法读取 zip 文件。')
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let offset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntry[] = []

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralDirectorySignature) {
      break
    }

    const generalPurposeFlag = buffer.readUInt16LE(offset + 8)
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraFieldLength = buffer.readUInt16LE(offset + 30)
    const fileCommentLength = buffer.readUInt16LE(offset + 32)
    const localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const nameBuffer = buffer.subarray(offset + 46, offset + 46 + fileNameLength)
    const name = nameBuffer.toString(generalPurposeFlag & 0x0800 ? 'utf8' : 'utf8')

    if (buffer.readUInt32LE(localHeaderOffset) !== localFileSignature) {
      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
      continue
    }

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26)
    const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28)
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      isDirectory: name.endsWith('/'),
      compressionMethod,
      dataOffset
    })

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength
  }

  return entries
}

const extractZipEntryText = (buffer: Buffer, entries: ZipEntry[], entryName: string): string | null => {
  const entry = entries.find((item) => item.name === entryName)

  if (!entry || entry.isDirectory || entry.uncompressedSize > maxTextPreviewBytes * 4) {
    return null
  }

  const compressedData = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)

  if (entry.compressionMethod === 0) {
    return compressedData.toString('utf8')
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressedData).toString('utf8')
  }

  return null
}

const readArchivePreview = async (targetPath: string): Promise<Extract<QuickPreviewPayload, { kind: 'archive' }>> => {
  const buffer = await readFile(targetPath)
  const entries = readZipEntries(buffer)

  return {
    kind: 'archive',
    totalEntries: entries.length,
    entries: entries.slice(0, maxZipPreviewEntries).map(({ name, compressedSize, uncompressedSize, isDirectory }) => ({
      name,
      compressedSize,
      uncompressedSize,
      isDirectory
    }))
  }
}

const readDocumentPreview = async (targetPath: string): Promise<Extract<QuickPreviewPayload, { kind: 'document' }>> => {
  const buffer = await readFile(targetPath)
  const entries = readZipEntries(buffer)
  const documentXml = extractZipEntryText(buffer, entries, 'word/document.xml')

  if (!documentXml) {
    throw new Error('无法读取 Word 文档内容。')
  }

  const text = decodeXmlText(
    documentXml
      .replaceAll(/<w:tab\/>/g, '\t')
      .replaceAll(/<\/w:p>/g, '\n')
      .replaceAll(/<\/w:tr>/g, '\n')
      .replaceAll(/<\/w:tc>/g, '\t')
  )
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()

  return {
    kind: 'document',
    text: text.slice(0, maxDocumentTextLength)
  }
}

const getColumnIndex = (cellReference: string): number => {
  const column = cellReference.match(/^[A-Z]+/)?.[0] ?? 'A'
  return [...column].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1
}

const readSharedStrings = (sharedStringsXml: string | null): string[] => {
  if (!sharedStringsXml) {
    return []
  }

  return [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXmlText(match[1]).replaceAll(/\s+/g, ' ').trim()
  )
}

const parseSheetRows = (sheetXml: string, sharedStrings: string[]): string[][] => {
  const rows: string[][] = []

  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = []

    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]
      const body = cellMatch[2]
      const reference = attributes.match(/\br="([^"]+)"/)?.[1] ?? ''
      const columnIndex = getColumnIndex(reference)

      if (columnIndex >= maxSpreadsheetColumns) {
        continue
      }

      const cellType = attributes.match(/\bt="([^"]+)"/)?.[1] ?? ''
      const rawValue = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ''
      const value = cellType === 's' ? sharedStrings[Number(rawValue)] ?? '' : decodeXmlText(rawValue)
      row[columnIndex] = value
    }

    if (row.some((value) => value)) {
      rows.push(row.map((value) => value ?? ''))
    }

    if (rows.length >= maxSpreadsheetRows) {
      break
    }
  }

  return rows
}

const readSpreadsheetPreview = async (
  targetPath: string
): Promise<Extract<QuickPreviewPayload, { kind: 'spreadsheet' }>> => {
  const buffer = await readFile(targetPath)
  const entries = readZipEntries(buffer)
  const sharedStrings = readSharedStrings(extractZipEntryText(buffer, entries, 'xl/sharedStrings.xml'))
  const sheetEntries = entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, 4)

  const sheets = sheetEntries.map((entry, index) => ({
    name: `Sheet ${index + 1}`,
    rows: parseSheetRows(extractZipEntryText(buffer, entries, entry.name) ?? '', sharedStrings)
  }))

  if (sheets.length === 0) {
    throw new Error('无法读取 Excel 表格内容。')
  }

  return {
    kind: 'spreadsheet',
    sheets
  }
}

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

const archiveExtensionByFormat: Record<ArchiveFormat, string> = {
  zip: '.zip',
  'tar.gz': '.tar.gz'
}

const clampCompressionLevel = (value: number): number => Math.max(0, Math.min(9, Math.trunc(value)))

const withArchiveExtension = (fileName: string, format: ArchiveFormat): string => {
  const trimmedName = fileName.trim()
  const baseName = trimmedName.replace(/\.(zip|tar\.gz)$/i, '') || 'Archive'

  return `${baseName}${archiveExtensionByFormat[format]}`
}

const runArchiveCommand = (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true
    })
    let stderr = ''

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(new Error(`无法启动 ${command} 命令：${error.message}`))
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `${command} 命令退出，状态码 ${code}`))
    })
  })

const createArchive = async (
  sourcePaths: string[],
  destinationDirectory: string,
  options: ArchiveCreationOptions
): Promise<string> => {
  const destinationStats = await stat(destinationDirectory)

  if (!destinationStats.isDirectory()) {
    throw new Error(`${destinationDirectory} 不是文件夹`)
  }

  if (options.format !== 'zip' && options.format !== 'tar.gz') {
    throw new Error('不支持的压缩格式。')
  }

  const uniqueSourcePaths = [...new Set(sourcePaths.filter(Boolean))]

  if (uniqueSourcePaths.length === 0) {
    throw new Error('未选择对象。')
  }

  for (const sourcePath of uniqueSourcePaths) {
    const sourceStats = await stat(sourcePath)

    if (!sourceStats.isFile() && !sourceStats.isDirectory()) {
      throw new Error('只能压缩文件和文件夹。')
    }

    if (dirname(sourcePath) !== destinationDirectory) {
      throw new Error('只能压缩当前文件夹内的对象。')
    }
  }

  if (options.outputName.includes('/') || options.outputName.includes('\\')) {
    throw new Error('生成文件名不能包含路径分隔符。')
  }

  const outputName = withArchiveExtension(options.outputName, options.format)
  const outputPath = await getAvailableOutputPath(destinationDirectory, outputName)
  const entryNames = uniqueSourcePaths.map((sourcePath) => basename(sourcePath))
  const compressionLevel = clampCompressionLevel(options.compressionLevel)

  if (options.format === 'zip') {
    const args = ['-r', `-${compressionLevel}`]

    if (options.password) {
      args.push('-P', options.password)
    }

    await runArchiveCommand('zip', [...args, outputPath, '--', ...entryNames], destinationDirectory)
    return outputPath
  }

  if (options.password) {
    throw new Error('TAR.GZ 格式不支持密码。')
  }

  await runArchiveCommand('tar', ['-czf', outputPath, '--', ...entryNames], destinationDirectory, {
    ...process.env,
    GZIP: `-${compressionLevel}`
  })

  return outputPath
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

  ipcMain.handle('file-manager:watch-directories', async (event, directoryPaths: string[]) => {
    const state = getDirectoryWatcherState(event.sender)
    const nextDirectoryPaths = new Set(directoryPaths.filter((directoryPath) => directoryPath.length > 0))

    for (const [directoryPath, watcher] of state.watchers) {
      if (nextDirectoryPaths.has(directoryPath)) {
        continue
      }

      watcher.close()
      state.watchers.delete(directoryPath)

      const timer = state.timers.get(directoryPath)
      if (timer) {
        clearTimeout(timer)
        state.timers.delete(directoryPath)
      }
    }

    for (const directoryPath of nextDirectoryPaths) {
      if (state.watchers.has(directoryPath)) {
        continue
      }

      try {
        const directoryStats = await stat(directoryPath)

        if (!directoryStats.isDirectory()) {
          continue
        }

        const watcher = watch(directoryPath, () => {
          notifyDirectoryChanged(state, directoryPath)
        })

        watcher.on('error', () => {
          state.watchers.delete(directoryPath)
          notifyDirectoryChanged(state, directoryPath)
        })

        state.watchers.set(directoryPath, watcher)
      } catch {
        notifyDirectoryChanged(state, directoryPath)
      }
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
      return {
        kind: 'text',
        text: await readTextPreview(targetPath)
      }
    }

    if (streamPreviewKinds.has(kind)) {
      return {
        kind,
        sourceUrl: createPreviewUrl(targetPath)
      } as Extract<QuickPreviewPayload, { kind: 'image' | 'video' | 'audio' | 'pdf' | 'model' }>
    }

    if (kind === 'text') {
      return {
        kind,
        text: await readTextPreview(targetPath)
      }
    }

    if (kind === 'document') {
      return readDocumentPreview(targetPath)
    }

    if (kind === 'spreadsheet') {
      return readSpreadsheetPreview(targetPath)
    }

    if (kind === 'archive') {
      return readArchivePreview(targetPath)
    }

    throw new Error('暂不支持预览该文件格式。')
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

  ipcMain.handle(
    'file-manager:create-archive',
    async (_, sourcePaths: string[], destinationDirectory: string, options: ArchiveCreationOptions) =>
      createArchive(sourcePaths, destinationDirectory, options)
  )

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

const registerTerminalHandlers = (): void => {
  ipcMain.handle('terminal:create', async (event, options: TerminalCreateOptions) => {
    const cwd = await resolveTerminalCwd(options.cwd)
    const shellConfig = await getTerminalShell()
    const terminalId = options.id && !terminalSessions.has(options.id) ? options.id : `terminal-${nextTerminalId++}`
    await ensurePtySpawnHelperExecutable()
    const terminalProcess = pty.spawn(shellConfig.command, shellConfig.args, {
      cols: Math.max(20, Math.trunc(options.cols) || 80),
      rows: Math.max(5, Math.trunc(options.rows) || 24),
      cwd,
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color'
      },
      name: 'xterm-256color'
    })

    terminalSessions.set(terminalId, {
      id: terminalId,
      ownerWebContentsId: event.sender.id,
      process: terminalProcess
    })

    if (!terminalCleanupWebContentsIds.has(event.sender.id)) {
      terminalCleanupWebContentsIds.add(event.sender.id)
      event.sender.once('destroyed', () => disposeTerminalSessionsForWebContents(event.sender.id))
    }

    terminalProcess.onData((data) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:data', terminalId, data)
      }
    })

    terminalProcess.onExit((exit) => {
      terminalSessions.delete(terminalId)

      if (!event.sender.isDestroyed()) {
        event.sender.send('terminal:exit', terminalId, exit)
      }
    })

    return {
      id: terminalId,
      cwd,
      shellName: shellConfig.shellName
    }
  })

  ipcMain.on('terminal:write', (event, terminalId: string, data: string) => {
    const session = terminalSessions.get(terminalId)

    if (session?.ownerWebContentsId === event.sender.id) {
      session.process.write(data)
    }
  })

  ipcMain.on('terminal:resize', (event, terminalId: string, cols: number, rows: number) => {
    const session = terminalSessions.get(terminalId)

    if (session?.ownerWebContentsId === event.sender.id) {
      session.process.resize(Math.max(20, Math.trunc(cols) || 80), Math.max(5, Math.trunc(rows) || 24))
    }
  })

  ipcMain.on('terminal:dispose', (event, terminalId: string) => {
    const session = terminalSessions.get(terminalId)

    if (session?.ownerWebContentsId === event.sender.id) {
      disposeTerminalSession(terminalId)
    }
  })
}

const registerPreviewProtocol = (): void => {
  protocol.handle(previewScheme, async (request) => {
    const targetPath = decodePreviewPath(request.url)

    if (!targetPath) {
      return new Response(null, { status: 400 })
    }

    const targetStats = await stat(targetPath)

    const kind = getPreviewKind(targetPath)

    if (!targetStats.isFile() || !kind || !streamPreviewKinds.has(kind)) {
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
  registerTerminalHandlers()
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
