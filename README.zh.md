# dsh-drag-to-attachment

> 一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web UI 的 **dsh-plugin**：把本地**任意文件或文件夹**拖入（或粘贴进）页面任意位置——一个开关，两种模式：**附件模式**把文件变成输入框附件（图片原生缩略图、其他文件与整个文件夹为附件栏方块），发送时自动上传到工作区并以路径送达模型；**路径模式**直接定位文件的**真实磁盘路径**并插入输入框（不复制、不移动任何文件）。配合 dsh-vision-toolkit 等工具，纯文本模型也能"看图"、读文档。

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## 为什么做这个

- DSH 的附件机制只支持**图片**，且发送时会走宿主图片准入预检：纯文本模型（如 deepseek）会收到 `attachment-error: Model does not support image input` 而被拒绝；PDF、Office、视频等根本不允许作为附件。
- 本插件在**附件模式下绕开该预检**：附件 UI 完全保留（缩略图/方块），但发送瞬间把附件上传为工作区文件、消息转成路径文本——agent 拿到路径后用 dsh-vision-toolkit（`vision_glance`/`vision_pixel_diff`/长截图 OCR 等）或文档工具读取。**视觉输入需配合 dsh-vision-toolkit 使用**（图片以路径送达后由它读取）。
- 路径模式则完全引用原文件位置，移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)。

## 两种模式（一个开关）

输入框工具行左侧按钮：`📎 附件` / `📄 路径`——选择保存在浏览器 localStorage（`dsh.dragToAttachment.mode`），刷新后保留。

| 能力 | 附件模式（默认） | 路径模式 |
|---|---|---|
| 任意位置拖入 / 粘贴文件 | ✅ | ✅ |
| 图片 | 原生缩略图卡片 | 插入真实路径 |
| 任意文件（不限扩展名） | 上传到工作区 `.drops/`，附件栏方块标签 | 插入真实路径 |
| 文件夹 | 递归上传为 📁 文件夹方块 | 插入文件夹路径 |
| 发送 | 附件自动转纯文本路径 + 你的文字 | 路径已在草稿中，直接发送 |
| 文件是否被复制/移动 | 发送时复制进 `.drops/` | 从不 |
| 不输入文字直接发送 | ✅（不可见占位符自动激活发送按钮） | — |

## 安装

```sh
dsh plugin --profile web add github:djt889/dsh-drag-to-attachment
# 或本地 checkout：
dsh plugin --profile web add /path/to/dsh-drag-to-attachment
```

安装后**重启 Web profile**（重启 `dsh web`）并硬刷新浏览器生效。无设置页，一切通过工具行开关控制。

## 使用

1. 输入框工具行确认模式（`📎 附件` 默认 / `📄 路径`）；
2. 从文件管理器拖入文件或文件夹到页面任意位置（全页面压暗 + 提示出现），或直接 Ctrl+V 粘贴文件（粘贴文件夹也支持）；
3. 附件模式：图片出现缩略图，文件/文件夹出现方块标签（✕ 移除，hover 显示全名）；**不输入任何文字也可以直接发送**——附件上传到 `.drops/`，路径自动附加进消息；
4. 路径模式：命中的真实路径逐行插入草稿（多个同名候选时弹出选择列表），直接发送；
5. agent 配合 dsh-vision-toolkit / 文档工具读取路径对应的文件。

文件保存在 `<workspace>/.drops/`，可定期清理。

## 文件结构

```
dsh-drag-to-attachment/
├─ package.json        bundle 声明（dsh.bundle.patch / dsh.client）
├─ cordis.patch.yml    挂载行（insert drag-to-attachment）
├─ lib/
│  ├─ index.js         host：POST /_dsh/drag-to-attachment/import（上传）+ /locate（路径定位）
│  └─ client.js        browser：全局拖拽/粘贴 + 双模式分发 + 附件栏 + 发送转路径 + 模式开关
├─ LICENSE             BSD-3-Clause
└─ README.md / README.zh.md
```

## 限制

- 单文件 ≤ **100MB**（host 强制）。
- 文件夹单次上传 ≤ **300 个文件**、深度 ≤ 32；单个文件失败不会中断其余文件。
- 附件模式发送要求草稿非空或有附件——不可见占位符自动满足该条件。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| 当前环境（deepseek-harness 0.1.0-rc 系列，web profile bundle 模型） | ✅ 可用 |

本插件依赖 DSH 若干**未公开的内部接口**（`conversation` 服务、`sendSession`/`draftImages`/`createDraftImages` 签名、附件栏类名 `_attachments`、`webServer` 路由、workspace 注册表格式）。DSH 升级后可能失效，症状多为：插件不加载、发送仍报 `attachment-error`、方块位置错乱。

## 许可证

BSD-3-Clause——部分代码移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)（BSD-3-Clause）与 [loudMore/dsh-drop-to-path](https://github.com/loudMore/dsh-drop-to-path)（MIT）。详见 [LICENSE](LICENSE)。
