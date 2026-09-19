# AGENTS.md — 活点地图（Live Dot Map）

> 本项目的所有业务状态、阶段目标、设计决策、工位协作与上下文记忆，**已全面由「活点地图」动态接管与维护**。

## 记忆与上下文获取协议
1. **MCP 协议通信（标准模式）**：任何 Agent 进入本项目，应优先通过 `livedot-map` MCP 工具（如 `map_get_context`、`map_list_human_updates`、`map_read_markdown` 等）获取实时全局记忆与节点事实。
2. **缺失配置与降级保底**：若当前环境未配置 `livedot-map` MCP 工具，应主动提示用户配置。若环境确实受限或用户暂不配置，**仅允许将本地 `.live-dot-map/` 目录作为最终保底手段进行【只读（Read-Only）】查阅，严禁私自写入或篡改底层数据文件**。

## 4大核心工位总览（路径与职责）
1. **主工位** `D:\桌面\活点地图\live-dot-map\ui设计 html`（分支 `master`）：物理 `.git` 根目录与唯一记忆事实源 (`.live-dot-map`)，负责稳定基线发布与宿主画布。
2. **UI 工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-ui`（分支 `ui-exp-minimal-zen`）：负责前端画布交互、视觉、禅意全屏与响应式体验。
3. **后端工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-backend`（分支 `feat-backend-memory`）：负责记忆存储引擎、核心协议校验、数据结构与持久化。
4. **适配器工位** `D:\桌面\活点地图\live-dot-map\live-dot-map-adapter`（分支 `feat-agent-adapter`）：负责多 Agent 适配、MCP 协议桥接与外部工具集成。

## 当前工位职责
- **当前工位目录**：`ui设计 html`（分支 `master`）
- **核心职责**：主工作树与稳定基线所在地，代码变更须保持高质量与可发布状态。

