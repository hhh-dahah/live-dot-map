# map.json v2 — 活点地图可靠协同协议

> 本文件定义地图数据、资料包、归档和迁移的唯一数据契约。地图事实源是
> `.live-dot-map/active-map` 指向的 `.live-dot-map/maps/<地图 id>/map.json`。
> 人、画布和 Agent 的共享事实只能通过本地 Bridge 的命令处理器改变；旧客户端不得
> 直接覆盖 v2 文件。

## 运行态与地图目录

项目内只保存地图数据和按地图隔离的恢复材料。Bridge 会话、控制 token、端口和项目
授权映射永远不进入项目目录，也不进入 Git：

```
%LOCALAPPDATA%/live-dot-map/run/
  bridge.json       # schemaVersion、pid、port、startedAt
  sessions.json     # 仅保存哈希和会话元数据
  projects.json     # 不透明 projectHandle -> 规范化项目根目录
  bridge.lock       # 用户级单例锁
  control.token     # 当前用户可读的 loopback 控制凭据
```

正式地图布局为：

```
.live-dot-map/
  active-map                         # 一行地图 id
  maps/
    default/
      map.json
      nodes/
        <node-id>/
          index.md                   # 主文档，固定名称
          <补充文档或附件>
      routes/
        <route-id>/
          index.md                   # 主文档，固定名称
          <补充文档或附件>
      .bridge/
        wal.ndjson
        snapshots/
        backups/
        quarantine/
        migrations/
    <其他地图 id>/...
```

- 地图 id 只允许小写字母、数字、`-`、`_`，以字母或数字开头，最长 64 字符；目录名
  在 Windows 大小写不敏感环境中必须按规范化后的值去重。
- `active-map` 是项目级唯一事实来源。浏览器 session、stdio MCP 和任何缓存不得
  保存一份可独立分叉的 active-map。
- 标识命名固定：`projectHandle` 是不透明项目路由键；`mapKey` 是
  `.live-dot-map/maps/<mapKey>/` 的目录路由键；`documentId` 是 `map.json.mapId` 的文档
  身份。历史 `projectId` 仅作为 documentId 的兼容别名。
- Bridge 提供 `GET /api/v1/maps`、`POST /api/v1/maps/create`、`POST
  /api/v1/maps/switch`、`POST /api/v1/maps/rename`。所有请求显式携带不透明
  `projectHandle`；地图读写再显式携带 `mapKey`，命令 envelope 另校验 `documentId`。
  `map_create` 只创建，不自动切换。
- 迁移或建图失败时，不能留下 pointer 已更新但地图不可用的中间态。active-map 只在
  目标地图完整初始化并通过校验后原子替换。

### 旧布局迁移

打开只含旧 `.live-dot-map/map.json`、`nodes/<id>.md`、`routes/<id>.md` 的项目时，
Bridge 必须先做预检和备份，再以每张地图独立的迁移 journal 将内容迁入
`maps/default/`。迁移覆盖：目标已存在、大小写冲突、空文件、磁盘满、文件占用、进程
中断、上一次部分迁移和未知未来版本。

- 地图包含 `migrationVersion` 和完成标记；重复启动从 journal 续跑，已完成步骤幂等
  跳过。
- 目标存在且内容不同、外部 Markdown 指针不在允许范围内、或检测到 symlink/junction
  时中止并保留原布局；绝不静默覆盖自定义文件。
- 旧平铺路径在整个 v2.x 周期内只读兼容，新写入只使用资料包路径。删除兼容层必须
  另立迁移计划，不能按日期自动失效。
- 旧 WAL 改写了路径前缀后不得继续重放；原文件改名为
  `wal.ndjson.legacy-migrated` 保留为证据，新的 WAL 从迁移提交点开始。

## 顶层 `map.json`

