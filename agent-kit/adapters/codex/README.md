# Codex 适配器

这是 Codex 的本地桥适配层。把 `LIVEDOT_AGENT_KIT` 指向本目录所在的
`agent-kit`，然后启用 `codex.json`；它注册一个 required 的本地 MCP
进程，并在 `SessionStart`、`UserPromptSubmit`、`Stop` 调用同一个 hook
客户端。hook 失败时只输出补救指令，不会调用 ack，也不会把失败显示成成功。

兼容已有「读取 agent-kit/setup.md 并接入」的一句口令：安装器只增加配置，
不会覆盖项目现有 AGENTS.md 或直接编辑 map.json。

