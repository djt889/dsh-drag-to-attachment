/**
 * dsh-drag-to-attachment — host side.
 *
 * Three exact HTTP routes on the DSH webServer:
 *
 *   POST /_dsh/drag-to-attachment/locate { file, phase, ... }
 *     Path locator: resolves the real filesystem path of a dropped/pasted
 *     file or folder. Ported from bill9109/dsh-drag-and-drop (multi-phase:
 *     metadata → sample/full fingerprint → directory structure/content;
 *     Workspace-first, then registered workspaces, common dirs, OS index
 *     and bounded recursive search).
 *
 *   POST /_dsh/drag-to-attachment/save { name, dataBase64 }
 *     Fallback save (only used when a file cannot be located on disk — e.g.
 *     a freshly pasted screenshot that exists only in the clipboard): writes
 *     it into <workspace>/.dsh-drag-to-attachment/pasted-images/ so the
 *     attachment has a real path the agent can read. ≤100MB.
 *
 *   GET /_dsh/drag-to-attachment/file?path=<absolute>
 *     Read-only thumbnail proxy: serves ONE image file (png/jpg/jpeg/webp/
 *     gif/bmp) by absolute path so the browser can render a thumbnail for an
 *     attachment referenced by its real path (the browser refuses file://
 *     URLs). Served on the local web only; images only, ≤20MB.
 */