```json
{
  "mapId": "map-demo",
  "version": 2,
  "bundleLayoutVersion": 1,
  "revision": 12,
  "lastEventId": 19,
  "name": "项目名",
  "mapDir": ".live-dot-map/maps/default",
  "createdAt": "2026-08-11T08:00:00.000Z",
  "updatedAt": "2026-08-11T09:30:15.123Z",
  "view": {},
  "ui": {},
  "counters": {},
  "routes": [],
  "nodes": [],
  "edges": [],
  "anns": []
}
```

- `mapDir` 是该地图数据目录的项目相对路径。新建对象的主文档路径由
  `mapDir/nodes/<id>/index.md` 或 `mapDir/routes/<id>/index.md` 计算，不把绝对路径
  写入地图。
- `bundleLayoutVersion` 当前为 `1`，表示资料包主文档使用 `index.md`。未知未来版本
  只能只读，绝不能写回。
- 时间统一为毫秒级 UTC ISO 8601；`revision` 每次成功事务递增一次；`lastEventId`
  是事件流游标；未知字段必须原样往返。
- 地图 JSON/命令元数据单文件上限为 16 MiB，单个命令 envelope 最多 100 条命令。
  Markdown 单文件及正文上限为 2 MiB；附件使用独立二进制流接口，单文件上限为
  20 MiB，不受 JSON base64 body limit 影响。
- 单资料包最多 200 个文件，单地图附件总量最多 1 GiB；服务端生成资料包内目标路径，
  客户端不能提交任意相对路径。

## 对象字段与两态节点

新建对象由命令处理器写入真实 `createdBy`，后续命令只能更新 `updatedBy`；客户端提交
同名托管字段不能覆盖。节点、路线、边和标注都应包含：

```json
{
  "id": "n1",
  "createdAt": "2026-08-11T08:00:00.000Z",
  "updatedAt": "2026-08-11T09:30:15.123Z",
  "createdBy": "human|agent:codex|agent:claude|agent:kimi|migration",
  "updatedBy": "human|agent:codex|agent:claude|agent:kimi|migration",
  "updatedRevision": 12,
  "archived": false
}
```

节点的新写入只允许两种稳定语义：

```json
{ "id": "n2", "name": "断电恢复", "kind": "problem", "type": "问题" }
```

- `kind:"goal"` 表示目标/阶段，`kind:"problem"` 表示尚未解决的问题。
- 旧 `kind:"result"` 或只含 `type:"结果"` 的数据原样保留，显示和检索按普通历史节点
  处理；Agent 新提交 `result` 时兼容接收但规范化为 `goal`。
- `type` 是旧版显示字段。旧 `type:"问题"` 迁移为 `kind:"problem"`；未知字段
  原样保留。问题节点不是失败方案线，也不会自动创建路线。
- 检索和项目摘要默认优先未解决的 `problem`；设置 `resolved:true` 后按普通历史对象
  处理。

## 资料包与自定义 Markdown

- `nodes/<id>/index.md` 和 `routes/<id>/index.md` 是主文档，名称不可改、不可归档、
  不可删除。补充 Markdown 和附件均位于对应对象目录，可通过 BundleStore 创建、读取、
  重命名、归档、恢复。
- 对象显示名称修改不得移动主文档。补充 Markdown 改名只更新资料包清单，不改变对象 id。
- 自定义 Markdown 只有在项目根内、非 symlink/junction 且被当前非归档对象明确引用时
  才能保留并参与上下文；不自动搬移。UI 必须提供用户确认后的“导入资料包”。项目外
  路径、绝对路径、`..`、双编码、Windows 保留名和 NTFS ADS 一律拒绝。
- 附件本身不做全文索引，只在资料包清单和对象上下文中返回必要元数据。

## 归档、恢复与永久清除

普通删除统一为可恢复 `archive`，不再存在“先硬删除再补回收站”的中间语义。

```json
{
  "archived": true,
  "archivedAt": "2026-08-20T10:00:00.000Z",
  "archivedBy": "human|agent:codex|agent:claude|agent:kimi",
  "archiveReason": "可选"
}
```

