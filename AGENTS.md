# AGENTS.md — 活点地图（Live Dot Map）

> 本项目的所有业务状态、阶段目标、设计决策、工位协作与上下文记忆，**已全面由「活点地图」动态接管与维护**。

## 记忆与上下文获取协议
1. **MCP 协议通信**：任何 Agent 进入本项目，必须通过 `livedot-map` MCP 工具（如 `map_get_context`、`map_list_human_updates`、`map_read_markdown` 等）获取实时全局记忆与节点事实。
2. **缺失配置提醒**：若当前环境未配置或未启用 `livedot-map` MCP 工具，**严禁绕过协议私自读写底层数据文件**，必须主动提示用户配置并启用活点地图 MCP 服务。
