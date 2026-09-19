# AGENTS.md — 活点地图（Live Dot Map）· 工位协作守则

> 本文件由主工位统一维护，四个工位保持同一份。进入工位后：先按「工位对号入座」确认身份，再遵守「四条铁律」。

## 记忆与上下文获取协议
1. **MCP 协议通信（标准模式）**：任何 Agent 进入本项目，应优先通过 `livedot-map` MCP 工具（如 `map_get_context`、`map_list_human_updates`、`map_read_markdown` 等）获取实时全局记忆与节点事实。
2. **缺失配置与降级保底**：若当前环境未配置 `livedot-map` MCP 工具，应主动提示用户配置。若环境确实受限或用户暂不配置，仅允许将本地 `.live-dot-map/` 目录作为最终保底手段进行【只读（Read-Only）】查阅，严禁私自写入或篡改底层数据文件。

## 工位对号入座（按当前目录 / 分支自动匹配）
- **主工位** `D:\桌面\活点地图\live-dot-map\ui设计 html`（分支 `master`）：你是唯一的集成与发布点。负责：一切合并（必先过 `node scripts/merge-guard.mjs <分支>`）、发布流水线（installer / dist / release）、跨领域大改动直改 master、多任务拆解派发与收活、修卡住其他工位的问题。维护 `scripts/`、`docs/`、`tests/e2e/`。其他工位的任何改动不经此处不得进入 master。
- **UI 工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-ui`（分支 `ui-exp-minimal-zen`）：你负责画布交互、视觉、禅意全屏与响应式体验。默认只改 `app.html`、`src/web/**`、`assets/`、`icons/`、`landing/`、`tests/web/**`。
- **后端工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-backend`（分支 `feat-backend-memory`）：你负责记忆存储引擎、核心协议校验、数据结构与持久化。默认只改 `src/bridge/**`、`src/shared/**`、`tests/bridge/**`、`tests/core/**`。
- **适配器工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-adapter`（分支 `feat-agent-adapter`）：你负责多 Agent 适配、MCP 协议桥接、外部工具集成，以及全项目的可靠性与稳定性问题（崩溃、数据丢失、健壮性）。默认只改 `agent-kit/**`、`src/cli/**`、`tests/agent-kit/**`。

## 四条铁律（每个工位必须遵守）
1. **开工第 0 步（自动执行，无需用户参与）**：确认本工位无未提交改动后，执行 `git reset --hard master` 把工位分支对齐到最新 master，再开始新任务。
2. **提交纪律**：干活过程小步提交防丢；用户验收说"可以了"后**立即完成收尾 commit** 并回报「已提交，待合并」，严禁把未提交状态留给用户。跨界改动（动了默认路径以外的文件）允许，但提交信息必须含「跨界: <路径>」，便于主工位合并时重点审查。
3. **严禁自行合并与同步**：本工位不得执行 `git merge` / `git rebase` 同步 master（第 1 条的 reset 除外），不得把任何东西合入 master。一切合并只在主工位进行，且必须先通过 `node scripts/merge-guard.mjs <分支>`（它做：前置检查、碰撞清单、单元测试）。当前任务被别处问题卡住时：WIP 提交后报告用户，由主工位修复并指挥对齐。
4. **`app.html` 是构建产物**：由 `npm run build:app` 从 `src/web/` 生成。它出现合并冲突时严禁手工裁决——正确做法是合并源码后重新构建覆盖。

## 测试约定
- 工位内功能验证一律用 `npm run dev`：自动起隔离测试实例（独立端口与状态目录），不影响用户常驻浏览器与常驻桥。
- 单元测试 `npm test`；发布级全量验证 `npm run verify`（主工位 / 发布时使用）。
