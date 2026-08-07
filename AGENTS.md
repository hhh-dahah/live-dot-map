# AGENTS.md — 活点地图 UI 原型

> 本文件面向 AI 编码 Agent，是路由式索引：细节读对应文档，不要把内容复制进本文件。

## 项目概述

这是「活点地图」的**原型 + 单文件正式版**目录。活点地图是面向人机协作的探索状态画布：用少量节点、路线、方案线和标注表达项目探索过程，详情存本地 Markdown，人和本地 Agent 读写同一组文件。本地优先、免费开源、轻量无限画布。`canvas.html` 是冻结的验收样板，`app.html` 是在其上演进的正式版（数据契约见 `docs/map-json-v1.md`）。

**当前阶段**：HTML 原型经 11 轮走查已定稿为验收样板（`canvas.html`，保持冻结）。阶段 2（基于 `D:/桌面/活点地图/excalidraw` fork 复刻画布）已完成并被否决——底层数据格式改为自研，fork 存档于 GitHub 私有仓库 `hhh-dahah/live-dot-map-canvas` 与本地 `wip-stage2` 分支，仅作交互参考。阶段 3 已完成：`app.html` 正式版（map.json 读写/文件夹直连/轮询同步）+ 协议层（`docs/map-json-v1.md`、`docs/agent-protocol.md`）+ 壁纸项目迁移狗粮（`E:/壁纸制作/map.json`），计划与日志见 `docs/plans/2026-08-06-阶段3-协议层与HTML正式化.md` 与 `implement.md`。阶段 4 已完成：记忆生命周期（路径 A）——schema 与协议升至 v1.1（`score`/`archived`/投影读取/整理例程/创新循环），研究与决策记录见 `docs/plans/2026-08-07-记忆系统演化路径研究.md`。

## 图片读取

- 本机 Codex 会话默认不直接接收图片内容；用户贴图或引用本地图片时，优先用 `see` 技能读取图片文件，不要直接回复“看不到”。
- 先确认图片路径存在，再运行技能入口脚本（Windows：`C:/Users/Thomas/.codex/skills/see/scripts/see.ps1 <图片路径>`），然后读取输出中 `output_path=<路径>` 指向的识别结果 Markdown。
- 只运行技能自带脚本，不自行调用模型 API；识别结果以脚本返回为准。
- **用户贴图工作流（ShareX 通道）**：用户在 opencode 粘贴的图片由 ShareX 自动保存，固定目录 `C:/Users/Thomas/Documents/ShareX/Screenshots/<YYYY-MM>/`；报错信息里出现的文件名（如 `Weixin_*.png`）即指向该目录。用户贴图后**直接按时间排序取该目录最新文件**，不要全盘搜索。

## 目录结构与技术栈

无构建系统、无包管理器、无依赖——全部是零依赖单文件静态 HTML（内联 CSS + 原生 JS），双击或任意静态服务器即可打开。无自动化测试，按 `index (2).html` 中的审核顺序在浏览器人工走查；视觉自验可用 Playwright 或 headless Chrome 截图到 `走查截图/`（已 gitignore），方法见 `implement.md`「走查工具链」。

```
├── index (2).html   # 原型导航页（注意文件名带空格和括号）
├── canvas.html      # 核心原型：无限画布（验收样板，已冻结）
├── app.html         # 正式版：自 canvas.html 演进，map.json 读写 + 项目文件夹直连（FS Access）+ 轮询同步
├── landing.html     # 产品落地页
├── goal.md          # 重大方案：阶段路线、最终形态、边界、完成标准
├── implement.md     # 执行与修改过程日志 + canvas.html 实现要点（改原型前先读）
├── 设计细节.md       # 走查问题记录：问题描述/涉及位置/正式版期望行为/状态
├── 产品需求文档-PRD.md   # PRD：产品定义、数据模型、状态与连接规则、开发优先级
├── UI设计需求文档.md     # 界面方向、逐条界面需求与文案要求
├── brand-spec.md    # 设计规范：色彩令牌（OKLch）、字体栈、布局姿态、文案基调
├── docs/map-json-v1.md   # map.json v1 schema（数据契约，读写以此为准）
├── docs/agent-protocol.md # Agent 协议段（贴入项目 AGENTS.md：会话开始铁律/同步/迁移四步）
├── docs/plans/      # 阶段计划（explore-plan 产出，含阶段 3 计划）
└── 参考ui/          # Excalidraw 界面截图（布局姿态参考，非视觉验收标准）
```

## 红线（必须遵守）

- 界面文案、代码注释、文档一律使用简体中文。
- 色彩一律用 `:root` 中的 OKLch CSS 变量，改令牌必须同步 `brand-spec.md`。
- 绿/红/灰只用于方案线与状态徽标；节点圆形、名称写圆内；方案名附着在线上。
- 保持单文件、零依赖、原生 JS：不引入构建工具、npm 依赖或 CSS 框架。
- 存档的 Excalidraw fork 仅作交互参考；如复制其代码片段，须遵守 MIT License 保留版权与许可声明（PRD §11.2）。
