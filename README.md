# Live Dot Map / 活点地图

让人和 Agent 在同一张地图上探索未知。

A shared exploration space for humans and agents.

![活点地图画布](landing/public/media/landing-hero.png)

**[⬇ Download (Windows)](https://github.com/hhh-dahah/live-dot-map/releases/download/v2.0.0/LiveDotMapSetup.exe)** · **[Demo](https://livedotmap.top)** · **[Documentation](agent-kit/setup.md)**

## Why?

Chat is linear. Exploration is not.

对话是线性的，但探索不是。一个未知问题很少只有一条路，活点地图把每次尝试、每个判断留在一张图上，而不是埋进聊天记录：

```text
未知问题
├── 方案 A → 失败
├── 方案 B → 待验证
└── 方案 C
    ├── C1 → 失败
    └── C2 → 成功
```

失败的路线不会被删掉，它们是下一次判断的依据；Agent 和人读的是同一张图。

## 产品 Demo

在线体验落地页与画布：<https://livedotmap.top>（落地页「打开画布」可直接进入）。

![项目记忆可视化](landing/public/media/feature-1.png)

## 核心特性

- **项目记忆可视化** — 把项目的目标、尝试和结论画在一张地图上，不用翻聊天记录就能看清进展。
- **仿生记忆架构** — 图结构加人工策展的海马体仿生架构，只保留最重要的项目上下文，冗余信息不会进入模型。
- **联合判断** — 需要当前任务上下文和另一任务记忆时，点击切换地图，Agent 自动读取，轻松实现联合判断。
- **精确寻址** — 开启全新对话时，Agent 可以按节点寻址，迅速回忆当时的判断和细节。
- **人机协同** — 人在地图上的任何标注，Agent 都能立刻看到；它的进展也会实时写回同一张地图，支持双向操作。

## 安装方式

**普通用户（Windows）**：下载 **[LiveDotMapSetup.exe](https://github.com/hhh-dahah/live-dot-map/releases/download/v2.0.0/LiveDotMapSetup.exe)**（或到 [Releases](../../releases) 选择最新版本），安装后双击桌面图标直达画布，选择一个项目文件夹即可开始。在画布里对 Agent 说一句 `/地图自检` 可完成接入与健康检查。

**开发者**：

```powershell
npm ci
npm run verify
```

`verify` 会依次运行核心测试、三浏览器强模式、降级模式、性能、三适配器模拟闭环、安装器降级入口和部署产物检查。

## 文件结构 / Agent 如何读取

项目 = 一个文件夹，地图 = 一个任务的记忆。所有数据留在项目目录，人和 Agent 读写同一份文件：

```text
项目目录/
└── .live-dot-map/
    ├── maps/<id>/map.json   # 每张地图的结构（一项目多地图）
    ├── nodes/ routes/       # 节点与路线的 Markdown 详情
    └── active-map           # 当前地图指针
```

- Agent 通过本地桥（可靠保存、WAL 恢复、冲突检测、SSE 实时同步、确定性图检索与 MCP 工具）读写地图。
- 内置 Codex、Claude Code、Kimi Code 适配器（[`agent-kit/`](agent-kit/)），接入协议见 [`agent-kit/setup.md`](agent-kit/setup.md)。
- 数据不出本机，不上传项目内容。

仓库结构：

- `app.html` — 正式画布（单一事实源）；`canvas.html` 是冻结的验收样板。
- `src/bridge/` — 本地桥（Node）：存储、同步、MCP。
- `agent-kit/` — 各 Agent CLI 的项目适配器与接入文档。
- `landing/` — 落地页源码（Next.js 静态导出）。
- `installer/` — Windows 安装器（WinForms）。
- `docs/` — PRD、实测记录、执行计划与交接摘要。

## 当前状态

Alpha：Windows 版可下载使用，核心链路（画布、本地桥、多地图、人机协同）已可用，正在做各 Agent 平台的真实生命周期验收。界面与协议可能随迭代调整。

## Roadmap

- 各 Agent 平台（Claude Code、Kimi Code、WorkBuddy 等）全生命周期验收
- 安装与首用体验持续打磨
- 更细的路线图见 [Issues](../../issues)，欢迎直接提需求

## License

[Apache-2.0](LICENSE)。界面文案与文档使用简体中文。
