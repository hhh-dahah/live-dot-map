# 活点地图 Agent 协议 v2

> 本协议与 `docs/map-json-v2.md` 配套，是人、画布、REST、stdio MCP 和 Agent Kit
> 共用的行为契约。传输适配器不得自行实现第二套 reducer、资料包路径或上下文扫描规则。

## 单一事实源与 Bridge 拓扑

- 地图事实源是 `.live-dot-map/active-map` 指向的
  `.live-dot-map/maps/<地图 id>/map.json`；旧单地图项目首次打开时按
  `map-json-v2.md` 的 journal 迁移到 `maps/default/`。
- 人、画布和 Agent 只能通过本地 Bridge 的命令处理器写入；禁止直接覆盖 JSON 或资料包。
- 标识命名固定：`projectHandle` 是不透明项目路由键；`mapKey` 是
  `.live-dot-map/maps/<mapKey>/` 的目录路由键；`documentId` 是 `map.json.mapId` 的文档
  身份。三者不得混用；历史代码中的 `projectId` 仅作为 documentId 的兼容别名。
- 每个 Windows 用户只有一个常驻 Bridge。Bridge 首次成功启动后选择并持久化端口，以后
  必须复用同一 origin；launcher 发现存活实例后只发送受控的 open-project 请求，禁止
  静默再起第二个 Bridge 或换随机端口。
- Bridge 只监听 loopback。运行态位于
  `%LOCALAPPDATA%/live-dot-map/run/`，包括单例锁、端口状态、会话、控制 token 和
  `projectHandle` 授权映射；这些内容不进入项目、Git、地图备份或日志。
- 浏览器使用 `HttpOnly; SameSite=Strict; Path=/` 会话 cookie。每个 REST、SSE 和 MCP
  请求显式携带不透明 `projectHandle`，地图操作再携带 `mapKey`；命令 envelope 另携带
  `documentId`；原始项目绝对路径不得
  出现在 URL、UI 或日志。
- `active-map` 是项目级唯一事实来源。浏览器 session、Agent 进程和 Store 缓存不得保留
  一份可分叉的 active-map；切图必须经 MapManager/ActiveMapCoordinator。

## 会话、初始化与恢复

launcher 通过带控制 token 的 loopback 控制端点请求打开项目，由 Bridge 签发一次性
bootstrap ticket。浏览器交换 ticket 后获得 projectHandle 和会话；ticket 不进入 URL，
服务端只保存哈希。

会话至少记录 `schemaVersion`、`sessionIdHash`、CSRF、已授权 projectHandle、
`createdAt`、`lastSeenAt`、`expiresAt`、`reconnectTicketHash`、`revokedAt`。七天无活动
才过期；续期内存更新，最多每分钟一次原子写盘。过期会话定期清理，单用户最多保留 64 个
活动浏览器会话。

`POST /api/v1/session/reconnect` 必须同时通过 Host/Origin 稳定 origin、loopback、已
授权 projectHandle、七天内 reconnect ticket 和每 peer+projectHandle 每分钟 5 次限流。
成功后旋转 sessionId、CSRF 和 ticket，旧值立即失效。无有效凭据时只提示重新双击桌面
入口，不能凭客户端提交的项目路径签发会话。会话文件损坏、未知版本或权限错误必须
fail-closed，并隔离坏文件。

401 只触发一次中央断线转换：停止认证重试、关闭旧 SSE，但保留 lastDocument、pending、
基线和草稿。SSE 每 3 秒 heartbeat，客户端 watchdog 10 秒；连接或 reconnect 收到
`ready` 后主动拉 snapshot 对账。连接灯只有绿/红两态，冲突使用独立待处理提示，不
冒充断线。

### 草稿协议

`initialized/draftCapable` 与 `authenticated/connected` 分离。一旦成功接管过真实地图，
无论当前连接是否可用，编辑都必须写 IndexedDB；不得因为 disconnected 回退到 legacy 保存。

- 图草稿 key：`origin + projectHandle + mapKey`；值含 `documentId`、`baseRevision`、baseSnapshot（或
  等价命令序列）、draft、commandId、savedAt。
- Markdown 草稿 key：`origin + projectHandle + mapKey + canonicalPath`；值含 baseEtag、
  baseContent、draft、savedAt。
- 恢复采用旧基线/本地草稿/服务端新快照三方合并；不同字段自动合并，同字段冲突保留
  双方并交给用户。禁止旧草稿整体覆盖 Agent 的新修改。