- 人和 Agent 对对象、补充 Markdown、附件的 archive/restore 同权；永久 `purge` 仅允许
  人类二次确认或系统 30 天任务执行。
- 归档不物理改写关联边/标注。读模型隐藏已归档对象、端点已归档的边、目标已归档的
  标注及其资料包、上下文和检索命中；恢复时只恢复未被单独归档的关联对象。
- restore 清除归档元数据但保留 id、坐标、拓扑、Markdown 和未知字段。旧
  `archived:true` 没有 `archivedAt` 时永不自动清理。
- UI 所有删除入口发送显式 `archive`；客户端基线保留归档对象但不渲染，避免下一次
  diff 重复发起 archive。
- purge 先建立恢复点，再将资料包移到同盘暂存区，原子提交 map 物理级联删除，最后
  调用系统回收站。任一步失败都回滚 map 与暂存文件并保留归档，禁止降级为直接永久删除。

## 人、Agent 和工具事务

事务 envelope 使用不透明句柄，不把原始项目路径暴露给 URL、日志或 UI：

```json
{
  "projectHandle": "ph_xxx",
  "mapKey": "default",
  "documentId": "map-demo",
  "baseRevision": 12,
  "commandId": "cmd-uuid",
  "actor": "human|agent:codex|agent:claude|agent:kimi",
  "sessionId": "session-uuid",
  "commands": []
}
```

所有命令通过唯一 MapManager/ActiveMapCoordinator 解析并校验 projectHandle、mapKey、documentId、
授权和当前地图。支持的操作包括：

- `create`、`update`、`archive`、`restore`（节点、边、路线、标注或资料包对象）；
- `set_meta`、`set_view`、`set_ui`、`deliver_annotations`、`ack_annotations`、
  `resolve_annotations`；
- `map_checkpoint` 和经用户确认的 `map_apply_commands`。

`delete` 不再是新协议操作；旧客户端的兼容入口只把它转换为同授权的 `archive`，不得物理
删除，并在结果中标记 `legacyTranslated:true`。`suggest_milestone` 已退役并返回
`FEATURE_RETIRED`。同一 `commandId` 必须幂等返回原结果。

本地桥提交顺序固定为：WAL 落盘并 `fsync` → reducer 应用命令 → 全量校验 → 临时文件
写入并 `fsync` → 原子替换 → 目录 `fsync` → 返回新 revision。写入失败、冲突或未确认
读取均不是成功状态。

## Markdown 读写与 append

REST 和 stdio MCP 共用 BundleStore/MarkdownStore：

- `GET /api/v1/markdown?projectHandle=...&mapKey=...&path=nodes/n2/index.md`
  读取主文档或补充 Markdown；`create=1` 只允许在缺失或已知零字节旧文件时创建标题模板。
- `PUT /api/v1/markdown` 提交 `{projectHandle,mapKey,path,content,baseEtag}`，
  使用同一路径锁和临时文件原子保存；etag 过期返回 `409 MARKDOWN_CONFLICT`，双方内容
  都保留。
- `POST /api/v1/markdown/append` 提交 `{projectHandle,mapKey,path,content,commandId}`。
  append 在同一 per-path 锁内按当前最新内容追加，不要求 baseEtag；commandId 幂等，
  重试不会重复追加。append 与 replace 并发时，replace 取得锁后重新检查 etag，不符合
  即返回 409。服务端统一换行边界，不产生粘连或重复空行。
- path 是对象资料包内的项目相对路径，主文档只能是 `index.md`；旧平铺路径在 v2.x
  只读兼容时重写到当前地图。绝对路径、`..`、symlink/junction、非 `.md` 文件和超过
  2 MiB 的内容拒绝。

## 附件二进制接口

浏览器使用 REST 二进制流上传，不走 JSON base64。接口只接受
`projectHandle、mapKey、ownerKind、ownerId、fileName`，服务端生成目标路径；重名不覆盖，
返回稳定后缀后的最终名称。首版类型固定为 PNG、JPEG、WEBP、GIF、PDF、DOCX、SVG，扩展名、
声明 MIME 和文件头必须一致；SVG 永远以 `Content-Disposition: attachment` 下载，不内联执行。

