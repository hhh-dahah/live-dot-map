# Claude Code 适配器

`claude.json` 可作为项目插件/settings 的来源，`.mcp.json` 是本地 MCP
配置。SessionStart 的 stdout 直接进入 Claude 上下文；本适配器不把 hook
执行当作 ack，必须由 Agent 在摘要引用标注 ID 后调用
`map_ack_human_updates`。Stop 失败保留未确认状态并给出补救指令。

