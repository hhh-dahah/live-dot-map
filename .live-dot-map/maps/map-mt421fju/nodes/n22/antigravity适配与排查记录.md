# Antigravity 适配与排查记录

> 本文件记录 n22「mcp和各家ai适配」的完整执行与排查细节；index.md 只保留概要。

## 2026-09-01：适配方案讨论（通用层已存在，加一行注册项）

**通用方案我们已经有了**：agent-kit 的「适配器注册表」（ADAPTER_PROBES + 各 Agent 配置文件写入器 + hooks/skills 分发）就是为「各家 AI 都能用、用户无感」设计的。现有适配器：codex（`~/.codex/config.toml`）、claude-code（`~/.claude/settings.json` + 项目 `.mcp.json` 兼容）、kimi-code（`~/.kimi-code/mcp.json`）、codebuddy（可选）。**Antigravity 不需要另造一套，只需要在注册表里加一个适配器**——它和 codex/claude 走的是同一条 MCP stdio 通道（`livedot.mjs mcp --agent <id>`），工具完全一致。

### Antigravity 接入官方机制（已核实）

- MCP 配置位置（官方三处通用）：全局 `~/.gemini/config/mcp_config.json`；工作区 `<项目>/.agents/mcp_config.json`；插件形式 `~/.gemini/config/plugins/<name>/mcp_config.json`。
- 格式就是标准 stdio：`{ "mcpServers": { "livedot-map": { "command": ..., "args": [...] } } }`——和我们 codex/claude 写入器生成的完全同构。
- ⚠️ 注意：AGY 用 `~/.gemini/config/mcp_config.json`，而 gemini CLI 用 `~/.gemini/settings.json`——同一个 `~/.gemini` 名下两套文件，两个都安装时要分别写两边。
- ⚠️ AGY 有 MCP 缓存目录（`~/.gemini/antigravity*/mcp/<server>/`）：只删配置不解缓存，AGY 仍认为服务器存在。我们的卸载/「医生」逻辑要一并清缓存。

### 最小实现要点

1. 注册表加 `'antigravity'`（必装级）；
2. 探测：PATH `antigravity`/`agy` + 指纹（`%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe` / Program Files / `~/.gemini/antigravity-ide` 目录）；
3. 写入器：读改 `~/.gemini/config/mcp_config.json`（mcpServers 合并，`--agent antigravity`）；IDE 兜底同写 `~/.gemini/antigravity-ide/mcp_config.json`；
4. 卸载/清理：配置恢复 + `~/.gemini/antigravity*/mcp/livedot-map` 缓存目录；
5. skills/hooks：AGY 的 skills 目录机制未确认前不复制（防误写）——MCP 先行。

### 为什么对用户「无感」

安装器（WinForms）安装完成时跑 agent-kit 安装流程：探测所有已装 Agent → 自动写入各自配置（Antigravity 探测到即写入）→ 用户打开 Antigravity 直接用，**不需要手动粘贴任何配置**；后续可修复（「医生」）与卸载清理。（Antigravity 需要重启/刷新 MCP store 生效——首次装后提示重启即可。）

## 2026-09-03：适配完成 + 验收记录

- **适配器落地**：agent-kit/lib/installer.mjs 注册表新增 `antigravity`（探测：PATH `antigravity`/`agy` + 指纹 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe` / Program Files / `~/.gemini/antigravity-ide`）；双位置写入 `~/.gemini/config/mcp_config.json` 与 `~/.gemini/antigravity-ide/mcp_config.json`（AGY 官方全局入口 + IDE 兜底），`--agent antigravity`；doctor 检查项；卸载时清理 AGY MCP 缓存目录（`~/.gemini/antigravity*/mcp/livedot-map`，防僵尸服务器）；skills 目录格式未确认前不复制（防误写）。
- **文档**：《各家适配mcp做法与解释.md》——三层模型（工具 100% 通用 / 知识包共享 / 配置登记按家写），说明为何不能「一份配置大家读」。
- **测试**：新增 antigravity 用例（指纹探测→双文件写入→doctor→卸载清理）8/8；全量 230/0/3。
- **真机验收**（用户 Antigravity 官方版）：MCP 挂载成功、识别全部 25 个地图工具；`map_list`/`map_get_context` 正常读取当前项目（第四轮排查，revision 91）。已提交 master `984d773`。

## 排查记录 A：模型列表缺失（非官方版）

用户旧版为第三方分发（非官方），其更新链路导致组件混搭（resources/bin 等被非官方更新渠道改写），客户端与服务端模型清单不同步，模型选择器只剩 Gemini 3.6（网页/AI Studio 同账号 3.8 Flash 可用）。重登/清缓存/重装 2.0.6 均无效；改从 antigravity.google 官方安装后恢复。

教训：客户端只从官方渠道、校验 Google LLC 签名；Temp 中未签名 `Antigravity Tools-4.5.5-installer.exe` 已弃用。

## 排查记录 B：全局 MCP 项目指针过期

全局 MCP（不带 --project）每次 tools/call 前读 `~/.live-dot-map/current-project.json`（共享指针，画布切换项目自动更新）；指针曾停在已清理的临时测试目录 → 回退 cwd（用户主目录）→「当前目录还没有活点地图项目」。修复：指针写回 `D:\桌面\活点地图\live-dot-map\ui设计 html`（备份 output/tmp/backup-current-project.json）。与 bug1 共享指针机制同源：指针优先、目录不可达回退，fail-open 不断联。
