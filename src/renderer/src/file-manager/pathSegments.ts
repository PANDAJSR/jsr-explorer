import type { PathSegment, Platform } from './types'

export const getPathSegments = (targetPath: string, platform: Platform): PathSegment[] => {
  if (!targetPath) {
    return []
  }

  return platform === 'win32' ? getWindowsPathSegments(targetPath) : getPosixPathSegments(targetPath)
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