- 旧格式或损坏草稿只提供恢复副本、复制内容或丢弃选择，不自动提交。MapId 发生变化时
  草稿按旧 mapKey 保存，不能写进新图。

## 会话闭环

1. `SessionStart` 读取当前地图投影和全部 `new`/`delivered` 人类标注；首次摘要必须引用
   标注 ID。
2. Agent 调用 `map_ack_human_updates` 后，服务端验证摘要确实包含全部 ID，才可标为
   `acknowledged`。
3. `UserPromptSubmit` 通过 ContextDocumentProvider 执行当前地图的邻域、状态优先级和
   Markdown 检索。
4. 实质修改只能通过 `map_apply_commands`、Markdown 工具或 BundleStore 工具写回。
5. `Stop` 检查未确认标注、未闭环修改、冲突和 Agent 更新过方案的证据；第一次要求补救，
   第二次允许结束但画布保持红色。
6. 失败、成功和 pending 方案的 Markdown 分别必须包含关键证据/失败原因、结果/评分和
   下一步；缺失时不得宣称协作闭环。

### 首次初始化请求

安装和 `SessionStart` 不自动扫描项目。只有用户明确发送初始化请求并授权资料范围后，
Agent 才能读取 `AGENTS.md`、goal、PRD、README、计划和执行记录。`AGENTS.md` 是可选
入口提示，不是地图规则或第二事实源。

推荐模板：

> 请初始化我的活点地图：先调用 `map_get_context` 和 `map_validate`，以当前
> `.live-dot-map/active-map` 指向的 `map.json` 为事实源。只有我明确授权扫描项目资料时，
> 才读取项目文档；只保留一个总目标、3–7 个关键阶段和当前待判断路线，不按文件、目录、
> 函数或聊天轮次建节点。通过本地桥创建或补充地图，为节点写入来源路径、生成理由、
> `createdBy` 和层级；不确定内容标为待确认，不覆盖已有地图。

初始化最多保留 15 个活跃节点；第 16 个必须先合并、压缩或结束。服务端记录
`ui.initialization.status=in_progress`，不依赖提示词自觉限量。

## 固定工具与人机能力对等

所有固定 24 个工具由同一 dispatcher、MapManager、MarkdownStore、BundleStore 和
ContextDocumentProvider 实现。REST、stdio 和 Agent Kit 只负责传输和鉴权，不得复制
reducer、资料包路径或上下文扫描逻辑。

基础工具包括：

- `map_get_context`、`map_list_human_updates`、`map_ack_human_updates`；
- `map_list`、`map_create`、`map_switch`、`map_rename`；`map_create` 只创建，不自动 switch；
- `map_next_candidates`、`map_apply_commands`、`map_validate`、`map_checkpoint`、
  `map_plan_consolidation`；
- `map_read_markdown`、`map_write_markdown`、`map_append_markdown`；
- `map_list_bundle_files`、`map_create_markdown`、`map_rename_bundle_file`、
  `map_archive_bundle_file`、`map_restore_bundle_file`；
- `map_list_assets`、`map_import_asset`、`map_archive_asset`、`map_restore_asset`。

Web/REST 与 stdio/Agent Kit 均支持地图 list/create/switch、资料包 list、主文档读写、补充
Markdown create/rename/archive/restore、asset list/read/import/archive/restore 和对象
archive/restore。`purge` 只允许人类二次确认或系统 30 天任务；外部编辑器选择和另存为
是人类本机 UI 能力，不属于 Agent 地图语义。

本地桥 MCP 入口是受同一会话保护的 `POST /api/v1/mcp`，请求为：

```json
{ "name": "工具名", "arguments": { "projectHandle": "ph_xxx", "mapKey": "default" } }
```

响应为 `{ "tool": "工具名", "result": ... }`。MCP、写入、append、asset、archive、
restore、switch 和 reveal 等副作用操作必须通过 Host/Origin、HttpOnly 会话和 CSRF 校验；
项目根必须已经由 launcher 加入白名单。工具错误返回结构化错误，不用空结果伪装成功。

### stdio MCP 薄代理（本地 Agent 通道）