import { homedir, platform } from 'node:os'
import { access, constants, mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const LOCATE_ROUTE = '/_dsh/drag-to-attachment/locate'
export const SAVE_ROUTE = '/_dsh/drag-to-attachment/save'
export const FILE_ROUTE = '/_dsh/drag-to-attachment/file'

const MAX_LOCATE_BODY_BYTES = 8 * 1024 * 1024
const MAX_THUMB_BYTES = 20 * 1024 * 1024
const MAX_SAVE_BODY_BYTES = 140 * 1024 * 1024 // ~100MB file in base64
const MAX_SAVE_BYTES = 100 * 1024 * 1024

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

export const name = '@dsh-external/dsh-drag-to-attachment'

// ===========================================================================
// Fallback save route (files that cannot be located on disk)
// ===========================================================================

/** Resolve the active session workspace root from the durable workspace registry. */
async function workspaceRoot() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = join(dshHome, 'storages', 'workspace.json')
  let parsed
  try {
    parsed = JSON.parse(await readFile(store, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read workspace registry: ${error instanceof Error ? error.message : String(error)}`)
  }
  const workspaces = parsed?.tables?.workspaces
  if (typeof workspaces !== 'object' || workspaces === null) throw new Error('workspace registry is empty')
  // Prefer workspaces OUTSIDE the DSH home directory (the internal
  // "browser-sessions" project must never be a save root), then the most
  // recently updated one.
  const homePrefix = normalize(dshHome) + sep
  const ids = Object.keys(workspaces).filter((id) => {
    const path = workspaces[id]?.path
    return typeof path === 'string' && path.length > 0 && !normalize(path).startsWith(homePrefix)
  })
  if (ids.length === 0) throw new Error('no workspace registered')
  let best = ids[0]
  for (const id of ids) {
    if ((workspaces[id].updatedAt ?? '') > (workspaces[best].updatedAt ?? '')) best = id
  }
  const path = workspaces[best]?.path
  if (typeof path !== 'string' || path.length === 0) throw new Error('workspace has no path')
  return path
}

/** Strip path separators and control characters from a saved file name. */
function safeName(raw) {
  const base = basename(String(raw ?? ''))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 120)
  return base.length === 0 ? 'file' : base
}

async function handleSave(req, res) {
  const respond = (value, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(value))
  }
  try {
    if (req.method !== 'POST') {
      respond({ ok: false, error: { code: 'method-not-allowed', message: 'Use POST' } }, 405)
      return
    }
    let body
    try {
      body = JSON.parse(await readBody(req, MAX_SAVE_BODY_BYTES))
    } catch (error) {
      respond({ ok: false, error: { code: 'invalid-request', message: error instanceof Error ? error.message : String(error) } }, 400)
      return
    }
    const { name: rawName, dataBase64 } = body
    if (typeof dataBase64 !== 'string') {
      respond({ ok: false, error: { code: 'invalid-request', message: 'Missing dataBase64' } }, 400)
      return
    }
    const bytes = Buffer.from(dataBase64, 'base64')
    if (bytes.length > MAX_SAVE_BYTES) {
      respond({ ok: false, error: { code: 'too-large', message: `File exceeds ${Math.floor(MAX_SAVE_BYTES / 1024 / 1024)}MB` } }, 413)
      return
    }
    const root = await workspaceRoot()
    const dir = join(root, '.dsh-drag-to-attachment', 'pasted-images')
    await mkdir(dir, { recursive: true })
    const target = join(dir, `${Date.now()}-${safeName(rawName)}`)
    await writeFile(target, bytes)
    respond({ ok: true, value: { path: target, filename: basename(target), bytes: bytes.length } })
  } catch (error) {
    respond({ ok: false, error: { code: 'save-failed', message: error instanceof Error ? error.message : String(error) } }, 500)
  }
}

// ===========================================================================
// Locator route (ported from bill9109/dsh-drag-and-drop)
// ===========================================================================

async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function normalizedDirectoryPath(path) {
  const normalized = path.normalize('NFC').replaceAll('\\', '/')
  const parts = normalized.split('/')
  if (normalized.startsWith('/') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError('invalid directory-relative path')
  }
  return normalized
}

function canonicalDirectoryEntries(entries) {
  return entries.map((entry) => ({
    path: normalizedDirectoryPath(entry.path),
    kind: entry.kind,
    ...(entry.kind === 'file' ? { size: entry.size ?? 0 } : {}),
  })).sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind))
}

function directoryStructureDigest(structure) {
  const hash = createHash('sha256')
  hash.update(structure.truncated ? 'truncated\n' : 'complete\n')
  for (const entry of canonicalDirectoryEntries(structure.entries)) hash.update(`${entry.kind}\0${entry.path}\0${entry.size ?? ''}\n`)
  return hash.digest('hex')
}

function selectDirectorySamplePaths(entries) {
  return canonicalDirectoryEntries(entries).filter((entry) => entry.kind === 'file').map((entry) => ({
    path: entry.path,
    rank: createHash('sha256').update(entry.path).digest('hex'),
  })).sort((a, b) => a.rank.localeCompare(b.rank) || a.path.localeCompare(b.path)).slice(0, 24).map((entry) => entry.path)
}

function directoryContentDigest(samples) {
  const hash = createHash('sha256')
  for (const sample of [...samples].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${normalizedDirectoryPath(sample.path)}\0${sample.size}\0${sample.digest}\n`)
  }
  return hash.digest('hex')
}

const SAMPLE_BYTES = 64 * 1024

function sampleRanges(size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('size must be a non-negative safe integer')
  if (size <= 65536 * 3) return [{ start: 0, length: size }]
  return [
    0,
    Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_BYTES / 2)),
    size - SAMPLE_BYTES,
  ].map((start) => ({ start, length: Math.min(SAMPLE_BYTES, size - start) }))
}

