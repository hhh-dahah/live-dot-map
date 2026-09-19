# ZCode 适配器

本目录提供智谱 AI ZCode（基于 GLM 模型的桌面智能体与代码编辑器客户端）的活点地图 MCP 适配器与标准配置参考。

## 配置与生效机制

根据 ZCode 官方规范与宿主实测探测：
1. **全局用户配置**：`<zcode-home>/cli/config.json`（即 `~/.zcode/cli/config.json`）。
2. **MCP 配置节点**：ZCode 采用嵌套在 `mcp.servers` 下的配置结构（包含 `enabled: true`、`command`、`args` 与 `type: "stdio"`）。
3. **Agent Skill**：`<zcode-home>/skills/live-dot-map/SKILL.md`（即 `~/.zcode/skills/live-dot-map/SKILL.md`）。

安装器会自动探测系统中的 ZCode 安装（包括全局 `~/.zcode` 目录、`%APPDATA%/ZCode`、`%LOCALAPPDATA%/@zcodedesktop-updater` 以及可执行文件 `ZCode.exe`），在检测到时安全深合并配置与 Skill，并在卸载时完整回滚恢复。

## 稳定调用与安全保障

- **深合并保全既有服务**：严格保留用户在 `config.json` 中配置的其它 MCP 服务器（如 `playwright`、`github`、`arxiv`）及 `skills` 规则，绝不覆盖或删除第三方服务。
- **独立隔离**：适配 ZCode 时严格隔离，绝不触碰或重写 Codex、Claude、Antigravity、Kimi 等其他正常运转的 Agent 配置。
- **自愈式运行时绑定**：自动绑定当前宿主机可用的 node 物理绝对路径与 livedot.mjs 脚本路径，避免 GUI 启动无环境变量导致调用失败。
- **只写适配，不改协议**：严格遵循活点地图标准 24/25 项 MCP 工具定义与 STDIO JSON-RPC 通信规范。
