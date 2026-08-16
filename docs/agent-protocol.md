# 活点地图 Agent 协议 v2

## 单一事实源

- 地图位于 `.live-dot-map/active-map` 指针指向的 `.live-dot-map/maps/<地图id>/map.json`（旧单地图项目首次打开自动迁移为 `maps/default/`，格式见 `map-json-v2.md`）。
- 人、画布和 Agent 都只能通过 `livedot.mjs` 的命令处理器写入；禁止直接覆盖 JSON。
- 长文固定写入该地图目录下的 `nodes/<node-id>.md` 与 `routes/<edge-id>.md`（如 `.live-dot-map/maps/default/nodes/n2.md`），改名不移动文件；提交旧式 `.live-dot-map/nodes|routes/...` 路径会被重写到当前地图目录。

## 会话闭环

1. `SessionStart` 注入全部 `new`/`delivered` 人类标注；首次摘要必须引用标注 ID。
2. Agent 调用 `map_ack_human_updates` 后，服务端验证摘要确实包含全部 ID，才能标为已读取。
3. `UserPromptSubmit` 按本轮问题执行图邻域、状态优先级和本地 Markdown BM25 检索。
4. 实质工作只通过 `map_apply_commands` 写回证据、方案和节点。
5. `Stop` 检查未确认标注、未闭环修改和冲突；第一次要求补救，第二次允许结束但画布保持红色。
6. `Stop` 对 Agent 更新过的 `pending|success|failed` 方案检查对应 Markdown：至少有关键证据和下一步；已结束方案还要有结果，失败要有失败原因，成功要有评分。缺失时不得宣称协作闭环。

### 首次初始化请求

安装和 `SessionStart` 不会自动扫描项目。`SessionStart` 先读取地图投影和人类更新；只有用户明确向 Agent 发送初始化请求，并明确授权项目资料范围后，Agent 才能读取这些资料并创建首张地图。初始化时地图优先，`AGENTS.md` 只是可选入口提示，不是长期规则或第二事实源。推荐模板：

> 请初始化我的活点地图：先调用 `map_get_context` 和 `map_validate`，以 `.live-dot-map/active-map` 指向的当前地图 `map.json` 为事实源。只有我明确授权扫描项目资料时，才读取 `AGENTS.md`、`goal.md`、PRD、README、计划和最新执行记录；`AGENTS.md` 只是可选入口提示，不是地图规则。只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建或补充地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

已有地图始终不覆盖；执行细节进入 Markdown，不创建 work 级里程碑。用户级 `live-dot-map` Skill 是策展规则的唯一维护源；项目 `AGENTS.md` 只在用户授权后提供资料入口，不复制完整规则，也不能取代地图事实。

首次初始化由命令处理器执行硬上限：初始化期间最多保留 15 个活跃节点；第 16 个节点会被拒绝，Agent 必须先合并、压缩或结束初始化。服务端会在 `ui.initialization.status=in_progress` 记录初始化状态，不依赖提示词自觉限量。

## 固定 MCP 工具

- `map_get_context`
- `map_list_human_updates`
- `map_ack_human_updates`
- `map_next_candidates`
- `map_apply_commands`
- `map_validate`
- `map_checkpoint`
- `map_plan_consolidation`
- `map_read_markdown`
- `map_write_markdown`

本地桥还提供一个受同一会话保护的 MCP 入口：`POST /api/v1/mcp`。调用参数为
`{ "name": "工具名", "arguments": { ... } }`（`tool` 也可作为名称字段），返回
`{ "tool": "工具名", "result": ... }`。Markdown 工具契约如下：

- `map_read_markdown({path, create?, title?})`：读取项目内 Markdown；`create:true` 时在缺失或旧画布留下的空文件上创建/初始化标题模板，返回 `path`、`content`、`exists`、`created`、`etag`、`updatedAt`。
- `map_write_markdown({path, content, baseEtag?})`：以文本原子保存 Markdown，返回同样的文件元数据。应始终把最近一次读取返回的 `etag` 作为 `baseEtag`；不匹配返回 `409 MARKDOWN_CONFLICT` 并保留当前内容。服务端允许省略 `baseEtag`，但调用方不得借此静默覆盖并发修改。

Markdown MCP 与 REST 端点共享项目会话和安全边界：只允许当前已打开、已加入白名单的项目根内 `.md` 相对路径（拒绝绝对路径、`..`、符号链接和非 Markdown 文件），单个 Markdown 文件及 `content` 字段不超过 2 MiB；HTTP 请求体另受桥的 body limit（默认 16 MiB）限制。请求受随机 loopback 端口、Host/Origin 校验和 HttpOnly `SameSite=Strict` 会话保护；MCP、写入及 reveal 等有副作用的请求还必须带 CSRF 校验。桥不监听外部网络。需要在资源管理器中定位文件时，使用受 CSRF 保护的 `POST /api/v1/markdown/reveal`（`{path}`），它只打开已校验路径，不执行用户提供的命令；同端点 GET 仅返回存在性元数据，不产生打开副作用。