stdio MCP 的附件导入使用 `map_import_asset { sourcePath, ownerKind, ownerId }`。sourcePath
必须位于已授权项目根内，服务端 no-follow 打开，复制前后核对 stat，流式写入资料包；不
提供 `map_write_asset(base64)`。

所有下载设置 `X-Content-Type-Options: nosniff` 和安全 Content-Disposition。上传还要
拒绝路径穿越、双编码、symlink/junction、Windows 保留名、尾随点/空格、NTFS ADS、大小写
重名、磁盘满和并发覆盖。

外部编辑器、资料包 reveal 和另存为属于人类本机能力，不写入地图事实。Bridge 只向浏览器
暴露已登记的 opaque editor id；浏览器不得提交或拼接绝对路径、命令行或可执行文件名，Agent
不得调用这些能力。

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
- 人创建或修改标注时，`attention` 重置为 `new` 并清空旧确认。
- hook 成功注入只可改为 `delivered`；Agent 首次摘要明确包含标注 ID 且服务端验证后
  才能改为 `acknowledged`。Agent 只能提出解决证据，`resolved` 由人确认。

## 查询、上下文与自治边界

`map_get_context` 和 `map_next_candidates` 从当前 map 即时计算短摘要，不产生第二份记忆。
ContextDocumentProvider 只读取当前 projectHandle + mapKey 下非归档对象的 index.md、补充
Markdown 和契约允许的显式自定义 Markdown；其他地图、备份、WAL、归档对象和无关项目文档
永不进入上下文。

```json
{ "query": "本轮问题", "currentNodeId": null, "limit": 12, "includeHistory": false }
```

`map_next_candidates` 的 `alternatives` 最多 3 条，包含 `sourceNodeId`、`routeId`、
`sourceRouteId`、`isTried`、`isCrossRoute` 和 `reason`。失败回溯优先 `edge.from`，缺失
时使用 `route.source`；归档、搁置和同来源同名称的重复失败方向不返回。

自治只在当前路线/当前节点一跳范围、无未确认人类标注或待审事项、无重大新方向、活跃
节点少于 20、单批不超过 10 个且候选分差足够时允许 `auto=true`；否则
`autonomy.reasons` 必须说明需人选择的原因。`map_plan_consolidation` 只读返回可审核
建议；用户确认后先 checkpoint，再原子应用可逆 archive 命令。

## 冲突、备份与恢复

- `baseRevision` 落后时，若之后没有修改同一对象字段，可自动重放；同字段冲突返回 409，
  响应包含当前值、待写值和冲突路径，双方内容都保留。
- 最近保留 20 个 revision 快照和最近 7 天每日备份；未完成 WAL 启动时重放或隔离。
- 外部损坏 JSON 保存到该地图 `.bridge/quarantine/`，当前有效画布不被污染。
- 草稿不是 map.json 的第二事实源：浏览器草稿记录 `origin + projectHandle + mapKey`、
  `baseRevision`、baseSnapshot（或等价命令序列）、draft、commandId、savedAt；恢复使用
  旧基线/本地草稿/服务端新快照三方合并，不能整体覆盖服务端新内容。Markdown 草稿另以
  `canonicalPath + baseEtag` 保存。

## 旧字段与未来版本

- 旧 `result`、旧 milestone、`milestoneSuggestion` 和未知字段原样保留但不触发新语义。
  新 `suggest_milestone` 调用返回 `FEATURE_RETIRED`，加载旧文件不因字段存在而失败。
- v1 迁移前先备份；缺失时间使用迁移时间或原文件时间，`updatedBy` 标为 `migration`。
  旧标注统一设为 `new` 并带 `legacyReview:true`，进入一次待审核清单。
- 未知 `version` 或 `bundleLayoutVersion` 只读；不能自动降级、清空或覆盖数据。