function hashParts(size, parts) {
  const hash = createHash('sha256')
  const header = Buffer.allocUnsafe(8)
  header.writeBigUInt64BE(BigInt(size))
  hash.update(header)
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

async function sampleFingerprint(path, size) {
  const handle = await open(path, 'r')
  try {
    const parts = []
    for (const range of sampleRanges(size)) {
      const buffer = Buffer.allocUnsafe(range.length)
      const { bytesRead } = await handle.read(buffer, 0, range.length, range.start)
      parts.push(buffer.subarray(0, bytesRead))
    }
    return hashParts(size, parts)
  } finally {
    await handle.close()
  }
}

async function fullFingerprint(path) {
  const handle = await open(path, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

async function readNodeDirectoryStructure(root) {
  const entries = []
  let truncated = false
  const visit = async (directory, prefix, depth) => {
    if (depth >= 32) { truncated = true; return }
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    } catch { truncated = true; return }
    children.sort((a, b) => a.name.normalize('NFC').localeCompare(b.name.normalize('NFC')))
    for (const child of children) {
      if (entries.length >= 1e4) { truncated = true; return }
      const relativePath = prefix === '' ? child.name : `${prefix}/${child.name}`
      const absolutePath = join(directory, child.name)
      if (child.isSymbolicLink()) continue
      if (child.isDirectory()) {
        entries.push({ path: relativePath, kind: 'directory' })
        await visit(absolutePath, relativePath, depth + 1)
      } else if (child.isFile()) {
        try {
          entries.push({ path: relativePath, kind: 'file', size: (await stat(absolutePath)).size })
        } catch { truncated = true }
      }
    }
  }
  await visit(root, '', 0)
  return { entries, truncated }
}

async function nodeDirectoryStructureDigest(path) {
  const structure = await readNodeDirectoryStructure(path)
  return { digest: directoryStructureDigest(structure), paths: selectDirectorySamplePaths(structure.entries) }
}

async function nodeDirectoryContentDigest(root, paths) {
  const samples = []
  for (const path of paths) {
    const absolutePath = join(root, ...normalizedDirectoryPath(path).split('/'))
    const info = await stat(absolutePath)
    if (!info.isFile()) continue
    samples.push({ path, size: info.size, digest: await sampleFingerprint(absolutePath, info.size) })
  }
  return directoryContentDigest(samples)
}

const execFileAsync = promisify(execFile)
const COMMAND_TIMEOUT_MS = 3e3
const host = {
  platform: platform(),
  home: homedir(),
  async commandExists(command) {
    if (command.includes('/') || command.includes('\\')) {
      try { await access(command, constants.X_OK); return true } catch { return false }
    }
    const probe = platform() === 'win32' ? 'where.exe' : '/usr/bin/env'
    const args = platform() === 'win32' ? [command] : ['sh', '-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command]
    try { await execFileAsync(probe, args, { timeout: 1e3 }); return true } catch { return false }
  },
  async exec(command, args) {
    const { stdout } = await execFileAsync(command, [...args], {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  },
  async windowsDrives() {
    try {
      return (await this.exec('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        '[System.IO.DriveInfo]::GetDrives() | Where-Object {$_.DriveType -eq "Fixed" -and $_.IsReady} | ForEach-Object {$_.RootDirectory.FullName}',
      ])).split(/\r?\n/).filter(Boolean)
    } catch { return [] }
  },
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 100)
}

async function macSearch(name, runtime) {
  const escaped = name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  try { return lines(await runtime.exec('/usr/bin/mdfind', [`kMDItemFSName == "${escaped}"c`])) } catch { return [] }
}

async function linuxSearch(name, runtime) {
  for (const command of ['plocate', 'locate']) {
    if (!await runtime.commandExists(command)) continue
    try {
      return lines(await runtime.exec(command, ['--basename', '--limit', String(400), name]))
        .filter((path) => path.split('/').at(-1) === name).slice(0, 100)
    } catch { /* try next */ }
  }
  return []
}

function powershellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

async function windowsSearch(name, runtime) {
  for (const command of ['es.exe', 'Everything.exe']) {
    if (!await runtime.commandExists(command)) continue
    try {
      return lines(await runtime.exec(command, ['-n', String(100), '-whole-filename', name]))
    } catch { /* try next */ }
  }
  if (!await runtime.commandExists('powershell.exe')) return []
  const roots = [runtime.home, ...await runtime.windowsDrives()]
  const script = [
    `$name=${powershellLiteral(name)}`,
    `$roots=@(${roots.map(powershellLiteral).join(',')}) | Select-Object -Unique`,
    `$roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter $name -File -Recurse -Force -ErrorAction SilentlyContinue }`,
    `| Select-Object -First ${String(100)} -ExpandProperty FullName`,
  ].join(' ')
  try {
    return lines(await runtime.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]))
  } catch { return [] }
}

async function indexedSearch(name, runtime = host) {
  if (runtime.platform === 'darwin') return macSearch(name, runtime)
  if (runtime.platform === 'linux') return linuxSearch(name, runtime)
  if (runtime.platform === 'win32') return windowsSearch(name, runtime)
  return []
}

async function broadSearchRoots(runtime = host) {
  if (runtime.platform === 'linux') {
    const roots = [runtime.home]
    for (const parent of ['/mnt', '/media']) {
      try {
        for (const entry of await readdir(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) roots.push(join(parent, entry.name))
        }
      } catch { /* skip */ }
    }
    return roots
  }
  if (runtime.platform === 'win32') return [runtime.home, ...await runtime.windowsDrives()]
  return []
}

const MAX_CANDIDATES = 100
const MAX_WALK_ENTRIES = 2e4
const WALK_DEPTH = 12
const SHALLOW_MAX_DIRS = 4096

async function directCandidate(root, name, kind) {
  const path = join(root, name)
  try {
    const info = await stat(path)
    return (kind === 'file' ? info.isFile() : info.isDirectory()) ? path : undefined
  } catch { return undefined }
}

async function walkByName(root, name, kind, depth = WALK_DEPTH) {
  const found = []
  let visited = 0
  const visit = async (directory, remaining) => {
    if (remaining < 0 || found.length >= MAX_CANDIDATES || visited >= MAX_WALK_ENTRIES) return
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++visited >= MAX_WALK_ENTRIES || found.length >= MAX_CANDIDATES) break
      const path = join(directory, entry.name)
      if (entry.name === name && (kind === 'file' ? entry.isFile() : entry.isDirectory())) found.push(path)
      if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(path, remaining - 1)
    }
  }
  await visit(root, depth)
  return found
}

