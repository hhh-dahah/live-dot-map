# map.json v2 — 活点地图可靠协同协议

> 地图事实源是 `.live-dot-map/active-map` 指针指向的 `.live-dot-map/maps/<地图id>/map.json`（单地图迁移后为 `maps/default/map.json`）。人、画布和 Agent 的共享事实源以它为准；正式协同模式只能通过本地桥提交命令；旧客户端不得直接覆盖 v2 文件。

## 目录结构（多地图）

```
.live-dot-map/
  active-map            # 当前地图指针，内容为一行地图 id（如 default）
  maps/
    default/            # 每张地图一个目录，目录名即地图 id
      map.json
      nodes/  routes/
      .bridge/          # wal.ndjson、snapshots/、backups/、quarantine/ 均按图隔离
    <其他地图id>/...
```

- 地图 id 只允许小写字母、数字、`-`、`_`，以字母或数字开头，最长 64 字符。
- 本地桥提供 `GET /api/v1/maps`、`POST /api/v1/maps/create|switch|rename`；切换地图即改写 `active-map` 并切换会话与事件流到目标地图。
- 打开只含旧布局 `.live-dot-map/map.json` 的项目时，本地桥先整体备份到 `.bridge/backups/pre-maps-migration-<时间>/`（迁移完成后随目录一起位于 `maps/default/.bridge/backups/` 下），再把 `map.json`、`nodes/`、`routes/` 与 `.bridge` 的 snapshots/backups/quarantine 迁入 `maps/default/`，并把既有 Markdown 路径改写为 `maps/default/` 前缀。旧 `wal.ndjson` 重命名为 `wal.ndjson.legacy-migrated` 保留为证据、不再继续使用：迁移改写过路径前缀，旧 WAL 的校验和与新文档对不上，重放会被当成外部冲突回滚。
- 兼容规则：向桥的 Markdown 接口提交旧式 `.live-dot-map/nodes|routes/...` 路径时，一律重写到当前地图目录，防止迁移后的旧客户端在项目根重建老布局。
- 没有 `.live-dot-map/` 的全新项目首次打开即按上述布局创建。

## 顶层

```json
{
  "mapId": "map-demo",
  "version": 2,
  "revision": 12,
  "lastEventId": 19,
  "name": "项目名",
  "mapDir": ".live-dot-map/maps/default",
  "createdAt": "2026-08-11T08:00:00.000Z",
  "updatedAt": "2026-08-11T09:30:15.123Z",
  "view": {}, "ui": {}, "counters": {},
  "routes": [], "nodes": [], "edges": [], "anns": []
}
```

- `mapDir` 是该地图数据目录的项目相对路径，也是新建对象托管 Markdown 路径的前缀；旧文档缺失时按 `.live-dot-map` 处理。

- 时间统一为毫秒级 UTC ISO 8601。
- `revision` 每次成功事务递增一次；`lastEventId` 是事件流游标。
- 未知字段必须原样往返。未知 `version` 只能只读，绝不能写回。
- 单文件默认上限 16 MiB、单次最多 100 条命令；对象 ID 全图唯一。

## 通用对象字段

新建对象由命令处理器写入真实 `createdBy`，后续命令只能更新 `updatedBy`；客户端提交的同名字段不能覆盖托管字段。旧文件缺失 `createdBy` 时保持可读，迁移补为 `migration`。

路线、节点、方案线和标注都必须包含：

```json
{
  "id": "n1",
  "createdAt": "2026-08-11T08:00:00.000Z",
  "updatedAt": "2026-08-11T09:30:15.123Z",
  "createdBy": "human|agent:codex|agent:claude|agent:kimi|migration",
  "updatedBy": "human|agent:codex|agent:claude|agent:kimi|migration",
  "updatedRevision": 12
}
```

节点、路线和方案的既有字段语义沿用 v1.1。节点新增稳定语义字段 `kind`：

```json
{ "id": "n2", "name": "断电恢复", "kind": "problem", "type": "问题" }
```

- `goal` 表示目标/阶段，`problem` 表示尚未解决的问题，`result` 表示结果。
- `type` 保留为旧版显示字段；旧 `type:"问题"` 迁移为 `kind:"problem"`，未知字段原样保留。
- 问题节点不是失败方案线，也不会自动创建路线；“从问题建立路线”是单独的显式命令。
- 检索和项目摘要默认优先未解决的 `problem` 节点；设置 `resolved:true` 后按普通历史对象处理。

