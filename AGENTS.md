# AGENTS.md — 活点地图（Live Dot Map）

> **全局记忆原则**：本项目的所有业务状态、阶段目标、设计决策、走查问题与上下文记忆，**已全面由「活点地图」动态接管与维护**。
> 根目录下的历史文档（如 `goal.md`、`implement.md`、旧 PRD 等）仅作为早期归档遗迹，**不再作为当前任务的决策依据**。

## 记忆与上下文获取协议
1. **MCP 优先**：任何 Agent 进入本项目，优先调用 `livedot-map` MCP 工具（如 `map_get_context`、`map_list_human_updates`、`map_read_markdown` 等）获取实时全局记忆与节点事实。
2. **文件直读**：若未配置 MCP，直接读取本地 `.live-dot-map/` 目录中的地图事实 (`map.json`) 与节点资料包 (`nodes/`)。

## 多工位（Git Worktree）协作准则
本项目采用多工位物理隔离并行开发，各工位职责明确：
- **`ui设计 html/`**：主控工位（`master` 分支），专门负责全局汇总合并、构建打包、部署发布（`landing/`、`.deploy/`）与线上运维。
- **`live-dot-map-ui/`**：前端设计工位（`ui-exp-minimal-zen` 分支），专门负责 `app.html` 界面交互、视觉设计与自动化走查测试。
- **`live-dot-map-backend/`**：后端架构工位（`feat-backend-memory` 分支），专门负责记忆演化算法、节点生命周期与核心数据协议。
- **`live-dot-map-adapter/`**：适配与连接工位（`feat-agent-adapter` 分支），专门负责与 Antigravity、Claude Code、Cursor 等各家 Agent 的 MCP 通信、共享记忆与稳定性测试。

## 项目硬性边界
- 界面文案、代码注释和文档统一使用简体中文。
- `canvas.html` 是早期冻结的原型样板；所有正式产品功能的迭代演化均在 `app.html` 中进行。
- 颜色令牌严格使用 `:root` 的 OKLch 变量，绿、红、灰仅用于表达方案状态。
- 数据读写与协议设计严格遵守 Map JSON v2 规范。