`map_apply_commands` 的 `commands` 只接受固定操作：

- 新建：`{op:"create",collection:"nodes|edges|routes|anns",value:{...}}`
- 修改：`{op:"update",collection:"nodes|edges|routes|anns",id:"...",patch:{...}}`
- 删除：`{op:"delete",collection:"...",id:"..."}`（仅人可用）
- 地图元数据：`{op:"set_meta",patch:{name:"地图名称"}}`（仅更新地图名称，不移动 Markdown）
- 视图/UI：`{op:"set_view|set_ui",patch:{...}}`

未知 `op` 必须返回显式错误，不得静默推进 revision；Agent 不应猜测操作名。

`map_next_candidates` 的唯一参数契约为 `query`、`currentNodeId`、`limit`、`includeHistory`（默认分别为 `""`、`null`、12、false）。

`map_get_context` 返回确定性 `projection`：目标、主路线、当前节点、待验证候选、停滞路线和待处理人类信息；`currentNodeId` 若未保存则标记为 `inferred`，不伪装成事实。

节点必须优先使用 `kind:"goal|problem|result"` 表达稳定语义；旧 `type:"问题"` 仍兼容并按 `problem` 检索。未解决问题节点会进入 `projection.problems`，并在相关查询中优先于普通节点；问题节点不等同于失败方案，也不自动扩展路线。节点详情通过本地桥 Markdown API 读写，不能只返回相对路径或静默覆盖并发编辑。

`map_next_candidates` 返回的 `alternatives` 最多 3 条，并携带 `sourceNodeId`、`routeId`、`sourceRouteId`、`isTried`、`isCrossRoute`、`reason`。失败回溯优先使用 `edge.from`，缺失时使用所属路线的 `source`；已归档、已搁置和同来源同名称的重复失败方向必须排除。跨路线候选只能作为有限的相似证据建议。

## 判断权与安全边界

- Agent 可以直接写入 `pending`、`approved` 或 `changes_requested`；`approved` 表示 Agent 对自身探索结论的状态判断，不等于伪造人类创建或人类确认。画布必须同时展示 `createdBy`/`origin`，由人决定是否采纳或继续修改。
- Agent 可以创建项目级/路线级里程碑大节点；命令处理器限制每次自动探索最多 2 个里程碑、最多 5 个活跃节点、单批最多 10 个对象，并拒绝 `work` 级里程碑。每个里程碑保留 `createdBy`、`updatedBy`、`origin`、`level`。
- 有未确认人类标注、跨待审里程碑、重大新方向、删除/归档或批量超过 10 个对象时，必须停下让人选择。
- `map_next_candidates` 只有在当前路线/当前节点一跳范围内、无重大新方向、活跃节点少于 20 个、批量不超过 10 个且候选分差足够时才可自动继续；`autonomy.reasons` 必须保留具体阻断原因。
- 不认识的 schema 只读；未知字段原样保留；同字段并发冲突必须显式交给人处理。
- `archived`、`shelved` 默认不召回，除非人明确询问历史。
- hook 失败不得假装已读；Kimi 的 fail-open 也必须保留未确认状态。
- 地图达到整理软阈值或出现重复/停滞路线时，Agent 只能调用 `map_plan_consolidation` 提建议；不得自行归档。画布审核后创建 checkpoint，再原子应用勾选项。

## 降级模式

直接双击 `app.html` 可以浏览和导入导出，但不具备 Agent 自动读取、WAL、冲突保护和可靠性认证。正式协作必须从本地桥启动。

## 真实 Codex 验收

维护者验收使用 `LIVEDOT_USE_GLOBAL_CODEX=1 npm run verify:real-codex`（PowerShell 中先设置环境变量）。脚本只在 `D:\\LiveDotMap-Test\\livedot-real-codex-init-*` 创建临时项目，调用真实 Codex CLI 和项目 MCP 完成初始化、地图写回与 health 记录检查；不 mock MCP，不运行用户真实项目。Codex 不可用、未登录或 MCP 写回失败时必须明确失败，不得伪造通过。2026-08-14 的真实通过证据为 revision `0→1`、节点 `real-codex-initialized` 和 `createdBy=agent:codex`；隔离 `CODEX_HOME` 无凭据导致的 401 仅是测试环境阻断。
