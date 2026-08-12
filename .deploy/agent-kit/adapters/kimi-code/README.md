# Kimi Code 适配器

Kimi 的 hook 采用 fail-open：本地桥或 hook 失败时允许 Kimi 继续工作，
但输出会明确保留「未确认读取」状态，绝不调用 ack 或显示绿色成功。把
`sessionStart.skill`、`hooks.json` 与 `mcp.json` 注册到项目插件即可。

