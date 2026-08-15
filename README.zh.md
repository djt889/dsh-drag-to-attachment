# dsh-drag-to-attachment

> 一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web UI 的 **dsh-plugin**：把本地**任意文件或文件夹**拖入（或粘贴进）页面任意位置——一个开关，两种模式：**附件模式**把文件以**原始路径**引用为输入框附件（附件栏方块，**不复制、不上传**），发送时把真实路径随消息送达模型；**路径模式**直接把真实路径插入输入框草稿。配合 dsh-vision-toolkit 等工具，纯文本模型也能"看图"、读文档。

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## 为什么做这个

- DSH 的附件机制只支持**图片**，且发送时会走宿主图片准入预检：纯文本模型（如 deepseek）会收到 `attachment-error: Model does not support image input` 而被拒绝；PDF、Office、视频等根本不允许作为附件。
- 本插件在**附件模式下绕开该预检**：附件只**引用**原始文件路径（不复制、不产生 `.drops/` 副本），发送时路径以纯文本随消息送达——agent 拿到路径后用 dsh-vision-toolkit（`vision_glance`/`vision_pixel_diff`/长截图 OCR 等）或文档工具读取。**视觉输入需配合 dsh-vision-toolkit 使用**（图片以原始路径送达后由它读取）。
- 路径模式则直接把真实路径插入草稿，移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)。

## 两种模式（一个开关）

输入框工具行左侧按钮：`📎 附件` / `📄 路径`——选择保存在浏览器 localStorage（`dsh.dragToAttachment.mode`），刷新后保留。

| 能力 | 附件模式（默认） | 路径模式 |
|---|---|---|
| 任意位置拖入 / 粘贴文件 | ✅ | ✅ |
| 图片 | 附件方块（定位原始路径） | 插入真实路径 |
| 任意文件（不限扩展名） | 附件方块（定位原始路径） | 插入真实路径 |
| 文件夹 | 附件方块 📁（定位文件夹路径） | 插入文件夹路径 |
| 发送 | 原始路径自动附加进消息（纯文本）+ 你的文字 | 路径已在草稿中，直接发送 |
| 是否复制/上传文件 | **从不**（不产生 `.drops/` 副本） | 从不 |
| 不输入文字直接发送 | ✅（不可见占位符自动激活发送按钮） | — |

> 附件模式下文件必须能被定位到**真实路径**（工作区优先，再已注册工作区、桌面/文档/下载、系统索引、受控递归搜索）。定位失败（如未保存的新截图）会弹出可见提示，不会静默丢弃。

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
3. 附件模式：定位成功的项目以方块标签出现在附件栏（✕ 移除，**hover 显示完整路径**）；**不输入任何文字也可以直接发送**——原始路径自动附加进消息；
4. 路径模式：命中的真实路径逐行插入草稿（多个同名候选时弹出选择列表），直接发送；
5. agent 配合 dsh-vision-toolkit / 文档工具读取路径对应的文件。

文件**不会**被复制或上传到工作区 `.drops/`——路径就是原始文件位置。

## 文件结构

```
dsh-drag-to-attachment/
├─ package.json        bundle 声明（dsh.bundle.patch / dsh.client）
├─ cordis.patch.yml    挂载行（insert drag-to-attachment）
├─ lib/
│  ├─ index.js         host：POST /_dsh/drag-to-attachment/locate（路径定位主路由）
│  │                        （/import 上传路由仅保留兼容旧版，client 已不再调用）
│  └─ client.js        browser：全局拖拽/粘贴 + 双模式分发 + 附件栏 + 发送附加原始路径 + 模式开关
├─ LICENSE             BSD-3-Clause
└─ README.md / README.zh.md
```

## 路径定位

多阶段协议（移植自 bill9109/dsh-drag-and-drop）：

1. 当前工作区 → 其他已注册工作区 → 桌面/文档/下载 三层浅探；
2. 操作系统索引（Windows：Everything CLI → PowerShell；macOS：Spotlight；Linux：plocate/locate）；
3. 有边界的递归搜索（每根 ≤20,000 项、深度 ≤12）；
4. 多个同名候选 → 按文件名+大小过滤 → 采样指纹（开头/中间/结尾 64KB）→ 必要时完整 SHA-256 → 仍相同则弹路径选择列表。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| 当前环境（deepseek-harness 0.1.0-rc 系列，web profile bundle 模型） | ✅ 可用 |

本插件依赖 DSH 若干**未公开的内部接口**（`conversation` 服务、`sendSession`/`draftImages` 签名、附件栏类名 `_attachments`、`webServer` 路由、workspace 注册表格式）。DSH 升级后可能失效，症状多为：插件不加载、发送仍报 `attachment-error`、方块位置错乱。

## 许可证

BSD-3-Clause——部分代码移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)（BSD-3-Clause）与 [loudMore/dsh-drop-to-path](https://github.com/loudMore/dsh-drop-to-path)（MIT）。详见 [LICENSE](LICENSE)。
