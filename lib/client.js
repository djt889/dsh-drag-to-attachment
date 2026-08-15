/**
 * dsh-drag-to-attachment — browser side.
 *
 * One toggle, two modes (stored in localStorage, default = attachment):
 *
 *  ATTACHMENT mode (default): drop or paste files ANYWHERE on the page
 *    (full-page dim + hint overlay) and they become attachments in the
 *    composer: every image, file and folder is located to its REAL
 *    filesystem path (Workspace-first, then registered workspaces, common
 *    dirs, OS index, bounded recursive search) and shown as a chip in the
 *    attachment rail — NOTHING is uploaded, copied or moved. On send the
 *    conversation.sendSession prototype is wrapped: the queued original
 *    paths are appended to the message as plain text (+ your text) — a
 *    text-only model agent reads the files with dsh-vision-toolkit /
 *    document tools, and the native image preflight (`attachment-error`)
 *    is bypassed because no image block reaches the wire.
 *
 *  PATH mode: drop or paste files anywhere, locate their REAL filesystem
 *    paths and insert them into the draft as plain paths (ported from
 *    bill9109/dsh-drag-and-drop).
 *
 * All file types are accepted. When a real path cannot be located (e.g.
 * an unsaved clipboard screenshot), a visible toast explains — nothing is
 * silently dropped.
 */

