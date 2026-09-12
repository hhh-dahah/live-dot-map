# Qoder 适配器

本目录提供通义灵码/Qoder 系列产品（包括 Qoder IDE 国内版 QoderCN、国际版 Qoder 与 Qoder CLI 终端命令行工具 qoderclicn/qodercli）的活点地图 MCP 适配器与标准配置参考。

## 配置与生效机制

根据 Qoder 官方规范：
1. **全局用户配置**：优先读取 <qoder-home>/mcp.json（国内版 ~/.qoder-cn/mcp.json，国际版 ~/.qoder/mcp.json）。
2. **桌面端共享缓存**：%APPDATA%/QoderCN/SharedClientCache/mcp.json 与 %APPDATA%/Qoder/SharedClientCache/mcp.json。
3. **工作区/项目级配置**：优先读取 <workspace>/.qoder/mcp.json，根目录 .mcp.json 作为兼容降级保底。
4. **Agent Skill**：<qoder-home>/skills/live-dot-map/SKILL.md。

安装器会自动探测系统中的 Qoder 安装（包括 PATH 命令与各应用目录），在检测到时自动写入配置与 Skill，并在卸载时完整回滚恢复。

## 稳定调用保障

- **自愈式运行时绑定**：自动绑定当前宿主机可用的 node 物理绝对路径与 livedot.mjs 脚本路径，避免 GUI 启动无环境变量导致调用失败。
- **跨平台兼容**：支持 Windows、macOS 与 Linux。
- **只写适配，不改协议**：严格遵循活点地图标准 25 项 MCP 工具定义与 STDIO JSON-RPC 通信规范。