新建对象的托管 Markdown 路径以文档的 `mapDir` 为前缀（旧文档回退 `.live-dot-map`）：

- 节点：`<mapDir>/nodes/<node-id>.md`（如 `.live-dot-map/maps/default/nodes/n2.md`）
- 方案：`<mapDir>/routes/<edge-id>.md`

显示名称修改不得移动文件。迁移前已关联的项目文档路径原样保留（旧布局迁移时会统一改写为当前地图目录前缀）。

路线可选保存当前推进位置：

```json
{ "id": "r1", "currentNodeId": "n7" }
```

`currentNodeId` 必须引用同一路线的现有节点；删除该节点时命令处理器会清空指针。没有保存位置时，Agent 只可在会话摘要中使用确定性推测，并明确标记为 `inferred`。

## 人类标注

```json
{
  "id": "a7",
  "target": { "kind": "node|edge|canvas", "id": "n1" },
  "text": "先验证断电恢复",
  "source": "human",
  "priority": "normal",
  "attention": "new|delivered|acknowledged|resolved",
  "deliveries": [],
  "acknowledgements": []
}
```

- `canvas` 目标可省略 `id`。
- 人创建或修改标注时，`attention` 必须重置为 `new`，并清空旧确认。
- hook 成功注入只可改为 `delivered`；Agent 首次摘要明确包含标注 ID，且服务端验证后，才可改为 `acknowledged`。
- Agent 只能提出解决证据；`resolved` 由人确认。

## 里程碑

节点可包含：

```json
{
  "milestone": {
    "status": "pending|approved|changes_requested",
    "createdBy": "human|agent:<id>|migration",
    "updatedBy": "human|agent:<id>|migration",
    "origin": "human_created|agent_created",
    "level": "project|route|work",
    "criteria": [],
    "reviewNote": null,
    "reviewedAt": null,
    "reviewedBy": null
  }
}
```

`origin` 和来源字段由命令处理器按真实会话写入，不接受 Agent 伪造 `human_created`；Agent 自动探索只能创建 `project` 或 `route` 级里程碑。Agent 每次自动探索最多新增 5 个活跃节点、其中最多 2 个里程碑；单批最多修改 10 个对象，活跃节点达到 30 个后必须先整理。超限返回合并/压缩建议。Agent 可以直接写入 `milestone.status=approved`，但状态不会改变 `origin`/`createdBy`，画布必须明确显示“Agent 创建/更新”。

## 命令事务

```json
{
  "projectId": "project-demo",
  "baseRevision": 12,
  "commandId": "cmd-uuid",
  "actor": "human|agent:codex|agent:claude|agent:kimi",
  "sessionId": "session-uuid",
  "commands": []
}
```

支持 `create`、`update`、`delete`、`set_meta`、`set_view`、`set_ui`、`deliver_annotations`、`ack_annotations`、`resolve_annotations`、`suggest_milestone`。`set_meta` 目前只允许 `{ "patch": { "name": "地图名称" } }`，不改变 Markdown 路径。同一 `commandId` 幂等返回原结果。

### Markdown 详情接口

正式协作模式由本地桥提供受会话保护的读写，不要求浏览器重新授权项目文件夹：

- `GET /api/v1/markdown?path=.live-dot-map/maps/default/nodes/n2.md&create=1&title=断电恢复`：缺失文件创建标题模板，返回 `content` 与 `etag`。
- `PUT /api/v1/markdown`：提交 `{path,content,baseEtag?}`，原子保存；etag 过期返回 `409 MARKDOWN_CONFLICT`，不得静默覆盖。
- 路径只允许项目根内 `.md`，拒绝绝对路径、`..`、符号链接和超过 2 MiB 的内容；旧式 `.live-dot-map/nodes|routes/...` 路径会被重写到当前地图目录。

同一能力也通过本地桥 MCP 入口 `POST /api/v1/mcp` 提供。请求为
`{ "name": "map_read_markdown|map_write_markdown", "arguments": { ... } }`，响应包裹在
`{ "tool": "...", "result": ... }` 中：

