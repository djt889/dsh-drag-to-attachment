# dsh-drag-to-attachment

> A dsh-plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web UI: drag or paste **any local file or folder** anywhere on the page and turn it into a composer **attachment that references its real filesystem path** (nothing is uploaded or copied) or, with one toggle, insert the real path directly into the draft. Works with text-only models via dsh-vision-toolkit.

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## Why

- DSH's native attachment channel only accepts **images**, and sending them to a text-only model (e.g. deepseek) is rejected by the host image preflight (`attachment-error: Model does not support image input`). PDFs, Office docs, videos, etc. cannot be attachments at all.
- This plugin bypasses that preflight: an attachment only **references** the original file path (no copies, no `.drops/` uploads), and on send the path reaches the model as plain text — the agent reads the files with dsh-vision-toolkit / document tools, and no image block ever hits the wire.
- Path mode just inserts the real paths, ported from [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop).

## Two modes (one toggle)

Composer tool-row button: `📎 附件` / `📄 路径` — choice persists in localStorage (`dsh.dragToAttachment.mode`).

| | Attachment mode (default) | Path mode |
|---|---|---|
| Drop anywhere / paste files (incl. folders) | ✅ | ✅ |
| Images | chip referencing the real path | real path inserted |
| Any other file (no extension whitelist) | chip referencing the real path | real path inserted |
| Folders | 📁 chip referencing the folder path | folder path inserted |
| Send | original paths appended as plain text + your text | paths already in draft |
| Files copied/uploaded? | **never** (no `.drops/` copies) | never |
| Send without typing | ✅ (invisible draft filler enables the button) | n/a |

> In attachment mode each file must be **locatable to its real path** (current workspace first, then registered workspaces, Desktop/Documents/Downloads, OS index, bounded recursive search). When locating fails (e.g. an unsaved clipboard screenshot) a visible toast explains — nothing is silently dropped.

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
3. Attachment mode: located items appear as removable chips in the attachment rail (hover shows the **full path**). Press send without typing — the original paths are appended to your message as plain text.
4. Path mode: located real paths are inserted into the draft line by line (a picker appears when several same-named candidates exist).
5. The agent reads the files with dsh-vision-toolkit / document tools.

Files are **never** copied or uploaded to `.drops/` — the path IS the original file location.

## Structure

```
dsh-drag-to-attachment/
├─ package.json        bundle declaration (dsh.bundle.patch / dsh.client)
├─ cordis.patch.yml    mount row (insert drag-to-attachment)
├─ lib/
│  ├─ index.js         host: POST /_dsh/drag-to-attachment/locate (path locator)
│  │                        (/import upload route kept only for legacy compat; client no longer calls it)
│  └─ client.js        browser: global drag/paste + dual-mode dispatch + rail chips + send appends original paths + toggle
├─ LICENSE             BSD-3-Clause
└─ README.md / README.zh.md
```

## Path locating

Multi-phase protocol (ported from bill9109/dsh-drag-and-drop):

1. Current workspace → other registered workspaces → Desktop/Documents/Downloads shallow probe;
2. OS index (Windows: Everything CLI → PowerShell; macOS: Spotlight; Linux: plocate/locate);
3. Bounded recursive search (≤20,000 entries per root, depth ≤12);
4. Multiple same-named candidates → filter by name+size → sample fingerprint (head/middle/tail 64KB) → full SHA-256 if needed → a path picker when still ambiguous.

## Compatibility

Tested on the current DeepSeek Harness (web profile, bundle model). It relies on a few **unpublished internal interfaces** (`conversation` service, `sendSession`/`draftImages`, the `_attachments` rail class, `webServer` routes, the workspace registry) and may need adapting after DSH upgrades.

## License

BSD-3-Clause — portions ported from [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop) (BSD-3-Clause) and [loudMore/dsh-drop-to-path](https://github.com/loudMore/dsh-drop-to-path) (MIT). See [LICENSE](LICENSE).