async function validateCandidates(item, paths) {
  const candidates = []
  for (const path of [...new Set(paths)].slice(0, MAX_CANDIDATES)) {
    try {
      const info = await stat(path)
      if ((item.kind === 'file' ? info.isFile() && info.size === item.size : info.isDirectory()) && basename(path) === item.name) {
        candidates.push({ path: normalize(path), mtimeMs: info.mtimeMs })
      }
    } catch { /* skip */ }
  }
  return candidates.sort((a, b) => item.kind === 'file'
    ? Math.abs(a.mtimeMs - item.lastModified) - Math.abs(b.mtimeMs - item.lastModified) || a.path.localeCompare(b.path)
    : a.path.localeCompare(b.path))
}

async function shallowCandidates(item, roots) {
  const paths = []
  for (const root of roots) {
    const direct = await directCandidate(root, item.name, item.kind)
    if (direct !== undefined) paths.push(direct)
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) } catch { continue }
    let expanded = 0
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (expanded >= SHALLOW_MAX_DIRS) break
      expanded += 1
      const directory = join(root, entry.name)
      const nested = await directCandidate(directory, item.name, item.kind)
      if (nested !== undefined) paths.push(nested)
      let grandchildren
      try { grandchildren = await readdir(directory, { withFileTypes: true }) } catch { continue }
      for (const grandchild of grandchildren) {
        if (!grandchild.isDirectory() || grandchild.isSymbolicLink()) continue
        const deep = await directCandidate(join(directory, grandchild.name), item.name, item.kind)
        if (deep !== undefined) paths.push(deep)
      }
    }
  }
  return validateCandidates(item, paths)
}

