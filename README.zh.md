# dsh-drag-to-attachment

> 一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web UI 的 **dsh-plugin**：把本地**任意文件或文件夹**拖入（或粘贴进）页面任意位置——一个开关，两种模式：**附件模式**把**图片、文件、文件夹**识别为**真实路径**并以附件方块引用（图片方块带缩略图预览；**不复制、不上传**），发送时把真实路径随消息送达模型；**路径模式**直接把真实路径插入输入框草稿。

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## 为什么做这个

- 浏览器从不把拖入/粘贴文件的**真实磁盘路径**交给网页——DSH 操作的是真实文件，它的工具要读取本机实际路径。本插件补齐这个缺口：把拖入的文件**定位回真实位置**，以附件形式引用（**不复制、不产生 `.drops/` 副本**）。
- **图片**以带**缩略图预览**的附件方块呈现（本地 blob 预览，点击 ✕ 移除，hover 显示真实路径），发送时与所有附件一样**以真实路径送达**——**不走原生图片附件通道**（纯文本模型不会被"当前模型不支持图片"拦截）。
- **其他文件/文件夹**：DSH 原生不支持非图片附件，插件把它们显示为附件栏方块（hover 显示真实路径），发送时真实路径以纯文本随消息送达——agent 用 dsh-vision-toolkit（`vision_glance`/`vision_pixel_diff`/长截图 OCR 等）或文档工具读取。**视觉输入需配合 dsh-vision-toolkit 使用**。

## 两种模式（一个开关）

输入框工具行左侧按钮：`📎 附件` / `📄 路径`——选择保存在浏览器 localStorage（`dsh.dragToAttachment.mode`），刷新后保留。

| 能力 | 附件模式（默认） | 路径模式 |
|---|---|---|
| 任意位置拖入 / 粘贴 | ✅ | ✅ |
| 图片 | 附件方块（**缩略图预览** + 引用真实路径） | 插入真实路径 |
| 任意文件（不限扩展名） | 附件方块（**引用真实路径**，hover 显示） | 插入真实路径 |
| 文件夹 | 附件方块 📁（引用文件夹路径） | 插入文件夹路径 |
| 发送 | 所有附件附加真实路径文本（**不走原生图片通道，不会报"模型不支持图片"**） | 路径已在草稿中，直接发送 |
| 是否复制/上传文件 | **从不**（不产生 `.drops/` 副本） | 从不 |
| 不输入文字直接发送 | ✅（不可见占位符自动激活发送按钮） | — |

> 说明：所有附件必须能被定位到**真实路径**（工作区优先，再已注册工作区、桌面/文档/下载、系统索引、受控递归搜索）；定位失败（如未保存的新截图）会弹出可见提示，不会静默丢弃。

## 安装

```sh
dsh plugin --profile web add github:djt889/dsh-drag-to-attachment
# 或本地 checkout：
dsh plugin --profile web add /path/to/dsh-drag-to-attachment
```

安装后**重启 Web profile**（重启 `dsh web`）并硬刷新浏览器生效。无设置页，一切通过工具行开关控制。

## 使用

1. 输入框工具行确认模式（`📎 附件` 默认 / `📄 路径`）；
2. 从文件管理器拖入文件或文件夹到页面任意位置（全页面压暗 + 提示出现），或直接 Ctrl+V 粘贴（粘贴文件夹也支持）；
3. 附件模式：
   - **图片** → 原生缩略图卡片（可预览/✕ 移除），发送时以缩略图形式进入会话；
   - **其他文件/文件夹** → 附件栏方块（✕ 移除，**hover 显示完整真实路径**），发送时真实路径自动附加进消息；
   - 不输入任何文字也可以直接发送；
4. 路径模式：命中的真实路径逐行插入草稿（多个同名候选时弹出选择列表），直接发送；
5. agent 配合 dsh-vision-toolkit / 文档工具读取路径对应的文件。

文件**不会被**复制或上传到工作区 `.drops/`——附件引用的就是原始文件位置。

## 文件结构

```
dsh-drag-to-attachment/
├─ package.json        bundle 声明（dsh.bundle.patch / dsh.client）
├─ cordis.patch.yml    挂载行（insert drag-to-attachment）
├─ lib/
│  ├─ index.js         host：POST /_dsh/drag-to-attachment/locate（路径定位，仅此一个路由）
│  └─ client.js        browser：全局拖拽/粘贴 + 双模式分发 + 图片原生缩略图 + 文件/文件夹方块 + 发送 + 模式开关
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

本插件依赖 DSH 若干**未公开的内部接口**（`conversation` 服务、`sendSession`/`draftImages`/`createDraftImages` 签名、附件栏类名 `_attachments`、`webServer` 路由、workspace 注册表格式）。DSH 升级后可能失效，症状多为：插件不加载、方块位置错乱、图片附件异常。

## 许可证

BSD-3-Clause——路径定位代码移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)（BSD-3-Clause）。详见 [LICENSE](LICENSE)。