window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-drag-to-attachment',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = null
    try { React = require('react') } catch (error) { /* toggle button falls back to absent */ }

    var LOCATE_ROUTE = '/_dsh/drag-to-attachment/locate'
    var FILE_ROUTE = '/_dsh/drag-to-attachment/file'
    var SAVE_ROUTE = '/_dsh/drag-to-attachment/save'
    var PATCH_MARK = '__dshDragToAttachmentPatched'
    var CHIPS_ATTR = 'data-drag-to-attachment-chips'
    var OVERLAY_ID = 'dsh-drag-to-attachment-overlay'
    var MAX_DIR_FILES = 300
    var SAMPLE_BYTES = 64 * 1024

    // ----------------------------------------------------------------- mode

    var MODE_KEY = 'dsh.dragToAttachment.mode'
    var currentMode = 'attachment'
    function loadMode() {
      try {
        currentMode = window.localStorage.getItem(MODE_KEY) === 'path' ? 'path' : 'attachment'
      } catch (error) { currentMode = 'attachment' }
    }
    function setMode(next) {
      currentMode = next === 'path' ? 'path' : 'attachment'
      try { window.localStorage.setItem(MODE_KEY, currentMode) } catch (error) { /* best-effort */ }
    }
    loadMode()

    /** Queued attachments: { path, name, isDir?, count? } in drop order. */
    var fileQueue = []
    /** Page toast (created in apply; module-level so the send patch can use it). */
    var toast = null
    /** Active apply context (module-level so chips/placeholder can reach input). */
    var activeCtx = null
    /**
     * Invisible draft filler (ZERO WIDTH NON-JOINER): lets the composer's
     * send button become enabled when only file attachments are queued and
     * the user typed nothing. Stripped from the wire text by the send patch.
     */
    var PLACEHOLDER = '\u200C'

    // ------------------------------------------------------------- utilities

    function isImageFile(file) {
      return !!file && typeof file.type === 'string' && file.type.indexOf('image/') === 0
    }

    function toBase64(buffer) {
      var bytes = new Uint8Array(buffer)
      var binary = ''
      var chunk = 0x8000
      for (var i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      }
      return btoa(binary)
    }

    /**
     * Fallback save: persists a file that cannot be located on disk (e.g. a
     * freshly pasted clipboard screenshot) into the workspace attachment dir
     * so the attachment still has a real path the agent can read.
     */
    function saveFileToWorkspace(file) {
      return file.arrayBuffer().then(function (buffer) {
        return fetch(SAVE_ROUTE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, dataBase64: toBase64(buffer) }),
        })
      }).then(function (response) {
        return response.json().then(function (result) {
          if (!response.ok || !result.ok) {
            throw new Error(result.error && result.error.message ? result.error.message : 'save failed')
          }
          return result.value.path
        })
      })
    }

    /** Workspace path of the given (or current) session, from the sessions service. */
    function currentWorkspace(sessions, sessionId) {
      try {
        var state = sessions && sessions.list ? sessions.list.getSnapshot() : undefined
        if (!state) return undefined
        var id = sessionId || state.current
        if (!id) return undefined
        var row = state.byId ? state.byId[id] : undefined
        return row && typeof row.cwd === 'string' && row.cwd.length > 0 ? row.cwd : undefined
      } catch (error) { /* best-effort */ }
      return undefined
    }

    function currentWorkspacePath(ctx) {
      try {
        var sessionId = ctx.sessions.list.getSnapshot().current
        return sessionId === undefined ? undefined : ctx.sessions.list.getSnapshot().byId[sessionId] && ctx.sessions.list.getSnapshot().byId[sessionId].cwd
      } catch (error) { /* best-effort */ }
      return undefined
    }

    function currentInput(ctx) {
      try {
        var sessionId = ctx.sessions.list.getSnapshot().current
        if (sessionId === undefined) return undefined
        var scope = ctx.sessions.scope(sessionId)
        var conversation = ctx.get('conversation')
        return scope === undefined || conversation === undefined ? undefined : conversation.input.for(scope)
      } catch (error) { /* best-effort */ }
      return undefined
    }

    function appendPaths(input, paths) {
      var draft = input.state.getSnapshot().draft
      var text = paths.join('\n')
      input.setDraft(draft === '' ? text : draft + '\n' + text)
    }

    // ------------------------------------------------------------- full-page overlay

    function createFileIcon() {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 64 64')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('width', '64')
      svg.setAttribute('height', '64')
      svg.style.color = 'var(--dsw-alias-state-business-primary, #3964fe)'
      svg.innerHTML = [
        '<path d="M18 7h19.2c1.8 0 3.5.7 4.8 2l9 9c1.3 1.3 2 3 2 4.8V49a8 8 0 0 1-8 8H18a8 8 0 0 1-8-8V15a8 8 0 0 1 8-8Z" fill="currentColor"/>',
        '<path d="M37 7.1V18a5 5 0 0 0 5 5h10.9c-.1-1.9-.8-3.6-2.1-4.9l-8.9-9A7.1 7.1 0 0 0 37 7.1Z" fill="rgb(255 255 255 / 38%)"/>',
        '<path d="M21 32h22M21 40h22M21 48h14" fill="none" stroke="white" stroke-width="3.2" stroke-linecap="round" opacity=".92"/>',
      ].join('')
      return svg
    }

    function createOverlay() {
      var root = document.createElement('div')
      root.id = OVERLAY_ID
      root.setAttribute('role', 'status')
      root.setAttribute('aria-live', 'polite')
      Object.assign(root.style, {
        position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
        padding: '24px', pointerEvents: 'none', opacity: '0', visibility: 'hidden',
        transition: 'opacity 140ms ease, visibility 140ms ease', background: 'rgb(15 23 42 / 44%)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      })
      var panel = document.createElement('div')
      Object.assign(panel.style, {
        display: 'grid', justifyItems: 'center', gap: '14px', minWidth: '260px', padding: '28px 36px',
        color: '#ffffff',
        font: '600 16px/1.4 -apple-system, BlinkMacSystemFont, sans-serif',
        letterSpacing: '0',
      })
      panel.append(createFileIcon())
      var label = document.createElement('span')
      panel.append(label)
      root.append(panel)
      document.body.append(root)
      return {
        setActive(active) {
          root.style.opacity = active ? '1' : '0'
          root.style.visibility = active ? 'visible' : 'hidden'
        },
        setLabel(text) { label.textContent = text },
        dispose() { root.remove() },
      }
    }

    function hasFilePayload(event) {
      var types = event.dataTransfer ? event.dataTransfer.types : []
      return types.indexOf('Files') !== -1 || types.indexOf('text/uri-list') !== -1
    }

    // ------------------------------------------------------------------ toast

    function createToastTimer(duration, dismiss) {
      var handle = null
      var deadline = 0
      var remaining = duration
      return {
        arm() {
          handle = setTimeout(dismiss, duration)
          deadline = Date.now() + duration
        },
        pause() {
          remaining = Math.max(0, deadline - Date.now())
          if (handle !== null) clearTimeout(handle)
          handle = null
        },
        resume() {
          if (handle !== null) clearTimeout(handle)
          handle = setTimeout(dismiss, remaining)
          deadline = Date.now() + remaining
        },
        cancel() {
          if (handle !== null) clearTimeout(handle)
          handle = null
        },
      }
    }

    function createFileDropToast() {
      var root = document.createElement('div')
      root.setAttribute('role', 'alert')
      root.setAttribute('aria-live', 'assertive')
      Object.assign(root.style, {
        position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483646', display: 'none',
        alignItems: 'flex-start', gap: '10px', width: 'min(420px, calc(100vw - 32px))', boxSizing: 'border-box',
        padding: '12px 12px 12px 14px',
        border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, rgb(15 23 42 / 14%))',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-state-error-primary, #d92d20)',
        boxShadow: 'var(--dsw-shadow-lv3, 0 12px 32px rgb(15 23 42 / 18%))',
        font: '400 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif',
        letterSpacing: '0',
      })
      var message = document.createElement('div')
      Object.assign(message.style, {
        flex: '1', minWidth: '0', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap',
      })
      var close = document.createElement('button')
      close.type = 'button'
      close.setAttribute('aria-label', '关闭')
      close.title = '关闭'
      close.textContent = '×'
      Object.assign(close.style, {
        flex: '0 0 24px', width: '24px', height: '24px', margin: '-3px -3px 0 0', padding: '0',
        border: '0', borderRadius: '4px', background: 'transparent', color: 'currentColor',
        cursor: 'pointer', font: '400 20px/22px -apple-system, BlinkMacSystemFont, sans-serif', letterSpacing: '0',
      })
      root.append(message, close)
      document.body.append(root)
      var hide = function () { root.style.display = 'none' }
      var timer = createToastTimer(8000, hide)
      close.addEventListener('click', function () { timer.cancel(); hide() })
      root.addEventListener('mouseenter', function () { timer.pause() })
      root.addEventListener('mouseleave', function () { if (root.style.display !== 'none') timer.resume() })
      return {
        showError(text) {
          message.textContent = text
          root.style.display = 'flex'
          timer.arm()
        },
        dispose() { timer.cancel(); root.remove() },
      }
    }

    // =========================================================================
    // PATH mode — ported from bill9109/dsh-drag-and-drop
    // =========================================================================

    // --- chooser ---
    function choosePath(name, candidates) {
      return new Promise(function (resolve) {
        var backdrop = document.createElement('div')
        Object.assign(backdrop.style, {
          position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
          padding: '24px', background: 'rgb(15 23 42 / 35%)',
        })
        var panel = document.createElement('div')
        Object.assign(panel.style, {
          width: 'min(680px, 100%)', maxHeight: 'min(560px, 80vh)', overflow: 'auto',
          background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px',
          boxShadow: '0 18px 48px rgb(15 23 42 / 28%)', padding: '20px',
          font: '14px/1.5 -apple-system, BlinkMacSystemFont, sans-serif',
        })
        var title = document.createElement('h2')
        title.textContent = '选择 ' + name + ' 的原始路径'
        Object.assign(title.style, { margin: '0 0 14px', fontSize: '16px', letterSpacing: '0' })
        panel.append(title)
        var finish = function (path) { backdrop.remove(); resolve(path) }
        candidates.forEach(function (path) {
          var button = document.createElement('button')
          button.type = 'button'
          button.textContent = path
          Object.assign(button.style, {
            display: 'block', width: '100%', margin: '8px 0', padding: '10px 12px', textAlign: 'left',
            border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', color: '#0f172a',
            cursor: 'pointer', overflowWrap: 'anywhere', letterSpacing: '0',
          })
          button.addEventListener('click', function () { finish(path) })
          panel.append(button)
        })
        var cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = '取消'
        Object.assign(cancel.style, {
          marginTop: '10px', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '6px',
          background: '#fff', color: '#334155', cursor: 'pointer', letterSpacing: '0',
        })
        cancel.addEventListener('click', function () { finish(undefined) })
        panel.append(cancel)
        backdrop.addEventListener('click', function (event) { if (event.target === backdrop) finish(undefined) })
        backdrop.append(panel)
        document.body.append(backdrop)
      })
    }

    // --- fingerprint ---
    function droppedFileMeta(file) {
      return { kind: 'file', name: file.name, size: file.size, lastModified: file.lastModified }
    }
    function sampleRanges(size) {
      if (size <= 65536 * 3) return [{ start: 0, end: size }]
      return [
        0,
        Math.max(0, Math.floor(size / 2) - Math.floor(SAMPLE_BYTES / 2)),
        size - SAMPLE_BYTES,
      ].map(function (start) { return { start: start, end: Math.min(start + SAMPLE_BYTES, size) } })
    }
    function hex(buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (value) {
        return value.toString(16).padStart(2, '0')
      }).join('')
    }
    function sampleFingerprint(file) {
      var ranges = sampleRanges(file.size)
      return Promise.all(ranges.map(function (range) { return file.slice(range.start, range.end).arrayBuffer() }))
        .then(function (parts) {
          var total = parts.reduce(function (sum, part) { return sum + part.byteLength }, 8)
          var combined = new Uint8Array(total)
          new DataView(combined.buffer).setBigUint64(0, BigInt(file.size))
          var cursor = 8
          parts.forEach(function (part) { combined.set(new Uint8Array(part), cursor); cursor += part.byteLength })
          return crypto.subtle.digest('SHA-256', combined)
        }).then(function (digest) { return hex(digest) })
    }
    function fullFingerprint(file) {
      return file.arrayBuffer().then(function (buffer) {
        return crypto.subtle.digest('SHA-256', buffer)
      }).then(function (digest) { return hex(digest) })
    }

    // --- directory (path mode) ---
    function readFile(entry) {
      return new Promise(function (resolve, reject) { entry.file(resolve, reject) })
    }
    function readChildren(entry) {
      var reader = entry.createReader()
      var all = []
      function next() {
        return new Promise(function (resolve, reject) { reader.readEntries(resolve, reject) })
          .then(function (batch) {
            if (batch.length === 0) return all
            all.push.apply(all, batch)
            return next()
          })
      }
      return next()
    }
    function droppedDirectories(dataTransfer) {
      var directories = []
      var items = Array.prototype.slice.call(dataTransfer.items || [])
      items.forEach(function (item, itemIndex) {
        var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
        if (entry && entry.isDirectory === true) directories.push({ itemIndex: itemIndex, name: entry.name, entry: entry })
      })
      return directories
    }
    function droppedItems(dataTransfer) {
      var directories = droppedDirectories(dataTransfer)
      var directoryItemIndexes = {}
      directories.forEach(function (directory) { directoryItemIndexes[directory.itemIndex] = true })
      var files = []
      var items = Array.prototype.slice.call(dataTransfer.items || [])
      items.forEach(function (item, index) {
        if (directoryItemIndexes[index] || item.kind !== 'file') return
        var file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
        if (file !== null) files.push(file)
      })
      return { directories: directories, files: files }
    }
    function readDirectoryStructure(root) {
      var entries = []
      var truncated = false
      function visit(directory, prefix, depth) {
        if (depth >= 32) { truncated = true; return Promise.resolve() }
        return readChildren(directory).then(function (children) {
          children.sort(function (a, b) { return a.name.normalize('NFC').localeCompare(b.name.normalize('NFC')) })
          var chain = Promise.resolve()
          children.forEach(function (child) {
            chain = chain.then(function () {
              if (entries.length >= 1e4) { truncated = true; return }
              var path = prefix === '' ? child.name : prefix + '/' + child.name
              if (child.isDirectory) {
                entries.push({ path: path, kind: 'directory' })
                return visit(child, path, depth + 1)
              }
              if (child.isFile) {
                return readFile(child).then(function (file) {
                  entries.push({ path: path, kind: 'file', size: file.size })
                })
              }
            })
          })
          return chain
        })
      }
      return visit(root, '', 0).then(function () { return { entries: entries, truncated: truncated } })
    }
    function findEntry(root, relativePath) {
      var current = root
      var parts = relativePath.split('/')
      var chain = Promise.resolve()
      parts.forEach(function (part) {
        chain = chain.then(function () {
          if (!current || !current.isDirectory) return
          return readChildren(current).then(function (children) {
            current = null
            children.forEach(function (entry) {
              if (entry.name.normalize('NFC') === part.normalize('NFC')) current = entry
            })
          })
        })
      })
      return chain.then(function () { return current })
    }
    function readDirectoryContentSamples(root, paths) {
      var samples = []
      var chain = Promise.resolve()
      paths.forEach(function (path) {
        chain = chain.then(function () { return findEntry(root, path) }).then(function (entry) {
          if (!entry || entry.isFile !== true) return
          return readFile(entry).then(function (file) {
            return sampleFingerprint(file).then(function (digest) {
              samples.push({ path: path, size: file.size, digest: digest })
            })
          })
        })
      })
      return chain.then(function () { return samples })
    }

    // --- locator request ---
    function request(body) {
      return fetch(LOCATE_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (response) {
        return response.json().then(function (value) {
          return response.ok ? value : { status: 'error', message: value.status === 'error' ? value.message : 'HTTP ' + response.status }
        })
      })
    }
    function workspaceContext(workspaces, cwd) {
      var context = { workspacePaths: [] }
      try { context.workspacePaths = workspaces.list.getSnapshot().items.map(function (item) { return item.path }) } catch (error) { /* best-effort */ }
      if (cwd !== undefined) context.currentWorkspacePath = cwd
      return context
    }
    function locateDroppedFile(file, workspaces, cwd) {
      var meta = droppedFileMeta(file)
      return request({ phase: 'metadata', file: meta, ...workspaceContext(workspaces, cwd) }).then(function (result) {
        if (result.status !== 'sample-required') return result
        return sampleFingerprint(file).then(function (digest) {
          return request({ phase: 'sample', file: meta, candidates: result.candidates, digest: digest })
        }).then(function (result2) {
          if (result2.status !== 'full-required') return result2
          return fullFingerprint(file).then(function (full) {
            return request({ phase: 'full', file: meta, candidates: result2.candidates, digest: full })
          })
        })
      })
    }
    function locateDroppedDirectory(directory, workspaces, cwd) {
      var initial = { kind: 'directory', name: directory.name }
      return request({ phase: 'metadata', file: initial, ...workspaceContext(workspaces, cwd) }).then(function (result) {
        if (result.status !== 'directory-structure-required') return result
        return readDirectoryStructure(directory.entry).then(function (structure) {
          var meta = { ...initial, structure: structure }
          return request({ phase: 'directory-structure', file: meta, candidates: result.candidates }).then(function (result2) {
            if (result2.status !== 'directory-content-required') return result2
            return readDirectoryContentSamples(directory.entry, result2.paths).then(function (samples) {
              return request({ phase: 'directory-content', file: meta, candidates: result2.candidates, directorySamples: samples })
            })
          })
        })
      })
    }

    // --- paths from uri-list ---
    function detectPathPlatform(navigatorValue) {
      navigatorValue = navigatorValue || navigator
      var platformValue = (navigatorValue.userAgentData && navigatorValue.userAgentData.platform) || navigatorValue.platform
      return /win/i.test(platformValue) ? 'windows' : 'posix'
    }
    function pathFromFileUrl(url, platformValue) {
      if (url.protocol !== 'file:') return undefined
      var pathname = decodeURIComponent(url.pathname)
      if (pathname.charAt(0) !== '/' || pathname === '/') return undefined
      if (platformValue === 'posix') return url.host === '' || url.host === 'localhost' ? pathname : undefined
      if (url.host !== '' && url.host !== 'localhost') return '\\\\' + decodeURIComponent(url.host) + pathname.replaceAll('/', '\\')
      var drivePath = /^\/([A-Za-z]:)(\/.*)$/.exec(pathname)
      if (drivePath === null) return undefined
      return drivePath[1] + drivePath[2].replaceAll('/', '\\')
    }
    function pathsFromUriList(value, platformValue) {
      if (platformValue === undefined) platformValue = detectPathPlatform()
      var paths = []
      var seen = {}
      String(value || '').split(/\r?\n/).forEach(function (line) {
        var candidate = line.trim()
        if (candidate === '' || candidate.charAt(0) === '#') return
        var url
        try { url = new URL(candidate) } catch (error) { return }
        var path = pathFromFileUrl(url, platformValue)
        if (path === undefined || seen[path]) return
        seen[path] = true
        paths.push(path)
      })
      return paths
    }
    function pathsFromDrop(dataTransfer, platformValue) {
      var uriPaths = pathsFromUriList(dataTransfer.getData('text/uri-list'), platformValue)
      if (uriPaths.length > 0) return uriPaths
      return pathsFromUriList(dataTransfer.getData('text/plain'), platformValue)
    }

    // --- path-mode handlers ---
    function handlePathDrop(ctx, dataTransfer, toast) {
      var input = currentInput(ctx)
      if (input === undefined) return
      var direct = pathsFromDrop(dataTransfer)
      if (direct.length > 0) { appendPaths(input, direct); return }
      var dropped = droppedItems(dataTransfer)
      var entries = []
      dropped.directories.forEach(function (directory) {
        entries.push({ name: directory.name, locate: function () { return locateDroppedDirectory(directory, ctx.workspaces, currentWorkspacePath(ctx)) } })
      })
      dropped.files.forEach(function (file) {
        entries.push({ name: file.name, locate: function () { return locateDroppedFile(file, ctx.workspaces, currentWorkspacePath(ctx)) } })
      })
      var found = []
      var failures = []
      var chain = Promise.resolve()
      entries.forEach(function (entry) {
        chain = chain.then(function () { return entry.locate() }).then(function (result) {
          if (result.status === 'found') found.push(result.path)
          else if (result.status === 'choose') {
            return choosePath(entry.name, result.candidates).then(function (selected) {
              if (selected === undefined) failures.push(entry.name)
              else found.push(selected)
            })
          } else if (result.status === 'error') failures.push(entry.name + '（' + result.message + '）')
          else failures.push(entry.name)
        }).catch(function (error) {
          failures.push(entry.name + '（' + (error && error.message ? error.message : String(error)) + '）')
        })
      })
      chain.then(function () {
        if (found.length > 0) appendPaths(input, found)
        if (failures.length > 0) toast.showError('未能定位原始路径：' + failures.join('、'))
      })
    }

    /** Path-mode paste: supports files AND folders (webkitGetAsEntry). */
    function handlePathPaste(ctx, clipboardData, toast) {
      var input = currentInput(ctx)
      if (input === undefined) return
      var items = Array.prototype.slice.call(clipboardData && clipboardData.items ? clipboardData.items : [])
      var files = []
      var dirs = []
      var promises = items.map(function (item) {
        if (item.kind !== 'file') return Promise.resolve()
        var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
        if (entry && entry.isDirectory) { dirs.push({ entry: entry, name: entry.name }); return Promise.resolve() }
        var file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
        if (file) files.push(file)
        return Promise.resolve()
      })
      Promise.all(promises).then(function () {
        var found = []
        var failures = []
        var chain = Promise.resolve()
        files.forEach(function (file) {
          chain = chain.then(function () { return locateDroppedFile(file, ctx.workspaces, currentWorkspacePath(ctx)) }).then(function (result) {
            if (result.status === 'found') found.push(result.path)
            else if (result.status === 'choose') {
              return choosePath(file.name, result.candidates).then(function (selected) {
                if (selected === undefined) failures.push(file.name)
                else found.push(selected)
              })
            } else if (result.status === 'error') failures.push(file.name + '（' + result.message + '）')
            else failures.push(file.name)
          }).catch(function (error) {
            failures.push(file.name + '（' + (error && error.message ? error.message : String(error)) + '）')
          })
        })
        dirs.forEach(function (dir) {
          chain = chain.then(function () { return locateDroppedDirectory(dir, ctx.workspaces, currentWorkspacePath(ctx)) }).then(function (result) {
            if (result.status === 'found') found.push(result.path)
            else if (result.status === 'choose') {
              return choosePath(dir.name, result.candidates).then(function (selected) {
                if (selected === undefined) failures.push(dir.name)
                else found.push(selected)
              })
            } else if (result.status === 'error') failures.push(dir.name + '（' + result.message + '）')
            else failures.push(dir.name)
          }).catch(function (error) {
            failures.push(dir.name + '（' + (error && error.message ? error.message : String(error)) + '）')
          })
        })
        chain.then(function () {
          if (found.length > 0) appendPaths(input, found)
          if (failures.length > 0) toast.showError('未能定位原始路径：' + failures.join('、'))
        })
      })
    }

    // =========================================================================
    // ATTACHMENT mode
    // =========================================================================

    // --- FileSystemEntry reading (files + folders for locating) ---
    function entryFile(entry) {
      return new Promise(function (resolve, reject) { entry.file(resolve, reject) })
    }

    /** Collect everything from a drop: images, plain files, folders. */
    function collectDrop(dataTransfer) {
      var result = { images: [], files: [], dirs: [] }
      var items = Array.prototype.slice.call(dataTransfer && dataTransfer.items ? dataTransfer.items : [])
      var promises = items.map(function (item) {
        if (item.kind !== 'file') return Promise.resolve()
        var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
        if (entry && entry.isDirectory) { result.dirs.push({ entry: entry, name: entry.name }); return Promise.resolve() }
        if (entry && entry.isFile) {
          return entryFile(entry).then(function (file) {
            if (isImageFile(file)) result.images.push(file)
            else result.files.push({ file: file, relPath: undefined })
          })
        }
        var raw = typeof item.getAsFile === 'function' ? item.getAsFile() : null
        if (raw) {
          if (isImageFile(raw)) result.images.push(raw)
          else result.files.push({ file: raw, relPath: undefined })
        }
        return Promise.resolve()
      })
      return Promise.all(promises).then(function () { return result })
    }

    // --- chips (attachment rail) ---
    function fileKind(name) {
      var n = String(name || '').toLowerCase()
      if (/\.pdf$/.test(n)) return { icon: '📕', color: '#d9534f' }
      if (/\.docx?$/.test(n)) return { icon: '📘', color: '#2b579a' }
      if (/\.xlsx?$/.test(n)) return { icon: '📗', color: '#217346' }
      if (/\.pptx?$/.test(n)) return { icon: '📙', color: '#d24726' }
      if (/\.(txt|md|csv|json|log|ya?ml|xml|toml|ini)$/.test(n)) return { icon: '📄', color: '#6b7280' }
      if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return { icon: '📦', color: '#b45309' }
      if (/\.(mp4|mov|webm|mkv|avi)$/.test(n)) return { icon: '🎬', color: '#7c3aed' }
      if (/\.(mp3|wav|flac|m4a|aac|ogg)$/.test(n)) return { icon: '🎵', color: '#0e7490' }
      if (/\.(js|ts|jsx|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|swift|kt|sql|sh|ps1)$/.test(n)) return { icon: '💻', color: '#0284c7' }
      return { icon: '📄', color: '#6b7280' }
    }
    function findRail() { return document.querySelector('[class*="_attachments"]') }
    function findComposer() { return document.querySelector('textarea') }
    function findCard(ta) {
      var scroll = ta.parentElement && ta.parentElement.parentElement
      return scroll ? scroll.parentElement : null
    }
    function thumbnailSize() {
      try {
        var img = document.querySelector('img[src^="blob:"]')
        if (img) {
          var w = Math.round(img.getBoundingClientRect().width)
          if (w >= 32 && w <= 160) return w
        }
      } catch (error) { /* fall through */ }
      return 62
    }
    function renderChips() {
      var ta = findComposer()
      if (!ta) return
      var old = document.querySelector('[' + CHIPS_ATTR + ']')
      if (old) old.remove()
      if (fileQueue.length === 0) return
      var bar = document.createElement('div')
      bar.setAttribute(CHIPS_ATTR, '1')
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:4px 14px'
      fileQueue.forEach(function (item) {
        var size = thumbnailSize()
        var kind = item.isDir ? { icon: '📁', color: '#8a5a00' } : fileKind(item.name)
        var chip = document.createElement('span')
        chip.style.cssText = 'position:relative;display:inline-flex;flex-direction:column;align-items:center;' +
          'justify-content:center;gap:2px;width:' + size + 'px;height:' + size + 'px;box-sizing:border-box;' +
          'border:1px solid rgba(92,108,213,.4);background:rgba(92,108,213,.08);' +
          'border-radius:8px;overflow:hidden'
        // Images show their real thumbnail preview; other items a format icon.
        if (item.previewUrl) {
          var thumb = document.createElement('img')
          thumb.src = item.previewUrl
          thumb.alt = item.name
          thumb.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
          chip.append(thumb)
        } else if (!item.isDir && isImagePath(item.path)) {
          // Path-only image (file:// fast path): render it via the local
          // read-only proxy — still a real thumbnail, no search needed.
          var pathThumb = document.createElement('img')
          pathThumb.src = FILE_ROUTE + '?path=' + encodeURIComponent(item.path)
          pathThumb.alt = item.name
          pathThumb.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
          chip.append(pathThumb)
        } else {
          var iconBox = document.createElement('span')
          iconBox.textContent = kind.icon
          iconBox.style.cssText = 'font-size:' + Math.max(18, Math.round(size * 0.42)) + 'px;line-height:1'
          chip.append(iconBox)
        }
        var label = document.createElement('span')
        label.textContent = item.isDir && item.count ? item.name + ' (' + item.count + ')' : item.name
        label.title = item.path || item.name
        label.style.cssText = 'max-width:' + (size - 6) + 'px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
          'font:10px/1.2 sans-serif;color:var(--dsw-alias-fg-tertiary,#6f7c99);padding:0 2px;position:relative;z-index:1'
        var remove = document.createElement('button')
        remove.textContent = '✕'
        remove.title = '移除'
        remove.style.cssText = 'position:absolute;top:2px;right:2px;width:16px;height:16px;display:inline-flex;' +
          'align-items:center;justify-content:center;border:0;border-radius:50%;cursor:pointer;' +
          'background:rgba(0,0,0,.35);color:#fff;font-size:9px;line-height:1;padding:0'
        remove.addEventListener('click', function () { removeQueued(item) })
        chip.append(label, remove)
        bar.append(chip)
      })
      var rail = findRail()
      if (rail) {
        rail.appendChild(bar)
      } else {
        var card = findCard(ta)
        if (!card) return
        var scroll = ta.parentElement.parentElement
        card.insertBefore(bar, scroll)
      }
    }
    /**
     * Keep the composer sendable when only file attachments are queued:
     * invisible placeholder in the draft while fileQueue is non-empty and
     * the draft has no visible text and no draft images; remove it when the
     * queue empties. DSH's send button requires a non-empty draft or images.
     */
    function syncPlaceholder() {
      var ctx = activeCtx
      var input = currentInput(ctx)
      if (input === undefined) return
      var state = input.state.getSnapshot()
      var draft = state.draft
      var hasImages = state.imageIds.length > 0
      if (fileQueue.length > 0 && draft.trim() === '' && !hasImages) {
        if (draft !== PLACEHOLDER) input.setDraft(PLACEHOLDER)
      } else if (fileQueue.length === 0 && draft === PLACEHOLDER) {
        input.setDraft('')
      }
    }
    function addQueued(item) { fileQueue.push(item); renderChips(); syncPlaceholder() }
    function removeQueued(item) {
      fileQueue = fileQueue.filter(function (q) { return q !== item })
      renderChips()
      syncPlaceholder()
    }
    function clearFiles() { fileQueue = []; renderChips(); syncPlaceholder() }

    var chipsTimer = null
    function ensureChipsObserver(ta) {
      var card = findCard(ta)
      if (!card) return
      var observer = new MutationObserver(function () {
        if (fileQueue.length > 0 && document.querySelector('[' + CHIPS_ATTR + ']') === null) {
          clearTimeout(chipsTimer)
          chipsTimer = setTimeout(renderChips, 60)
        }
      })
      observer.observe(card, { childList: true, subtree: true })
      return observer
    }

    // --- attachment-mode handlers (REFERENCE original paths — never copies) ---

    /**
     * Locate the real path of every dropped/pasted file (images included)
     * and folder, then queue it as a chip. When a file cannot be located on
     * disk (e.g. a freshly pasted clipboard screenshot), it is SAVED into
     * the workspace attachment dir as a fallback so the attachment still
     * has a real path. Images keep a thumbnail preview on their chip (local
     * blob), but on send EVERY attachment is delivered as its real path (a
     * text-only model reads it with dsh-vision-toolkit; no image attachment
     * ever hits the wire, so the "model does not support images" preflight
     * cannot fire).
     */
    function locateAndQueue(ctx, files, dirs, toast) {
      var found = []
      var saved = []
      var failures = []
      var chain = Promise.resolve()
      files.forEach(function (item) {
        var file = item.file
        chain = chain.then(function () { return locateDroppedFileTimed(file, ctx.workspaces, currentWorkspacePath(ctx), 3500) }).then(function (result) {
          if (result.status === 'found') {
            found.push({ path: result.path, name: file.name, previewUrl: item.previewUrl })
          } else if (result.status === 'choose') {
            return choosePath(file.name, result.candidates).then(function (selected) {
              if (selected !== undefined) found.push({ path: selected, name: file.name, previewUrl: item.previewUrl })
              else failures.push(file.name)
            })
          } else if (result.status === 'error') {
            failures.push(file.name + '（' + result.message + '）')
          } else {
            // not-found: no locatable disk path — save a copy into the
            // workspace attachment dir as the fallback.
            return saveFileToWorkspace(file).then(function (path) {
              saved.push({ path: path, name: file.name, previewUrl: item.previewUrl })
            }).catch(function (saveError) {
              failures.push(file.name + '（无法定位且无法保存: ' + (saveError && saveError.message ? saveError.message : String(saveError)) + '）')
            })
          }
        }).catch(function (error) {
          failures.push(file.name + '（' + (error && error.message ? error.message : String(error)) + '）')
        })
      })
      dirs.forEach(function (dir) {
        chain = chain.then(function () { return locateDroppedDirectory(dir, ctx.workspaces, currentWorkspacePath(ctx)) }).then(function (result) {
          if (result.status === 'found') found.push({ path: result.path, name: dir.name, isDir: true })
          else if (result.status === 'choose') {
            return choosePath(dir.name, result.candidates).then(function (selected) {
              if (selected !== undefined) found.push({ path: selected, name: dir.name, isDir: true })
              else failures.push('文件夹「' + dir.name + '」未选择路径')
            })
          } else if (result.status === 'error') failures.push('文件夹「' + dir.name + '」：' + result.message)
          else failures.push('文件夹「' + dir.name + '」未能定位原始路径（请将文件夹放入工作区或常用目录）')
        }).catch(function (error) {
          failures.push('文件夹「' + dir.name + '」：' + (error && error.message ? error.message : String(error)))
        })
      })
      chain.then(function () {
        found.forEach(function (item) { addQueued(item) })
        saved.forEach(function (item) { addQueued(item) })
        // Saving is a successful outcome the user can see from the chip
        // itself — keep it quiet; only real failures get a toast.
        if (failures.length > 0) {
          toast.showError('附件处理失败：' + failures.join('、'))
        }
      })
    }

    /** Locate with a hard timeout: never block a drop/paste on a slow disk
     *  search — a timeout counts as "not found" and falls through to the
     *  workspace save. */
    function locateDroppedFileTimed(file, workspaces, cwd, timeoutMs) {
      return new Promise(function (resolve) {
        var settled = false
        var timer = setTimeout(function () {
          if (!settled) { settled = true; resolve({ status: 'not-found' }) }
        }, timeoutMs)
        locateDroppedFile(file, workspaces, cwd).then(function (result) {
          if (!settled) { settled = true; clearTimeout(timer); resolve(result) }
        }).catch(function (error) {
          if (!settled) { settled = true; clearTimeout(timer); resolve({ status: 'error', message: error && error.message ? error.message : String(error) }) }
        })
      })
    }

    function handleAttachmentDrop(ctx, dataTransfer, toast) {
      // Fast path: when the browser DID expose the real paths (file://
      // URIs — some file managers / OSes), use them directly — no search,
      // no waiting.
      var direct = pathsFromDrop(dataTransfer)
      if (direct.length > 0) {
        direct.forEach(function (path) {
          var parts = String(path).split(/[\\/]/)
          addQueued({ path: path, name: parts[parts.length - 1] || path })
        })
        return
      }
      collectDrop(dataTransfer).then(function (dropped) {
        // Images and other files share ONE chip channel (real-path reference
        // with a local thumbnail preview) — no native imageIds, so no
        // duplicate display and no "model does not support images" error.
        var files = dropped.files.slice()
        dropped.images.forEach(function (file) {
          var previewUrl = null
          try { previewUrl = URL.createObjectURL(file) } catch (error) { /* best-effort */ }
          files.push({ file: file, relPath: undefined, previewUrl: previewUrl })
        })
        locateAndQueue(ctx, files, dropped.dirs, toast)
      }).catch(function (error) {
        console.error('[drag-to-attachment] drop parse failed:', error)
        toast.showError('无法读取拖入内容: ' + (error && error.message ? error.message : String(error)))
      })
    }

    /** Attachment-mode paste: supports files AND folders (webkitGetAsEntry). */
    function handleAttachmentPaste(ctx, clipboardData, toast) {
      var images = []
      var files = []
      var dirs = []
      var items = Array.prototype.slice.call(clipboardData && clipboardData.items ? clipboardData.items : [])
      var promises = items.map(function (item) {
        if (item.kind !== 'file') return Promise.resolve()
        var entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
        if (entry && entry.isDirectory) { dirs.push({ entry: entry, name: entry.name }); return Promise.resolve() }
        if (entry && entry.isFile) {
          return entryFile(entry).then(function (file) {
            if (isImageFile(file)) images.push(file)
            else files.push({ file: file, relPath: undefined })
          })
        }
        var raw = typeof item.getAsFile === 'function' ? item.getAsFile() : null
        if (raw) {
          if (isImageFile(raw)) images.push(raw)
          else files.push({ file: raw, relPath: undefined })
        }
        return Promise.resolve()
      })
      Promise.all(promises).then(function () {
        images.forEach(function (file) {
          var previewUrl = null
          try { previewUrl = URL.createObjectURL(file) } catch (error) { /* best-effort */ }
          files.push({ file: file, relPath: undefined, previewUrl: previewUrl })
        })
        locateAndQueue(ctx, files, dirs, toast)
      }).catch(function (error) {
        console.error('[drag-to-attachment] paste parse failed:', error)
        toast.showError('无法读取粘贴内容: ' + (error && error.message ? error.message : String(error)))
      })
    }

    // --- send-time: EVERY attachment is delivered as its ORIGINAL path ---
    // Message body format (agent-friendly, UI-rendered as attachment cards):
    //   [附件]name|C:\abs\path      (files and images)
    //   [附件·目录]name|C:\abs\folder
    // followed by the user's own text. The custom user-message renderer turns
    // these lines into thumbnail/file cards and hides the raw paths; the
    // agent still receives the real paths ("底层是真实路径").
    function patchSendSession(conversation, sessions, workspaces) {
      var proto = conversation.constructor && conversation.constructor.prototype
      if (!proto || typeof proto.sendSession !== 'function' || proto[PATCH_MARK]) return
      proto[PATCH_MARK] = true
      var original = proto.sendSession
      proto.sendSession = async function (session, text, imageIds, mode) {
        var queued = fileQueue.slice()
        var hasImages = !!imageIds && imageIds.length > 0
        var attachItems = queued.slice()
        // Native draft images (e.g. added via DSH's own attach button) are
        // located to their real paths too, so every send stays text-only —
        // no image attachment ever reaches the wire and the "model does not
        // support images" preflight cannot fire.
        if (hasImages && workspaces !== undefined) {
          var attachments = typeof this.draftImages === 'function' ? this.draftImages(imageIds) : []
          if (attachments.length === imageIds.length) {
            var cwd = sessionCwd(sessions)
            for (var i = 0; i < attachments.length; i++) {
              var file = attachments[i] && attachments[i].file
              if (!file) continue
              try {
                var result = await locateDroppedFile(file, workspaces, cwd)
                if (result.status === 'found') attachItems.push({ path: result.path, name: file.name })
                else if (result.status === 'choose') {
                  var selected = await choosePath(file.name, result.candidates)
                  if (selected !== undefined) attachItems.push({ path: selected, name: file.name })
                } else {
                  toast.showError('图片未能定位原始路径（附件仅引用、不复制文件）：' + file.name)
                }
              } catch (error) {
                console.error('[drag-to-attachment] image locate failed:', error)
                toast.showError('图片定位失败: ' + (error && error.message ? error.message : String(error)))
              }
            }
          }
        }
        // Plain text with no attachments: behave exactly like the product.
        if (attachItems.length === 0) return original.call(this, session, text, imageIds, mode)
        // Strip dsh-vision-toolkit's pasted-image placeholder out of the
        // user text — our own [附件] lines already carry the same path, so
        // the message would otherwise show the image twice.
        var cleanedText = String(text || '')
          .replace(/\u200C/g, '')
          .replace(/\[Pasted image available at absolute path: "[^"]*"\]/g, '')
          .split('\n').filter(function (l) { return l.trim() !== '' }).join('\n')
        var lines = attachItems.map(function (item) {
          var tag = item.isDir ? '[附件·目录]' : '[附件]'
          return tag + item.name + '|' + item.path
        })
        var body = cleanedText.trim().length > 0 ? lines.join('\n') + '\n' + cleanedText : lines.join('\n')
        var result = await session.prompt([{ type: 'text', text: body }], mode)
        if (!result.ok) throw new Error('conversation.send failed: ' + result.error.code + ': ' + result.error.message)
        if (hasImages && typeof this.releaseDraftImages === 'function') this.releaseDraftImages(attachments)
        clearFiles()
      }
    }

    /** Current session's workspace cwd from the sessions service. */
    function sessionCwd(sessions) {
      try {
        var state = sessions.list.getSnapshot()
        var id = state.current
        return id === undefined ? undefined : (state.byId[id] && state.byId[id].cwd)
      } catch (error) { /* best-effort */ }
      return undefined
    }

    // =========================================================================
    // Mode toggle (composer tool row)
    // =========================================================================

    function registerModeToggle(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined || React === null) return function () { /* no-op */ }
      return slots.inject('conversation.input.left', function* () {
        yield slots.register(
          { name: 'conversation.input.left', id: 'dsh-drag-to-attachment-toggle', order: 10 },
          function ModeToggle() {
            var state = React.useState(currentMode)
            var mode = state[0]
            var setModeState = state[1]
            var toggle = function (event) {
              if (event && event.stopPropagation) event.stopPropagation()
              var next = mode === 'attachment' ? 'path' : 'attachment'
              setMode(next)
              setModeState(next)
            }
            var isAttachment = mode === 'attachment'
            return React.createElement('button', {
              type: 'button',
              onClick: toggle,
              title: isAttachment
                ? '拖拽/粘贴 → 附件（点击切换为路径模式）'
                : '拖拽/粘贴 → 真实路径（点击切换为附件模式）',
              style: {
                display: 'inline-flex', alignItems: 'center', gap: '4px', height: '24px', padding: '0 8px',
                border: '1px solid ' + (isAttachment ? 'rgba(92,108,213,.55)' : 'rgba(180,83,9,.55)'),
                borderRadius: '6px', background: isAttachment ? 'rgba(92,108,213,.12)' : 'rgba(180,83,9,.10)',
                color: 'var(--dsw-alias-fg-primary, #334155)', cursor: 'pointer',
                font: '12px/1 -apple-system, BlinkMacSystemFont, sans-serif', letterSpacing: '0',
              },
            }, isAttachment ? '📎 附件' : '📄 路径')
          }
        )
      })
    }

    // =========================================================================
    // Custom user-message renderer: turns "[附件]name|path" lines into
    // thumbnail/file cards and hides the raw paths — the agent still
    // receives the real paths ("底层是真实路径"). Falls back to an
    // approximate native user bubble when no attachment markup is present.
    // =========================================================================

    function isImagePath(path) {
      return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(path || ''))
    }

    /** Parse the message body into { attachments, text } or null. */
    function parseAttachmentMarkup(text) {
      var lines = String(text || '').split('\n')
      var attachments = []
      var rest = []
      var found = false
      lines.forEach(function (line) {
        // Our own attachment lines: [附件]name|path / [附件·目录]name|path
        var m = /^\[附件·目录\]\s*(.+?)\|(.+)$/.exec(line) || /^\[附件\]\s*(.+?)\|(.+)$/.exec(line)
        if (m) {
          found = true
          attachments.push({
            name: m[1].trim(),
            path: m[2].trim(),
            isDir: line.indexOf('[附件·目录]') === 0,
          })
          return
        }
        // dsh-vision-toolkit's pasted-image placeholder:
        //   [Pasted image available at absolute path: "C:\...\image.png"]
        // Renders it as a real thumbnail card too (path under the hood).
        var vt = /^\[Pasted image available at absolute path: "([^"]+)"\]\s*$/.exec(line)
        if (vt) {
          found = true
          var vp = vt[1].trim()
          var parts = vp.split(/[\\/]/)
          attachments.push({ name: parts[parts.length - 1] || vp, path: vp, isDir: false })
          return
        }
        rest.push(line)
      })
      if (!found) return null
      return { attachments: attachments, text: rest.join('\n').trim() }
    }

    function renderAttachmentCard(item, key) {
      var size = 44
      var kind = item.isDir ? { icon: '📁', color: '#8a5a00' } : fileKind(item.name)
      var thumb
      if (!item.isDir && isImagePath(item.path)) {
        thumb = React.createElement('img', {
          key: 'thumb' + key,
          src: FILE_ROUTE + '?path=' + encodeURIComponent(item.path),
          alt: item.name,
          onClick: function () { try { window.open(FILE_ROUTE + '?path=' + encodeURIComponent(item.path), '_blank') } catch (error) { /* best-effort */ } },
          style: { width: size, height: size, objectFit: 'cover', borderRadius: '6px', flex: '0 0 auto', cursor: 'pointer', display: 'block', background: 'rgba(92,108,213,.10)' },
        })
      } else {
        thumb = React.createElement('span', {
          key: 'thumb' + key,
          style: { width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', borderRadius: '6px', background: 'rgba(92,108,213,.10)', flex: '0 0 auto' },
        }, kind.icon)
      }
      return React.createElement('div', {
        key: key,
        title: item.path,
        style: { display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', margin: '2px 4px 2px 0', borderRadius: '10px', border: '1px solid rgba(92,108,213,.35)', background: 'rgba(92,108,213,.08)', maxWidth: '280px' },
      },
        thumb,
        React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' } }, item.name),
      )
    }

    function UserMessageView(props) {
      try {
        var node = props && props.node
        var data = node && node.data
        var content = data && data.content ? data.content : []
        var texts = []
        var nativeImages = 0
        content.forEach(function (block) {
          if (block && block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
          if (block && block.type === 'image') nativeImages += 1
        })
        var text = texts.join('')
        var parsed = parseAttachmentMarkup(text)
        if (parsed !== null && parsed.attachments.length > 0) {
          // Debug aid while diagnosing the card renderer.
          try { console.log('[dta] render cards:', parsed.attachments.map(function (a) { return a.name })) } catch (error) { /* noop */ }
        }
        // Bubble style follows the theme like the native user bubble
        // (--dsw-specific-bubble), so attached and plain messages match.
        var bubble = {
          display: 'inline-block', maxWidth: '72%', padding: '10px 16px', borderRadius: '22px',
          background: 'var(--dsw-specific-bubble)',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: '16px', lineHeight: '24px',
          wordBreak: 'break-word',
        }
        var row = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', margin: '6px 0' }
        if (parsed === null) {
          // No attachment markup: approximate the native user bubble.
          return React.createElement('div', { style: row },
            React.createElement('div', { style: bubble },
              nativeImages > 0 ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: text.trim() ? '6px' : 0 } },
                Array.from({ length: nativeImages }).map(function (_, i) {
                  return React.createElement('img', { key: i, src: '#', alt: 'image', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '6px', background: 'rgba(0,0,0,.08)' } })
                })
              ) : null,
              text.trim() ? React.createElement('div', null, text.trim()) : null,
            ),
          )
        }
        // Deduplicate by path (the same image may arrive both as our [附件]
        // line and as dsh-vision-toolkit's pasted-image placeholder).
        var seen = {}
        var unique = []
        parsed.attachments.forEach(function (item) {
          var key = item.path
          if (!seen[key]) { seen[key] = true; unique.push(item) }
        })
        var cards = unique.map(function (item, i) { return renderAttachmentCard(item, i) })
        return React.createElement('div', { style: row },
          React.createElement('div', { style: bubble },
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap' } }, cards),
            parsed.text ? React.createElement('div', { style: { marginTop: '4px' } }, parsed.text) : null,
          ),
        )
      } catch (error) {
        // Never crash the chat view: log and fall back to a plain text bubble.
        try { console.error('[dta] user render failed:', error) } catch (err) { /* noop */ }
        var raw = props && props.node && props.node.data && props.node.data.content
          ? props.node.data.content.filter(function (b) { return b && b.type === 'text' }).map(function (b) { return b.text }).join('')
          : ''
        return React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', margin: '6px 0' } },
          React.createElement('div', { style: { display: 'inline-block', maxWidth: '72%', padding: '10px 16px', borderRadius: '22px', background: 'var(--dsw-specific-bubble)', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word' } }, raw)
        )
      }
    }

    function registerUserMessageView(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined || React === null) return function () { /* no-op */ }
      return slots.inject('conversation.chat.node', function* () {
        yield slots.register(
          // Shadow the shipped 'user' renderer: keyed slots resolve the
          // LOWEST priority occupant, so a negative priority wins.
          { name: 'conversation.chat.node', key: 'user', priority: -100 },
          UserMessageView
        )
      })
    }

    // =========================================================================
    // apply
    // =========================================================================

    function apply(ctx) {
      var dragDepth = 0
      var overlay = createOverlay()
      toast = createFileDropToast()
      activeCtx = ctx

      function overlayLabel() {
        return currentMode === 'attachment' ? '松开鼠标以添加附件' : '松开鼠标以插入文件路径'
      }
      overlay.setLabel(overlayLabel())

      // Make the DSH attachment rail lay out horizontally (attachment mode).
      try {
        var styleId = 'dsh-drag-to-attachment-style'
        if (!document.getElementById(styleId)) {
          var style = document.createElement('style')
          style.id = styleId
          style.textContent = '[class*="_attachments"]{display:flex;flex-wrap:wrap;align-items:center;gap:8px}'
          document.head.append(style)
        }
      } catch (error) { /* best-effort */ }

      var conversation = ctx.get('conversation')
      var sessions = ctx.get('sessions')
      var workspaces = ctx.get('workspaces')
      if (conversation !== undefined && sessions !== undefined) {
        patchSendSession(conversation, sessions, workspaces)
      }
      var ta = findComposer()
      if (ta) ensureChipsObserver(ta)

      var onDragEnter = function (event) {
        if (!hasFilePayload(event)) return
        dragDepth += 1
        overlay.setLabel(overlayLabel())
        overlay.setActive(true)
      }
      var onDragOver = function (event) {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
        overlay.setLabel(overlayLabel())
        overlay.setActive(true)
      }
      var onDragLeave = function (event) {
        if (!hasFilePayload(event)) return
        dragDepth = Math.max(0, dragDepth - 1)
        if (dragDepth === 0) overlay.setActive(false)
      }
      var onDrop = function (event) {
        if (!hasFilePayload(event)) return
        event.preventDefault()
        event.stopPropagation()
        dragDepth = 0
        overlay.setActive(false)
        if (event.dataTransfer === null) return
        if (currentMode === 'attachment') handleAttachmentDrop(ctx, event.dataTransfer, toast)
        else handlePathDrop(ctx, event.dataTransfer, toast)
        // DSH closes its full-screen drop overlay on `dragend` (window
        // listener, unconditional). Dispatch one so it never stays stuck.
        setTimeout(function () {
          try { window.dispatchEvent(new DragEvent('dragend')) } catch (error) { /* best-effort */ }
        }, 0)
      }
      var onPaste = function (event) {
        var cd = event.clipboardData
        var files = Array.prototype.slice.call(cd ? cd.files : [])
        var items = Array.prototype.slice.call(cd ? cd.items : [])
        var hasFilePayload = files.length > 0 || items.some(function (item) { return item.kind === 'file' })
        if (!hasFilePayload) return
        event.preventDefault()
        event.stopPropagation()
        if (currentMode === 'attachment') handleAttachmentPaste(ctx, cd, toast)
        else handlePathPaste(ctx, cd, toast)
      }

      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('dragleave', onDragLeave)
      document.addEventListener('drop', onDrop, true)
      // Capture paste at WINDOW level (earlier than document): dsh-vision-toolkit
      // also listens on document capture and would otherwise claim the paste
      // and show its own plain-name chip instead of our thumbnail cards.
      window.addEventListener('paste', onPaste, true)

      var disposeToggle = registerModeToggle(ctx)
      var disposeUserView = registerUserMessageView(ctx)

      ctx.effect(function () {
        return function () {
          window.removeEventListener('dragenter', onDragEnter)
          window.removeEventListener('dragover', onDragOver)
          window.removeEventListener('dragleave', onDragLeave)
          document.removeEventListener('drop', onDrop, true)
          window.removeEventListener('paste', onPaste, true)
          if (typeof disposeToggle === 'function') disposeToggle()
          if (typeof disposeUserView === 'function') disposeUserView()
          overlay.dispose()
          toast.dispose()
          activeCtx = null
        }
      }, 'drag-to-attachment: global drag/paste listeners')
    }

    exports.inject = ['conversation', 'sessions', 'workspaces', 'slots']
    exports.apply = apply
    return module.exports
  },
})
