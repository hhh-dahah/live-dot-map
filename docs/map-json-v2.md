# map.json v2 — 活点地图可靠协同协议

> `.live-dot-map/map.json` 是人、画布和 Agent 的共享事实源。正式协同模式只能通过本地桥提交命令；旧客户端不得直接覆盖 v2 文件。

## 顶层

```json
{
  "mapId": "map-demo",
  "version": 2,
  "revision": 12,
  "lastEventId": 19,
  "name": "项目名",
  "createdAt": "2026-08-11T08:00:00.000Z",
  "updatedAt": "2026-08-11T09:30:15.123Z",
  "view": {}, "ui": {}, "counters": {},
  "routes": [], "nodes": [], "edges": [], "anns": []
}
```

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

节点、路线和方案的既有字段语义沿用 v1.1。新建对象的托管 Markdown 路径固定为：

- 节点：`.live-dot-map/nodes/<node-id>.md`
- 方案：`.live-dot-map/routes/<edge-id>.md`

显示名称修改不得移动文件。迁移前已关联的项目文档路径原样保留。

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

支持 `create`、`update`、`delete`、`set_view`、`set_ui`、`deliver_annotations`、`ack_annotations`、`resolve_annotations`、`suggest_milestone`。同一 `commandId` 幂等返回原结果。

### `map_next_candidates`

工具参数统一为：

```json
{ "query": "本轮问题", "currentNodeId": null, "limit": 12, "includeHistory": false }
```

`currentNodeId` 可指定当前推进节点并优先召回其邻域；`limit` 限制为 1–12；归档/搁置对象仅在显式 `includeHistory:true` 时召回。缺省值分别为空查询、`null`、12、`false`，旧客户端省略参数仍兼容。

本地桥提交顺序固定为：WAL 落盘并 `fsync` → reducer 应用命令 → 全量校验 → 临时文件写入并 `fsync` → 原子替换 → 目录 `fsync` → 返回新 revision。写入失败、冲突或未确认读取均不是成功状态。

## 冲突与恢复

- `baseRevision` 落后时，若该 revision 后没有修改同一对象字段，可在最新版本自动重放。
- 同一字段冲突返回 `409`，响应包含当前值、待写值和冲突路径；双方数据都保留。
- 保留最近 20 个 revision 快照和最近 7 天每日备份；未完成 WAL 在启动时重放或隔离。
- 外部损坏 JSON 保存到 `.live-dot-map/quarantine/`，当前有效画布不被污染。

## v1 迁移

第一次打开 v1 时先备份原文件，再迁移。已有未知字段和 Markdown 路径完整保留；缺失时间使用迁移时间或原文件时间，`updatedBy` 标为 `migration`。旧标注统一设为 `new` 并带 `legacyReview:true`，进入一次待审核清单。