- `map_read_markdown({path,create?,title?})` 返回 `path`、`content`、`exists`、`created`、`size`、`etag`、`updatedAt`。`create:true` 会在缺失文件或已知的零字节旧文件上创建 `# 标题` 模板。
- `map_write_markdown({path,content,baseEtag?})` 以原子写入保存并返回新 `etag`。读取后写入必须携带该 `baseEtag`；版本不一致返回 `409 MARKDOWN_CONFLICT`，不得静默覆盖。首次写入可使用读取空文档得到的 etag；服务端虽兼容省略字段，Agent 不应省略并发保护。

MCP 与 REST 共用同一个已认证项目会话：请求必须来自随机 loopback 端口并通过 Host/Origin 和 HttpOnly `SameSite=Strict` 会话校验；MCP、写入和 reveal 等有副作用的请求还必须带 CSRF。项目根须已在桥白名单中。`path` 必须是项目根内的相对 `.md` 文件，拒绝绝对路径、`..`、符号链接和非文件路径；单个 Markdown 文件及 `content` 字段上限为 2 MiB，请求正文另受桥默认 16 MiB body limit 限制。桥不允许通过 Markdown 参数执行命令。若用户需要打开资源管理器，调用受 CSRF 保护的 `POST /api/v1/markdown/reveal`（`{path}`）；GET 版本仅返回 `exists/opened` 元数据。

### `map_next_candidates`

工具参数统一为：

```json
{ "query": "本轮问题", "currentNodeId": null, "limit": 12, "includeHistory": false }
```

`currentNodeId` 可指定当前推进节点并优先召回其邻域；`limit` 限制为 1–12；归档/搁置对象仅在显式 `includeHistory:true` 时召回。缺省值分别为空查询、`null`、12、`false`，旧客户端省略参数仍兼容。

`map_get_context` 和 `map_next_candidates` 返回 `projection`，包含目标、主路线、当前节点（`stored|inferred|none`）、待验证候选、最近结果、停滞路线、人类新标注和待审里程碑。它是从当前地图即时计算的短摘要，不是第二份记忆。

`map_next_candidates` 的 `alternatives` 最多返回 3 条可行动方向。每条包含 `sourceNodeId`（优先取失败方案 `edge.from`，缺失时回溯 `route.source`）、`routeId`、`sourceRouteId`、`isTried`、`isCrossRoute` 和简短 `reason`；`archived`、`shelved` 与同一来源/同一名称的重复失败方向不返回。跨路线成功证据可以保留为有限建议，但不等于允许 Agent 自动扩张路线。

自治判断只有在候选位于当前路线或当前节点一跳邻域、没有未确认人类标注/待审里程碑、没有重大新方向、活跃节点少于 20 个、单批候选不超过 10 个且第一候选分数与第二候选有足够分差时才可 `auto=true`；否则 `autonomy.reasons` 必须说明需人选择的条件。

`map_plan_consolidation` 只读返回可审核建议；当前 V1 仅生成失败/重复方案的可逆归档命令，不删除对象、不改 Markdown。用户确认后先 `map_checkpoint`，再把选中的命令作为一个 `map_apply_commands` envelope 原子提交。

`map_validate` 在校验当前项目时还返回 `attemptIssues`：它只检查 Agent 更新过的方案线对应 Markdown 是否有关键证据、结果、失败原因/评分和下一步。它不评价文字质量，只防止长任务结束时完全没有可恢复的记录。

本地桥提交顺序固定为：WAL 落盘并 `fsync` → reducer 应用命令 → 全量校验 → 临时文件写入并 `fsync` → 原子替换 → 目录 `fsync` → 返回新 revision。写入失败、冲突或未确认读取均不是成功状态。

## 冲突与恢复

- `baseRevision` 落后时，若该 revision 后没有修改同一对象字段，可在最新版本自动重放。
- 同一字段冲突返回 `409`，响应包含当前值、待写值和冲突路径；双方数据都保留。
- 保留最近 20 个 revision 快照和最近 7 天每日备份；未完成 WAL 在启动时重放或隔离。
- 外部损坏 JSON 保存到该地图 `.bridge/quarantine/`，当前有效画布不被污染。

## v1 迁移

第一次打开 v1 时先备份原文件，再迁移。已有未知字段和 Markdown 路径完整保留；缺失时间使用迁移时间或原文件时间，`updatedBy` 标为 `migration`。旧标注统一设为 `new` 并带 `legacyReview:true`，进入一次待审核清单。
