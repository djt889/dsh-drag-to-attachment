# dsh-drag-to-attachment

> A dsh-plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web UI: drag or paste **any local file or folder** anywhere on the page — **images** keep the native thumbnail attachment experience and send as thumbnails; **every other file and whole folders** are located to their **real filesystem path** and referenced as chips (nothing is uploaded or copied), with the real path appended on send. One toggle also inserts the real paths directly into the draft.

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## Why

- Browsers never hand the real filesystem path of a dropped/pasted file to a web page — but DSH operates on real files and its tools read real local paths. This plugin closes that gap: it **locates** the dropped file back to its true location and references it as an attachment (**no copies, no `.drops/` uploads**).
- **Images** keep the native DSH attachment experience (thumbnail card, preview, remove) and **send as thumbnails** — no conversion.
- **Other files / folders**: DSH cannot attach non-images natively, so they appear as chips in the attachment rail (hover shows the real path) and their real paths are appended as plain text on send — the agent reads them with dsh-vision-toolkit (`vision_glance` / `vision_pixel_diff` / long-screenshot OCR) or document tools.

## Two modes (one toggle)

Composer tool-row button: `📎 附件` / `📄 路径` — choice persists in localStorage (`dsh.dragToAttachment.mode`).

| | Attachment mode (default) | Path mode |
|---|---|---|
| Drop anywhere / paste (incl. folders) | ✅ | ✅ |
| Images | chip with **thumbnail preview** referencing the real path | real path inserted |
| Any other file (no extension whitelist) | chip referencing the **real path** (hover shows it) | real path inserted |
| Folders | 📁 chip referencing the folder path | folder path inserted |
| Send | message shows **attachment cards** (image thumbnail / file icon + name, **no raw path text**); the agent still receives the real paths underneath | paths already in draft |
| Files copied/uploaded? | **never** (no `.drops/` copies) | never |
| Send without typing | ✅ (invisible draft filler enables the button) | n/a |

> Note: every attachment must be **locatable to its real path** (current workspace first, then registered workspaces, Desktop/Documents/Downloads, OS index, bounded recursive search); a visible toast explains when locating fails — nothing is silently dropped. Thumbnails in sent messages are rendered by a local read-only proxy and **cost zero model tokens** — only the real-path text ever reaches the model.

## Install

```sh
dsh plugin --profile web add github:djt889/dsh-drag-to-attachment
# or a local checkout:
dsh plugin --profile web add /path/to/dsh-drag-to-attachment
```

Restart your web profile (`dsh web`) and hard-refresh the browser. No settings page.

## Usage

1. Pick the mode in the composer tool row (`📎` default).
2. Drag files/folders from your file manager anywhere on the page — a full-page dim + hint appears — or just Ctrl+V files (pasting folders works too).
3. Attachment mode:
   - Dropped items appear **instantly** as chips (images show their thumbnail right away).
   - Pending chips show a **real-time ring progress** (fast-index → full-disk, percentage climbs live).
   - **Images** → rail chips with a **thumbnail preview** (✕ remove, hover shows the **full real path**).
   - **Other files / folders** → removable chips (hover shows the **full real path**).
   - After send, the message shows **attachment cards** (thumbnail / file icon + name) — no raw path text; the agent receives the real paths underneath and reads them with dsh-vision-toolkit / document tools.
   - Press send without typing — the send button activates once every queued path is resolved.
4. Path mode: each dropped/pasted entry shows a **real-time ring progress chip** (parallel, per-entry percentage), and located real paths are inserted into the draft line by line (a picker appears when several same-named candidates exist).
5. The agent reads the files with dsh-vision-toolkit / document tools.

Files are **never** copied or uploaded to `.drops/` — the attachment references the original file location.

## Structure

```
dsh-drag-to-attachment/
├─ package.json        bundle declaration (dsh.bundle.patch / dsh.client)
├─ cordis.patch.yml    mount row (insert drag-to-attachment)
├─ lib/
│  ├─ index.js         host: /locate (progressive tiers) · /save (fallback) · /file (thumbnail proxy)
│  └─ client.js        browser: global drag/paste + dual modes + live progress bars + attachment cards + send
├─ vendor/everything/  bundled Everything for Windows (voidtools freeware, zero install)
├─ LICENSE             BSD-3-Clause
└─ README.md / README.zh.md
```

## Path locating (real-time, progressive)

Progress is shown immediately after drop/paste; the search runs in two tiers,
each completing before the next starts:

1. **Fast tier (tier-fast, ms)**: shallow probes (workspace / Desktop / Documents / Downloads) → OS index;
2. **Full tier (tier-full)**: bounded recursive search (≤100,000 entries per root, depth ≤24) + broad mounts;
3. Multiple same-named candidates → filter by name+size → sample fingerprint (head/middle/tail 64KB) → full SHA-256 if needed → a path picker when still ambiguous.

**Per-platform index — zero install on all three:**

| Platform | Index | Notes |
|---|---|---|
| Windows | **Bundled Everything** (`vendor/everything/`, auto-started by the host, queried via es.exe) | millisecond |
| macOS | Spotlight (`mdfind`, built-in) | millisecond |
| Linux | **Bundled Everything-style index** (Node: background scan of home + /mnt + /media, in-memory name index) | millisecond after first build |

> Unlocatable files are saved into `<workspace>/.dsh-drag-to-attachment/pasted-images/` as a fallback; freshly pasted screenshots (no disk file) are saved directly.

## Compatibility

Tested on the current DeepSeek Harness (web profile, bundle model). It relies on a few **unpublished internal interfaces** (`conversation` service, `sendSession`/`draftImages`/`createDraftImages`, the `_attachments` rail class, `webServer` routes, the workspace registry) and may need adapting after DSH upgrades.

## License

BSD-3-Clause — the path-locating code is ported from [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop) (BSD-3-Clause). See [LICENSE](LICENSE).