`livedot.mjs mcp` 是薄代理进程：stdio JSON-RPC 的 `initialize`/`tools/list` 由进程本地
静态应答，`tools/call` 一律转发给常驻桥的 `POST /api/v1/mcp` 控制令牌通道，桥是地图的
唯一写者。转发请求带 `X-LiveDot-Control` 头（运行态目录 `control.token`，与
`/api/v1/control/*` 同一信任级），body 为：

```json
{ "tool": "工具名", "arguments": {}, "projectRoot": "绝对路径", "mapKey": "default（可省，缺省跟随该项目 active-map 指针）", "agent": "kimi" }
```

`projectRoot` 必须是已存在的绝对路径；桥将其 canonical 化后按与 serve/launcher 相同的
语义幂等登记进项目注册表，actor 归一化为 `agent:<name>` 并绑定到所有写入。令牌不匹配
直接 `401 INVALID_CONTROL_TOKEN`，不回落浏览器会话鉴权；不带该头的 `/api/v1/mcp` 请求
原样走上面的浏览器会话路径，行为不变。

桥未运行时薄代理会自动点火一个 `serve` 子进程（app.html 依次从 `--app`、脚本旁、exe 旁、
`~/.live-dot-map/`、cwd 解析），等待就绪有上限，超时返回 `BRIDGE_UNAVAILABLE` 并提示重启
画布。未初始化或只读目录在转发前被 fail-open 拦截（返回结构化 `isError` 结果），不点火、
不建目录。`LIVEDOT_MCP_LOCAL=1` 是紧急逃生门，回退旧的就地读写模式，正常情况不应使用。

### Markdown 工具

- `map_read_markdown({path,create?,title?})` 读取当前地图资料包内 Markdown；`create:true`
  仅可初始化缺失或已知零字节旧文件，返回 path/content/exists/created/size/etag/updatedAt。
- `map_write_markdown({path,content,baseEtag,allowContentRemoval?})` 使用同一路径锁、临时文件和原子替换；
  etag 不匹配返回 `409 MARKDOWN_CONFLICT` 并保留双方内容。**默认追加式**：删除已有内容行
  会被拒绝并返回 `409 REWRITE_REMOVES_CONTENT`；仅在明确重写草稿或重构文档时传
  `allowContentRemoval: true`；日常改写优先用 `map_append_markdown`。
- `map_append_markdown({path,content,commandId})` 在同一 per-path 锁内追加最新内容，
  commandId 幂等；与 replace 并发时 replace 重新校验 etag。服务端统一换行边界。
- path 只能是项目根内当前地图资料包的相对 `.md` 路径。主文档固定为
  `nodes/<id>/index.md` 或 `routes/<id>/index.md`；旧平铺路径仅在 v2.x 只读兼容时重写。
  拒绝绝对路径、`..`、双编码、symlink/junction、非 Markdown 文件和超过 2 MiB 的正文。
- `POST /api/v1/markdown/reveal` 只打开已校验路径；不执行用户提供的命令。GET 版本只
  返回存在性元数据，不产生打开副作用。
- **`<mark>` 人机写入契约**：Markdown 里的 `<mark>…</mark>` 表示「人写/人标记」的段落
  （编辑器保存时自动把会话改动段包 `<mark>` 固化，人也可手动标记/取消）。Agent 通过任何
  写入工具新增或改写内容时**一律不带 `<mark>`**；读到既有 `<mark>` 时应保留原样，不主动
  增删。高亮颜色是人的显示层偏好（localStorage），不进文件。

### 资料包与附件工具

资料包文件由 BundleStore 维护。`index.md` 不可改名、归档或删除；补充 Markdown 可新建、
改名、归档、恢复；归档附件和对象不进入默认上下文。

浏览器附件走 REST 二进制流，不走 JSON base64；允许 PNG/JPEG/WEBP/GIF/PDF/DOCX/SVG，
扩展名、声明 MIME 和文件头必须一致，单文件 20 MiB、每包 200 文件、每图 1 GiB。下载
设置 `X-Content-Type-Options: nosniff` 与安全 `Content-Disposition`，SVG 永远 attachment。

Agent 使用 `map_import_asset({sourcePath,ownerKind,ownerId})`，sourcePath 必须在已授权
项目根内；服务端 no-follow 打开并在复制前后核对 stat，流式写入资料包。不提供
`map_write_asset(base64)`。路径穿越、symlink/junction、保留名、尾随点/空格、NTFS ADS、
大小写重名、磁盘满和并发覆盖均拒绝。

### 外部编辑器与另存为

