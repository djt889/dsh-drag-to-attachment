# dsh-drag-to-attachment

> 一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) Web UI 的 **dsh-plugin**：把本地**任意文件或文件夹**拖入（或粘贴进）页面任意位置——一个开关，两种模式：**附件模式**把**图片、文件、文件夹**识别为**真实路径**并以附件方块引用（图片方块带缩略图预览；**不复制、不上传**），发送时把真实路径随消息送达模型；**路径模式**直接把真实路径插入输入框草稿。

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-%E2%9C%93-5B4CF0?style=flat-square)](https://github.com/topics/dsh-plugin)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-blue.svg)](LICENSE)

[中文](README.md) | [English](README.en.md)

## 为什么做这个

- 浏览器从不把拖入/粘贴文件的**真实磁盘路径**交给网页——DSH 操作的是真实文件，它的工具要读取本机实际路径。本插件补齐这个缺口：把拖入的文件**定位回真实位置**，以附件形式引用（**不复制、不产生 `.drops/` 副本**）。
- **图片**以带**缩略图预览**的附件方块呈现（本地 blob 预览，点击 ✕ 移除，hover 显示真实路径），发送时与所有附件一样**以真实路径送达**——**不走原生图片附件通道**（纯文本模型不会被"当前模型不支持图片"拦截）。
- **其他文件/文件夹**：DSH 原生不支持非图片附件，插件把它们显示为附件栏方块（hover 显示真实路径），发送时真实路径以纯文本随消息送达——agent 搭配视觉插件（如 dsh-vision-toolkit）或文档工具读取。**视觉输入搭配视觉插件使用**。

## 两种模式（一个开关）

输入框工具行左侧按钮：`📎 附件` / `📄 路径`——选择保存在浏览器 localStorage（`dsh.dragToAttachment.mode`），刷新后保留。

| 能力 | 附件模式（默认） | 路径模式 |
|---|---|---|
| 任意位置拖入 / 粘贴 | ✅ | ✅ |
| 图片 | 附件方块（**缩略图预览** + 引用真实路径） | 插入真实路径 |
| 任意文件（不限扩展名） | 附件方块（**引用真实路径**，hover 显示） | 插入真实路径 |
| 文件夹 | 附件方块 📁（引用文件夹路径） | 插入文件夹路径 |
| 发送 | 消息里显示**附件卡片**（图片缩略图 / 文件图标 + 文件名，**不显示路径文本**）；**底层 agent 收到的是真实路径** | 路径已在草稿中，直接发送 |
| 是否复制/上传文件 | **从不**（不产生 `.drops/` 副本） | 从不 |
| 不输入文字直接发送 | ✅（不可见占位符自动激活发送按钮） | — |

> 说明：所有附件必须能被定位到**真实路径**（工作区优先，再已注册工作区、桌面/文档/下载、系统索引、受控递归搜索）；定位失败（如未保存的新截图）会弹出可见提示，不会静默丢弃。消息里的缩略图由本地只读代理渲染，**不占用模型 token**——发给模型的只有真实路径文本，图片内容不会进入消息。

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
   - 拖入/粘贴 → 附件方块**立即出现**（图片即时显示缩略图）；
   - 定位中的方块右上角有**实时圆环进度**（快速索引 → 全盘搜索，百分比实时增长）；
   - **图片** → 附件栏方块（**缩略图预览**，✕ 移除，hover 显示完整真实路径）；
   - **其他文件/文件夹** → 附件栏方块（✕ 移除，**hover 显示完整真实路径**）；
   - 发送后：消息里显示**附件卡片**（图片缩略图 / 文件图标 + 文件名），不显示路径文本；agent 底层收到真实路径（搭配视觉插件读取）；
   - 不输入任何文字也可以直接发送（**所有附件路径就绪后**发送按钮才激活）；
4. 路径模式：拖入/粘贴时每个文件显示**实时圆环进度 chip**（多个文件并行、各自独立进度与百分比），命中后路径逐行插入草稿（多个同名候选时弹出选择列表）；
5. agent 搭配视觉插件 / 文档工具读取路径对应的文件。

**附件去重**：同名且同路径的附件会比对 **MD5**——内容一致则提示"附件已上传"且不重复添加；同名但路径不同视为不同文件，直接添加（不比对）。粘贴的截图按内容寻址保存（相同截图只会产生一份 `.drops/` 文件），重复粘贴直接提示已上传。

文件**不会被**复制或上传到工作区 `.drops/`——附件引用的就是原始文件位置。

## 文件结构

```
dsh-drag-to-attachment/
├─ package.json        bundle 声明（dsh.bundle.patch / dsh.client）
├─ cordis.patch.yml    挂载行（insert drag-to-attachment）
├─ lib/
│  ├─ index.js         host：/locate（分阶段定位）· /save（fallback 保存）· /md5（去重）· /file（缩略图代理）
│  └─ client.js        browser：全局拖拽/粘贴 + 双模式 + 实时圆环进度 + 附件卡片 + 发送
├─ vendor/everything/  内置 Everything（Windows 免安装全盘索引，voidtools freeware）
├─ LICENSE             BSD-3-Clause
└─ README.md（中文）/ README.en.md（English）
```

## 路径定位（实时分阶段）

拖入/粘贴后立即显示进度，搜索按两阶段进行（**每阶段完成才进入下一阶段**）：

1. **快速索引（tier-fast，毫秒级）**：工作区/常用目录浅探 → 操作系统索引；
2. **全盘搜索（tier-full）**：有边界的递归搜索（每根 ≤100,000 项、深度 ≤24）+ 全盘索引；
3. 多个同名候选 → 按文件名+大小过滤 → 采样指纹（开头/中间/结尾 64KB）→ 必要时完整 SHA-256 → 仍相同则弹路径选择列表。

**各平台索引（开箱即用，无需安装）**：

| 平台 | 索引方案 | 说明 |
|---|---|---|
| Windows | **内置 Everything**（`vendor/everything/`，host 自动启动，es.exe 查询） | 毫秒级 |
| macOS | Spotlight（`mdfind`，系统自带） | 毫秒级 |
| Linux | **内置 Everything 式索引**（Node 实现：后台扫描 home+/mnt+/media，内存文件名索引） | 毫秒级（首次索引后台建立） |

> **粘贴的截图直接复制**到工作区 `.drops/`（不索引，秒级）；**索引不到的**文件也自动保存到 `.drops/`（fallback）。`.drops/` 可随时清理。

## 兼容性

| DSH 版本 | 状态 |
|---|---|
| 当前环境（deepseek-harness 0.1.0-rc 系列，web profile bundle 模型） | ✅ 可用 |

本插件依赖 DSH 若干**未公开的内部接口**（`conversation` 服务、`sendSession`/`draftImages`/`createDraftImages` 签名、附件栏类名 `_attachments`、`webServer` 路由、workspace 注册表格式）。DSH 升级后可能失效，症状多为：插件不加载、方块位置错乱、图片附件异常。

## 许可证

BSD-3-Clause——路径定位代码移植自 [bill9109/dsh-drag-and-drop](https://github.com/bill9109/dsh-drag-and-drop)（BSD-3-Clause）；内置 Everything 为 [voidtools](https://www.voidtools.com) 免费软件（freeware）。详见 [LICENSE](LICENSE)。
