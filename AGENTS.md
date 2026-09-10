# AGENTS.md — 活点地图（Live Dot Map）

> 本项目的所有业务状态、阶段目标、设计决策、工位协作与上下文记忆，**已全面由「活点地图」动态接管与维护**。

## 记忆与上下文获取协议
1. **MCP 优先**：任何 Agent 进入本项目，优先调用 `livedot-map` MCP 工具（如 `map_get_context`、`map_list_human_updates`、`map_read_markdown` 等）获取实时全局记忆与节点事实。
2. **文件直读**：若未配置 MCP，直接读取本地 `.live-dot-map/` 目录中的地图事实 (`map.json`) 与节点资料包 (`nodes/`)。

