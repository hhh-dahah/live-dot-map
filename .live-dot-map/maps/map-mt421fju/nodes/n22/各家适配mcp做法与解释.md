# 各家适配 MCP 做法与解释

> 本文解释「活点地图如何让不同 AI Agent 接入」的设计：为什么工具通用、按家写的只有配置登记。

## 一、先分清三层

1. **MCP 工具层（100% 通用）**：`livedot.mjs mcp` 提供的地图工具（读上下文、读写节点/标记、检索）对**所有** Agent 完全一样，一份定义、一套实现。「活点地图是什么长什么样」与接入方无关。
2. **知识包层（hooks / skills / 说明）**：agent-kit 里的 SKILL.md、hooks、工具说明，都是共享一份 `lib/` 实现；适配器只负责把同一份知识映射到各家的目录（例如 codex skills 在 `~/.codex/skills/`、claude 在 `~/.claude/skills/`）。
3. **配置登记层（唯一必须按家写的）**：把「这台电脑上有个 livedot-map MCP 服务器」登记到各家 AI 的配置入口。**这是各家产品的规定**，不是我们的设计选择——各家读的配置文件路径与格式由它们的实现决定。

## 二、为什么不能「写一份大家都能读」

MCP 是统一协议（像 USB-C），但各家的配置入口是私有的（像各自的快充协议）：

| Agent | 全局配置入口 | 格式 |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | JSON `mcpServers` |
| Codex | `~/.codex/config.toml` | TOML `[mcp_servers."x"]` |
| Kimi Code | `~/.kimi-code/mcp.json` | JSON `mcpServers` |
| CodeBuddy | `~/.codebuddy/*` | 插件 JSON |
| Antigravity(AGY) | `~/.gemini/config/mcp_config.json`（或项目 `.agents/mcp_config.json`） | JSON `mcpServers` |
| AGY CLI / gemini CLI | `~/.gemini/settings.json` | JSON `mcp_servers` |

同一个 `~/.gemini` 名下 AGY 与 gemini CLI 用的是**两个不同文件**，安装器按各自约定写入。

## 三、我们怎么做（适配器注册表）

- `agent-kit/lib/installer.mjs` 维护一个注册表：`检测命令 → 配置写入器 → 清理器`。
- 新增一家 = 注册表加一项（探测 + 写入 + 清理，约 20–50 行/家）+ 一行 actor 标记同步。**MCP 服务本体零改动**。
- 用户安装活点地图时：安装器探测所有已装的 AI 工具 → 自动写入各家配置 → 用户打开对应 AI 直接可用，**零手动配置**（无感）；卸载/「医生」修复时按各家约定清理（含 AGY 的 MCP 缓存目录，否则僵尸服务器残留）。

## 四、为什么不是「每家一套 MCP」

因为那样工具行为会漂移——每家工具规则、检索逻辑、写入契约都不同的话，人和 Agent 的记录就不一致了。工具是唯一事实源（一份），接入方只是「观众」；差异只在「让观众入场时坐哪个位置（配置文件）」。
