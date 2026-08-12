# CodeBuddy / WorkBuddy 适配器

本目录提供腾讯系 Agent 的本地插件、MCP 和生命周期 Hook 参考包。CodeBuddy Code 的 Hook 事件与 Claude Code 兼容，支持 `SessionStart`、`UserPromptSubmit` 和 `Stop`；WorkBuddy 可通过插件面板添加 MCP/Hook 插件。

安装器会探测 PATH 中的 `codebuddy`、`codebuddy-code`、`workbuddy`，以及 Windows WorkBuddy 安装注册信息里的内嵌 CodeBuddy CLI；没有真实发现时不会给普通用户增加未安装的平台入口。首次使用必须在产品插件面板审核并启用 hooks，不能静默绕过信任。

WorkBuddy 内嵌的 CodeBuddy Code 2.106.4 已完成真实 CLI 的 MCP 读取、摘要引用、ack 和节点写回验收；这只证明 CodeBuddy CLI 适配层可用，不等于 WorkBuddy 桌面端的 Hook 自动注入已经通过。WorkBuddy 桌面端仍必须完成真实的新会话注入、摘要引用与 ack、Agent 写回、Stop 闭环和重启恢复；在此之前 UI 和官网只能显示“候选/基础 MCP”。

官方参考：

- [WorkBuddy 插件系统](https://www.codebuddy.cn/docs/workbuddy/Plugins)
- [CodeBuddy Code Hooks](https://www.codebuddy.cn/docs/cli/hooks)
- [CodeBuddy 插件参考](https://www.codebuddy.cn/docs/cli/plugins-reference)
