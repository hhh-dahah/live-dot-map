# agent-kit

给 Codex、Claude Code、Kimi Code 和 WorkBuddy/CodeBuddy 的本地协作接入包。安装时自动检测当前可用 Agent，只写入检测到的平台配置；正式模式由一个 `livedot.mjs` 同时提供可靠存储、图检索、MCP 和 hooks。

## 一句接入

在目标项目里告诉 Agent：

> 读取 https://livedotmap.top/agent-kit/setup.md 并严格执行，把活点地图接入当前项目。

接入后运行：

```bash
node ~/.live-dot-map/livedot.mjs doctor --project .
node ~/.live-dot-map/livedot.mjs serve --project . --app ~/.live-dot-map/app.html
```

终端会给出带一次性令牌的本地 URL。Codex、Claude Code、Kimi Code 首次加载本地 MCP/hooks 时仍需各自完成一次信任确认。

直接双击 `app.html` 是降级模式，只用于浏览或导入导出，不会显示“协同正常”。

## 首次初始化地图

安装不会偷偷扫描项目。用户明确发送下面的请求后，Agent 才读取用户授权范围内的项目上下文并通过本地桥创建地图；地图本身始终是第一事实源：

> 请初始化我的活点地图：先调用 `map_get_context` 和 `map_validate`，以 `.live-dot-map/active-map` 指向的当前地图 `map.json` 为事实源。只有我明确授权扫描项目资料时，才读取 `AGENTS.md`、`goal.md`、PRD、README、计划和最新执行记录；`AGENTS.md` 只是可选入口提示，不是地图规则。只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建或补充地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

首张地图由桥强制限制为最多 15 个活跃节点；超过上限必须先合并或压缩，不得生成目录树。

Agent 自动探索最多新增 5 个活跃节点、其中最多 2 个项目级或路线级里程碑；执行细节写入 Markdown，不创建 `work` 级里程碑。

## 内容

- `setup.md`：一键接入与无 Node 兜底。
- `AGENTS.snippet.md`：通用协议摘要。
- `map.template.json`：v2 空白地图。
- `adapters/`：三家首发 Agent 的官方目录/schema，以及 CodeBuddy CLI / WorkBuddy 桌面适配层。
- `bin/`、`lib/`：源码 checkout 的安装与测试工具；发布时功能已打进根 `livedot.mjs`。

## 真实 Codex 验收（维护者）

这不是 mock MCP 测试。它会创建并只清理 `D:\\LiveDotMap-Test\\livedot-real-codex-init-*`，调用真实 Codex CLI，通过项目 MCP 完成 `map_get_context` → `map_validate` → `map_apply_commands`，再检查地图 revision、`createdBy` 和 Agent health 记录：

```powershell
$env:LIVEDOT_CODEX_BIN = 'D:\\桌面\\nodejs\\npm_global\\node_modules\\@openai\\codex\\bin\\codex.js'
$env:LIVEDOT_USE_GLOBAL_CODEX = '1' # 继承当前已登录的全局 Codex；不要复制 auth 文件
npm run build:bridge
npm run verify:real-codex
```

Codex 不可用、未登录或 MCP 写回失败时命令必须明确失败，不得改用 mock 或把未执行写成通过；可设置 `LIVEDOT_KEEP_REAL_CLIENT_TMP=1` 保留 `D:\\LiveDotMap-Test` 临时目录供人工复核。2026-08-14 的真实通过证据为 revision `0→1`、节点 `real-codex-initialized`、`createdBy=agent:codex`；隔离 `CODEX_HOME` 无凭据会得到 401，不应把该失败误判成 MCP 故障。