外部编辑器、资料包 reveal 和另存为是人类本机 UI 能力，不属于 Agent 地图语义。Bridge
服务端维护 opaque editor id（例如 `vscode`、`system`、`folder`、`manual`）到已验证本机
程序或动作的映射；浏览器只能提交 opaque id，不能提交绝对路径、命令行或可执行文件名。
Agent 不得调用编辑器、文件选择器或另存为；编辑器启动失败必须显示结构化错误，不得静默
回退到 shell 执行。

## 命令、归档与兼容规则

`map_apply_commands` envelope 必须含 `projectHandle`、`mapKey`、`documentId`、`baseRevision`、
`commandId`、真实 `actor`、`sessionId` 和 commands。固定操作为：

```text
create | update | archive | restore
set_meta | set_view | set_ui
deliver_annotations | ack_annotations | resolve_annotations
```

普通删除统一为 `archive`，人和 Agent 同权；`delete` 是退役操作，旧客户端的兼容入口只
转换为同授权的 `archive` 并标记 `legacyTranslated:true`，不得物理删除。`purge` 只在人类二次确认或系统 30 天任务中执行；
回收站失败必须保留归档，禁止直接永久删除。归档使用 archived/archivedAt/archivedBy
（可选 archiveReason），读模型隐藏归档对象、其边、标注、资料包和上下文；restore 保留
全部 id、拓扑、Markdown 与未知字段。

节点新写入只允许 `kind:"goal"` 或 `kind:"problem"`。旧 `result` 原样保留并按普通历史
节点显示/检索；Agent 新提交 result 规范化为 goal。旧 milestone 与 milestoneSuggestion
原样保留但完全忽略；`suggest_milestone` 返回 `FEATURE_RETIRED`，加载旧字段不能失败。

未知 `op` 或未知 schema 必须显式报错，不得静默推进 revision；同一 commandId 重试必须
返回原结果。冲突必须返回当前值、待写值和冲突路径，双方数据都保留。

## 查询、上下文与自治

`map_get_context` 和 `map_next_candidates` 只读取当前 projectHandle + mapKey 的
ContextDocumentProvider：当前地图、非归档对象的 index.md/补充 Markdown，以及被对象明确
引用且通过路径安全校验的自定义 Markdown。其他地图、备份、WAL、归档对象和无关项目文档
永不递归扫描或进入上下文；附件只返回必要元数据，不做全文索引。

`map_next_candidates` 参数固定为 `query`、`currentNodeId`、`limit`、`includeHistory`，
默认 `""`、`null`、12、false；alternatives 最多 3 条，包含 sourceNodeId、routeId、
sourceRouteId、isTried、isCrossRoute、reason。失败回溯优先 `edge.from`，缺失时回溯
`route.source`；归档、搁置和同来源同名称的重复失败方向排除。

只有在当前路线/当前节点一跳范围、无未确认标注或待审事项、无重大新方向、活跃节点少于
20、单批不超过 10 个且分差足够时才可 `auto=true`；否则 `autonomy.reasons` 说明需要人
选择。`map_plan_consolidation` 只读生成可逆 archive 建议；人审核后先 checkpoint，再
原子应用勾选命令。

## 降级、fail-open 与真实验收

- 直接双击 `app.html` 可浏览和导入导出，但没有 Agent 自动读取、WAL、冲突保护和可靠性
  认证；正式协作必须从本地 Bridge 启动。
- MCP/Hook 在无项目、错目录、空目录或只读目录中 fail-open：先做只读有效项目检查，
  不调用会创建 `.live-dot-map` 的 openStore，不创建伪项目；MCP transport 正常返回
  结构化 `NO_PROJECT`/`PROJECT_READONLY`，Hook 静默退出 0。有效项目的真实损坏、冲突和
  人工停止仍必须报告，不能吞掉。
- Codex/Kimi 安装器去重只匹配已知产品 exe/cmd/mjs、事件参数和历史安装目录，逐条处理
  hook，保留 matcher 与第三方 Hook；过滤后空组才删除，写前创建可恢复备份。
- 维护者验收使用 `LIVEDOT_USE_GLOBAL_CODEX=1 npm run verify:real-codex`。测试使用独立
  `mkdtemp` runtimeStateDir/recentProjects/session/port 状态，不能写入用户真实运行目录。
  测试不 mock MCP；Codex 不可用、未登录或 MCP 写回失败必须明确失败。
