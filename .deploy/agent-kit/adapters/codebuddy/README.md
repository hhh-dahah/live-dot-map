# CodeBuddy / WorkBuddy 适配器（候选）

本目录提供腾讯系 Agent 的本地插件、MCP 和生命周期 Hook 参考包。CodeBuddy Code 的 Hook 事件与 Claude Code 兼容，支持 `SessionStart`、`UserPromptSubmit` 和 `Stop`；WorkBuddy 可通过插件面板添加 MCP/Hook 插件。

安装器只有在真实发现 `codebuddy`、`codebuddy-code` 或 `workbuddy` 可执行文件时才写入项目配置；否则不会给普通用户增加未安装的平台入口。首次使用必须在产品插件面板审核并启用 hooks，不能静默绕过信任。

这只是适配层，不等于平台正式支持。必须在真实客户端完成：新会话注入人类标注、摘要引用与 ack、Agent 写回、Stop 闭环、重启恢复；在此之前 UI 和官网只能显示“候选/基础 MCP”。

官方参考：

- [WorkBuddy 插件系统](https://www.codebuddy.cn/docs/workbuddy/Plugins)
- [CodeBuddy Code Hooks](https://www.codebuddy.cn/docs/cli/hooks)
- [CodeBuddy 插件参考](https://www.codebuddy.cn/docs/cli/plugins-reference)