async function recursiveCandidates(item, roots) {
  const paths = []
  for (const root of roots) paths.push(...await walkByName(root, item.name, item.kind))
  return validateCandidates(item, paths)
}

function pathsInside(paths, roots) {
  const canonicalRoots = roots.map((root) => resolve(root))
  return paths.filter((path) => {
    const candidate = resolve(path)
    return canonicalRoots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`))
  })
}

async function metadataCandidates(item, request) {
  const current = request.currentWorkspacePath
  const otherWorkspaces = [...new Set(request.workspacePaths ?? [])]
    .filter((root) => typeof root === 'string' && root !== '')
    .filter((root) => root !== current)
  const commonRoots = [
    join(homedir(), 'Desktop'),
    join(homedir(), 'Documents'),
    join(homedir(), 'Downloads'),
  ]
  const rootGroups = [
    // The current workspace plus its own attachment dir (files we saved
    // there earlier are immediately locatable when re-dropped).
    current === undefined
      ? []
      : [current, join(current, '.dsh-drag-to-attachment', 'pasted-images')],
    otherWorkspaces,
    commonRoots,
  ]
  // Fast path first: shallow probes on the workspace/common roots resolve the
  // overwhelming majority of real drops without any system-index work. The
  // slow OS index (Windows PowerShell recursive search etc.) only runs when
  // no shallow candidate matched — never block a fast hit on a slow index.
  for (const roots of rootGroups) {
    const shallow = await shallowCandidates(item, roots)
    if (shallow.length > 0) return shallow
    const recursive = await recursiveCandidates(item, roots)
    if (recursive.length > 0) return recursive
  }
  const indexedPaths = await indexedSearch(item.name)
  const globalIndexed = await validateCandidates(item, indexedPaths)
  if (globalIndexed.length > 0) return globalIndexed
  return recursiveCandidates(item, await broadSearchRoots())
}

async function matchingFileDigest(candidates, digest, phase, file) {
  const matched = []
  for (const path of candidates.slice(0, MAX_CANDIDATES)) {
    try {
      if ((phase === 'sample' ? await sampleFingerprint(path, file.size) : await fullFingerprint(path)) === digest) matched.push(path)
    } catch { /* skip */ }
  }
  return matched
}

async function locateDirectoryStructure(request) {
  if (request.file.kind !== 'directory' || request.file.structure === undefined || request.candidates === undefined) {
    return { status: 'error', message: 'directory structure phase requires candidates and structure' }
  }
  const candidates = request.candidates
  const expected = directoryStructureDigest(request.file.structure)
  const matched = []
  let samplePaths = selectDirectorySamplePaths(request.file.structure.entries)
  for (const path of candidates) {
    try {
      const actual = await nodeDirectoryStructureDigest(path)
      if (actual.digest === expected) {
        matched.push(path)
        samplePaths = actual.paths
      }
    } catch { /* skip */ }
  }
  if (matched.length === 0) return { status: 'not-found' }
  if (matched.length === 1) return { status: 'found', path: matched[0] }
  if (samplePaths.length === 0) return { status: 'choose', candidates: matched }
  return { status: 'directory-content-required', candidates: matched, paths: samplePaths }
}

async function locate(request) {
  if (request.file.name === '') return { status: 'error', message: 'invalid dropped entry metadata' }
  if (request.file.kind === undefined) request = { ...request, file: { ...request.file, kind: 'file' } }
  if (request.file.kind === 'directory') {
    if (request.phase === 'metadata') {
      const candidates = await metadataCandidates(request.file, request)
      if (candidates.length === 0) return { status: 'not-found' }
      if (candidates.length === 1) return { status: 'found', path: candidates[0].path }
      return { status: 'directory-structure-required', candidates: candidates.map((candidate) => candidate.path) }
    }
    if (request.phase === 'directory-structure') return locateDirectoryStructure(request)
    if (request.phase !== 'directory-content' || request.candidates === undefined || request.directorySamples === undefined) {
      return { status: 'error', message: 'invalid directory phase' }
    }
    const expected = directoryContentDigest(request.directorySamples)
    const paths = request.directorySamples.map((sample) => sample.path)
    const matched = []
    for (const path of request.candidates.slice(0, MAX_CANDIDATES)) {
      try {
        if (await nodeDirectoryContentDigest(path, paths) === expected) matched.push(path)
      } catch { /* skip */ }
    }
    if (matched.length === 0) return { status: 'not-found' }
    if (matched.length === 1) return { status: 'found', path: matched[0] }
    return { status: 'choose', candidates: matched }
  }
  if (!Number.isSafeInteger(request.file.size) || request.file.size < 0) {
    return { status: 'error', message: 'invalid dropped-file metadata' }
  }
  if (request.phase === 'metadata') {
    const candidates = await metadataCandidates(request.file, request)
    if (candidates.length === 0) return { status: 'not-found' }
    if (candidates.length === 1) return { status: 'found', path: candidates[0].path }
    return { status: 'sample-required', candidates: candidates.map((candidate) => candidate.path) }
  }
  if ((request.phase !== 'sample' && request.phase !== 'full') || request.digest === undefined || request.candidates === undefined) {
    return { status: 'error', message: 'digest phase requires candidates and digest' }
  }
  const matched = await matchingFileDigest(request.candidates, request.digest, request.phase, request.file)
  if (matched.length === 0) return { status: 'not-found' }
  if (matched.length === 1) return { status: 'found', path: matched[0] }
  if (request.phase === 'sample' && request.file.size <= 8388608) return { status: 'choose', candidates: matched }
  if (request.phase === 'sample') return { status: 'full-required', candidates: matched }
  return { status: 'choose', candidates: matched }
}

// ===========================================================================
// apply
// ===========================================================================

export async function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposeLocate = webCtx.webServer.register({
        kind: 'exact',
        path: LOCATE_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            })
            res.end(JSON.stringify({ status: 'error', message: 'method not allowed' }))
            return
          }
          try {
            const body = JSON.parse(await readBody(req, MAX_LOCATE_BODY_BYTES))
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            })
            res.end(JSON.stringify(await locate(body)))
          } catch (error) {
            res.writeHead(400, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            })
            res.end(JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) }))
          }
        },
      })
      const disposeFile = webCtx.webServer.register({
        kind: 'exact',
        path: FILE_ROUTE,
        handler: async (req, res) => {
          const respond = (status, message) => {
            res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
            res.end(message)
          }
          if (req.method !== 'GET') { respond(405, 'method not allowed'); return }
          let path
          try {
            path = new URL(req.url, 'http://localhost').searchParams.get('path')
          } catch (error) { respond(400, 'bad request'); return }
          if (typeof path !== 'string' || path.length === 0) { respond(400, 'missing path'); return }
          const ext = extname(path).toLowerCase()
          const mediaType = IMAGE_TYPES[ext]
          if (mediaType === undefined) { respond(415, 'not an image'); return }
          try {
            const info = await stat(path)
            if (!info.isFile() || info.size > MAX_THUMB_BYTES) { respond(413, 'not a file or too large'); return }
            const bytes = await readFile(path)
            res.writeHead(200, {
              'content-type': mediaType,
              'cache-control': 'private, max-age=3600',
              'x-content-type-options': 'nosniff',
              'content-length': String(bytes.length),
            })
            res.end(bytes)
          } catch (error) {
            respond(404, 'file not found')
          }
        },
      })
      const disposeSave = webCtx.webServer.register({
        kind: 'exact',
        path: SAVE_ROUTE,
        handler: (req, res) => handleSave(req, res),
      })
      return () => { disposeLocate(); disposeFile(); disposeSave() }
    }, 'drag-to-attachment: locator + save + thumbnail routes')
  })
}
