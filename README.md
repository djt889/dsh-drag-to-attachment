# dsh-drag-to-attachment

> A dsh-plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/dsh) web UI: drag or paste **any local file or folder** anywhere on the page and turn it into a composer **attachment** (images → native thumbnails; every other file and whole folders → chips in the attachment rail) or, with one toggle, locate its **real filesystem path** and insert it into the draft. Works with text-only models via dsh-vision-toolkit.

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## Why

- DSH's native attachment channel only accepts **images**, and sending them to a text-only model (e.g. deepseek) is rejected by the host image preflight (`attachment-error: Model does not support image input`). PDFs, Office docs, videos, etc. cannot be attachments at all.
- This plugin keeps the native attachment UX (thumbnails / chips) but on send converts every attachment into a **workspace file path** delivered as plain text — the agent can read the files with dsh-vision-toolkit / document tools, and the image preflight is bypassed because no image block reaches the wire.
- Path mode just inserts the real paths (nothing is copied or uploaded), ported from [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop).

## Two modes (one toggle)

Composer tool-row button: `📎 附件` / `📄 路径` — choice persists in localStorage (`dsh.dragToAttachment.mode`).

| | Attachment mode (default) | Path mode |
|---|---|---|
| Drop anywhere / paste files | ✅ | ✅ |
| Images | native thumbnail cards | real path inserted |
| Any other file (no extension whitelist) | uploaded to workspace `.drops/`, chip in rail | real path inserted |
| Folders | recursive upload as 📁 chip | folder path inserted |
| Send | attachments converted to plain-text paths + your text | your text (paths already in draft) |
| Files copied/moved? | copied into `.drops/` on send | never |
| Send without typing | ✅ (invisible draft filler enables the button) | n/a |

## Install

```sh
dsh plugin --profile web add github:djt889/dsh-drag-to-attachment
# or a local checkout:
dsh plugin --profile web add /path/to/dsh-drag-to-attachment
```

Restart your web profile (`dsh web`) and hard-refresh the browser. No settings page.

## Usage

1. Pick the mode in the composer tool row (`📎` default).
2. Drag files/folders from your file manager anywhere on the page — a full-page dim + hint appears — or just Ctrl+V files.
3. Attachment mode: images get native thumbnails; files/folders become removable chips. Press send — attachments are uploaded to `<workspace>/.drops/` and their paths are appended to your message as plain text (type nothing? the send button is still enabled).
4. Path mode: located real paths are inserted into the draft line by line (a picker appears when several same-named candidates exist).
5. The agent reads the files with dsh-vision-toolkit / document tools.

Files land in `<workspace>/.drops/` — clean it up occasionally.

## Structure

```
dsh-drag-to-attachment/
├─ package.json        bundle declaration (dsh.bundle.patch / dsh.client)
├─ cordis.patch.yml    mount row (insert drag-to-attachment)
├─ lib/
│  ├─ index.js         host: POST /_dsh/drag-to-attachment/import (upload) + /locate (path locator)
│  └─ client.js        browser: global drag/paste + dual-mode dispatch + rail chips + send conversion + toggle
├─ LICENSE             BSD-3-Clause
└─ README.md / README.zh.md
```

## Limits

- Single file ≤ **100 MB** (host-enforced).
- Folder upload ≤ **300 files**, depth ≤ 32; per-file failures never abort the rest.
- Attachment-mode send requires a non-empty draft or queued attachments — satisfied automatically by the invisible filler.

## Compatibility

Tested on the current DeepSeek Harness (web profile, bundle model). It relies on a few **unpublished internal interfaces** (`conversation` service, `sendSession`/`draftImages`/`createDraftImages`, the `_attachments` rail class, `webServer` routes, the workspace registry) and may need adapting after DSH upgrades.

## License

BSD-3-Clause — portions ported from [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop) (BSD-3-Clause) and [loudMore/dsh-drop-to-path](https://github.com/loudMore/dsh-drop-to-path) (MIT). See [LICENSE](LICENSE).
