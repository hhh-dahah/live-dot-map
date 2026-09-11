# 8-20 修改计划（plan v2.2，已执行）

> 依据：《8-19修改方案.md》《8-20讨论.md》（13 项均已拍板）+ Codex/Kimi 两轮代码核验。
> 本文档是本轮唯一执行计划；其他讨论稿只作为需求证据，不反向覆盖本文档。
> 2026-08-20 已按本文完成批次 0–6 的代码、文档、构建与自动化验收；产品所有者最终主观体验审核仍由用户完成。

---

## 0. 结论、边界与完成标准

### 0.1 已确认的产品方向 

- 删除统一改为可恢复归档，不经过“先放开硬删除、后改归档”的中间阶段。
- 平铺 Markdown 修复与资料包迁移合并，一次切到最终路径，不做两遍。
- 人和 Agent 在地图、资料包、归档/恢复上能力对等；永久清除和外部程序选择是明确例外。
- Agent 上下文只来自当前地图、非归档对象及其明确关联资料，不再递归扫描整个项目。
- 新节点只写普通/问题两态；旧 `result`、旧 milestone 数据兼容保留。
- MCP/Hook 在无项目、错目录、只读目录中 fail-open，不阻断正常对话，也不创建伪项目。

### 0.2 非功能门槛

| 项目 | 硬指标 |
|---|---|
| 数据可靠性 | RPO=0：任何已进入画布的编辑都必须落本地草稿；失败和冲突不得丢任一方内容 |
| 故障感知 | Bridge 失联后 10 秒内进入红色断线态 |
| 恢复 | 同一 Windows 用户重启 Bridge 后继续使用同一 origin；草稿可读并能安全续传 |
| 多项目 | 两个项目、两个标签页和一个 stdio MCP 同时在线时不串项目、不串地图 |
| 安全 | 只监听 loopback；所有写操作校验会话、项目授权、CSRF/调用来源与路径边界 |
| 迁移 | 迁移前备份；可中断续跑；重复执行幂等；冲突时不覆盖原文件 |
| 可维护性 | REST、stdio MCP、Agent Kit 共用工具 schema、服务实现和上下文提供器 |

### 0.3 批次总览

| 批次 | 内容 | 开工条件 |
|---|---|---|
| 0 | 契约冻结与文档同步 | 用户审核本计划后执行 |
| 1 | 用户级单例 Bridge + 会话/草稿/断线恢复 | 批次 0 文档落盘 |
| 2 | MCP/Hook fail-open + 安装器安全去重 | 批次 1 基线全绿；可与后续存储批次独立 |
| 3 | 最终资料包布局 + 安全附件 + 幂等迁移 | 批次 0 契约冻结 |
| 4 | 归档/恢复/purge 一次到位 | 批次 3 完成，资料包生命周期稳定 |
| 5 | MapManager + 统一工具服务 + 上下文收敛 | 批次 3、4 完成 |
| 6 | 外部编辑器 + 两态节点 + 里程碑下线 + 文档收尾 | 批次 1–5 全部完成 |

每批完成后必须先过该批自动化和人工卡点，再进入下一批；不允许只看总测试绿灯继续堆改动。

---

## 批次 0：冻结最终契约（先写文档，不改业务代码）

> 本节是后续实现的约束。执行批次 0 时，将这些契约同步进 `docs/map-json-v2.md`、`docs/agent-protocol.md` 和对应测试说明；后续代码不得临时发明第二套行为。

### 契约 A：用户级单例 Bridge 与稳定 origin

1. 产品采用**每个 Windows 用户一个常驻 Bridge 进程**，不再由每次桌面双击各起一个 detached Bridge。
2. 运行状态目录固定为 `%LOCALAPPDATA%\live-dot-map\run\`，只存运行态，不进入项目和 Git：
   - `bridge.json`：schemaVersion、pid、port、启动时间；
   - `sessions.json`：浏览器会话；
   - `projects.json`：不透明 projectHandle 与规范化项目根目录的授权映射；
   - 单例锁与控制 token。
3. Bridge 第一次成功启动时选择一个端口并持久化；以后必须复用该端口：
   - 端口上是本产品存活实例：launcher 连接复用；
   - 状态文件陈旧且进程不存在：安全回收锁后重启；
   - 端口被其他程序占用：明确报错并保留旧 origin，**禁止静默换随机端口**。
4. launcher 不直接再起第二个 Bridge。它通过带控制 token 的 loopback 控制端点注册/打开项目，拿到一次性浏览器 bootstrap ticket 后打开页面。
5. 控制 token、session 状态和 projectHandle 映射文件只允许当前 Windows 用户读取；token 不写日志、不进 URL。
6. 浏览器只使用一个 `HttpOnly; SameSite=Strict; Path=/` Bridge 会话 cookie，不再使用“项目 hash Cookie”。项目隔离依靠不透明 `projectHandle`：
   - 标识命名固定：`mapKey` 是 `.live-dot-map/maps/<mapKey>/` 的目录路由键；`documentId` 是 `map.json.mapId` 的文档身份。二者不得互换或继续统称 `mapId`；
   - bootstrap ticket 交换成功后，projectHandle 按标签页保存到 sessionStorage；需要重启恢复的路由副本按 origin 写 IndexedDB；
   - 每个项目相关 REST 请求显式携带 projectHandle；地图读写请求再显式携带 mapKey；命令 envelope 另携带 documentId；
   - EventSource URL 携带 projectHandle/mapKey 路由键；
   - 服务端必须验证当前会话已授权该 projectHandle；
   - URL、日志和 UI 不暴露原始项目绝对路径。
7. `active-map` 是项目级唯一事实来源；浏览器 session 不维护可与它分叉的独立 activeMap。

### 契约 B：会话、续期与 reconnect

1. `sessions.json` 至少记录：schemaVersion、sessionIdHash、CSRF、已授权 projectHandle、createdAt、lastSeenAt、expiresAt、reconnectTicketHash、revokedAt；原子写并有跨进程/单例保护。
2. 会话 7 天无活动才过期。请求通过时更新内存 lastSeen；仅在续期阈值或最多每分钟一次持久化，禁止每个请求写磁盘。
3. 服务端续期与 `Set-Cookie Max-Age` 同步刷新；过期 session 定期清理；单用户最多保留 64 个活动浏览器 session，超过时淘汰最久未使用项。
4. `POST /api/v1/session/reconnect` 必须同时满足：
   - Host、Origin 与当前稳定 origin 完全匹配；
   - TCP 对端是 loopback；
   - projectHandle 已由 launcher 授权；
   - 持有尚在 7 天闲置期内的 reconnect ticket；原始 ticket 按 origin + projectHandle 存在 IndexedDB，服务端只存 hash；
   - 通过每个 loopback peer + projectHandle 每分钟最多 5 次的速率限制。
5. reconnect 成功后旋转 sessionId、CSRF、reconnect ticket，旧值立即失效；无任何有效凭据时只提示重新双击桌面入口，由 launcher 签发新 ticket。
6. 会话文件损坏、版本未知、权限不足时 fail-closed：隔离坏文件并要求重新打开，不允许降级为无认证签发。

### 契约 C：草稿与断线状态机

1. 内部状态拆开：
   - `initialized/draftCapable`：曾成功接管真实地图，可以继续记草稿；
   - `authenticated/connected`：当前能否访问 Bridge。
2. 一旦 initialized，任何连接状态下编辑都写 IndexedDB；外层 `app.html`/构建注入逻辑不得因 disconnected 回退到 legacy 保存路径。
3. 图草稿 key：`origin + projectHandle + mapKey`；记录 `documentId`、`baseRevision`、baseSnapshot（或等价命令序列）、draft、commandId、savedAt。
4. Markdown 草稿 key：`origin + projectHandle + mapKey + canonicalPath`；记录 baseEtag、baseContent、draft、savedAt。
5. 恢复使用三方合并：旧基线 / 本地草稿 / 服务端新快照。不同字段自动合并；同字段冲突保留两边并交给用户处理；禁止旧草稿整体覆盖新快照。
6. 旧格式或损坏草稿不自动提交，只提供“恢复副本/复制内容/丢弃”选择。
7. 401 只触发一次中央断线转换：停止认证重试、关闭旧 SSE，但保留 lastDocument、pending、基线和草稿。
8. SSE 每 3 秒 heartbeat；客户端 watchdog 10 秒。每次连接/重连收到 `ready` 后主动拉 snapshot 对账。
9. 顶栏连接灯只有绿/红两态；保存中不作为第三态。冲突是独立对话框/待处理提示，不能冒充“断线”。

### 契约 D：地图创建、切换与并发

1. 新建与切换语义分离：`map_create` **只创建，不自动切换**；UI 如需“新建并进入”，显式顺序调用 create → switch。
2. 建图流程由唯一 `MapManager/ActiveMapCoordinator` 执行：
   - 项目级锁内用原子目录占用分配 id；
   - 初始化完整 map.json、资料包根和必要元数据；
   - 校验可打开；
   - 最后才提交 `active-map`；
   - 发布 `active-map-changed`。
3. 所有命令请求显式绑定 projectHandle + mapKey，命令 envelope 校验 documentId，不能只依赖“当前 store”，确保切图过程中旧草稿不会写进新图。
4. 客户端收到切图事件时：停止向旧图创建新命令 → 把旧图 draft/pending 按旧 mapKey 安全落盘 → 完成或后台续传旧图请求 → 再 attach 新图。
5. stdio MCP 每次调用通过 MapManager 解析当前 active-map；切换后关闭/释放旧 store 引用并使用新 store。
6. 建图失败、并发重名、快速 A→B→A 或任一客户端拒绝/超时，都不得留下“pointer 已切但地图不可用”的中间态。

### 契约 E：归档、恢复与永久清除

1. 普通“删除”统一为 archive 命令；restore、purge 是独立命令。
2. 每个可归档对象使用：`archived:true`、`archivedAt`、`archivedBy`、可选 `archiveReason`。恢复时清除归档元数据，但保留对象 id、坐标、拓扑、Markdown 和未知字段。
3. 归档节点不物理改写关联边/标注；读模型统一隐藏：
   - archived 对象；
   - 端点节点已归档的边；
   - 目标对象已归档的标注；
   - 它们的资料包、检索命中和上下文。
   这样恢复节点时，只恢复没有被单独归档的边和标注。
4. UI 所有入口（右键、键盘、批量、diff）发送显式 archive，不再靠“数组中消失”反推 delete；客户端基线保留 archived 对象但画布不渲染，避免重复 archive。
5. 归档/恢复人和 Agent 同权；purge 只允许人类二次确认或系统 30 天任务。
6. 没有 `archivedAt` 的旧归档永不自动清理；29/30/31 天按可控时钟验收。
7. purge 流程：建立恢复点 → 将资料包移入同盘暂存 → 原子提交 map 物理级联删除 → 调系统回收站。任一步失败回滚 map 与暂存文件并保留归档；禁止降级直删。
8. Windows 回收站通过受控的本产品原生 helper 和固定参数调用；Node 不拼接 shell 命令。

### 契约 F：资料包路径与迁移

1. 最终主文档固定为：
   - `nodes/<id>/index.md`
   - `routes/<id>/index.md`
   `index.md` 不允许改名或归档。
2. 补充 Markdown、附件位于同一对象目录，可添加、改名、归档、恢复；所有操作通过 BundleStore。
3. map.json 增加明确的 `bundleLayoutVersion`。v2.x 全周期保留旧平铺路径只读兼容；新写入只使用资料包路径。未来移除兼容必须另立迁移计划，不按日期自动失效。
4. 自定义 Markdown 指针：
   - 位于规范化项目根目录内、非 symlink、且被当前非归档对象明确引用时，保留原路径并继续参与上下文；
   - 不自动移动；UI 提供用户确认后的“导入资料包”；
   - 项目外路径或 symlink 一律拒绝。
5. 每张地图独立迁移，使用 migrationVersion、项目锁、预检、同盘 staging、journal 和完成标记。覆盖：目标冲突、大小写冲突、空文件、磁盘满、文件占用、进程中断、部分迁移、未知未来版本。
6. 目标已存在且内容不同必须中止并保留旧布局；任何迁移不得静默覆盖自定义文件。

### 契约 G：附件传输与安全

1. 浏览器使用 REST 二进制流上传，不走 JSON base64。接口只接受 `projectHandle、mapKey、ownerKind、ownerId、fileName`，服务端生成目标路径，不接受客户端自由相对路径。
2. stdio MCP 不提供未定义的 `map_write_asset(base64)`，改为：
   - `map_import_asset { sourcePath, ownerKind, ownerId }`
   - sourcePath 必须位于已授权项目根内；服务端 no-follow 打开，复制前后核对 stat，流式写入资料包。
3. 允许类型首版固定：PNG、JPEG、WEBP、GIF、PDF、DOCX、SVG。扩展名、声明 MIME 和文件头必须一致；SVG 永远以 attachment 下载，不内联执行。
4. 防护：路径穿越、双编码、symlink/junction、Windows 保留名、NTFS ADS、尾随点/空格、大小写重名、磁盘满、并发上传。
5. 不覆盖已有文件；重名生成稳定后缀并返回最终名称。单文件上限 20 MiB；单资料包最多 200 个文件；单地图附件总量 1 GiB。
6. 下载统一设置 `X-Content-Type-Options: nosniff` 与安全 `Content-Disposition`。

### 契约 H：统一工具层、append 与上下文

1. 工具 schema、dispatcher、MapManager、MarkdownStore、BundleStore 和 ContextDocumentProvider 只有一份实现；REST、stdio、Agent Kit 只做传输适配。
2. Markdown replace 必须带 baseEtag；append 在 MarkdownStore 同一 per-path 锁内完成，使用临时文件 + 原子替换：
   - append 不要求 baseEtag，按锁顺序追加当前最新内容；
   - commandId 幂等，重试不重复追加；
   - append 与 replace 并发时，replace 在取得锁后重新校验 etag，不符合即 409；
   - 统一换行边界，不产生粘连或多余重复空行。
3. ContextDocumentProvider 只返回：当前 projectHandle + 当前 mapKey + 非归档 owner 的 index.md、补充 md，以及契约 F 允许的显式自定义 md。附件本身不做全文索引，只返回必要元数据。
4. 不再保留 `livedot.ts` 与 `server.mjs` 两份递归扫描逻辑；其他地图、备份、WAL、归档对象和无关项目文档永不进入当前上下文。

### 契约 I：人机能力矩阵

| 能力 | Web/REST | stdio/Agent Kit | 权限说明 |
|---|---|---|---|
| map list/create/switch | 是 | 是 | create 不自动 switch |
| bundle list | 是 | 是 | 当前项目、当前地图内 |
| index.md read/replace/append | 是 | 是 | index 不可改名/归档 |
| 补充 md create/rename/archive/restore | 是 | 是 | 同权 |
| asset list/read/import/archive/restore | 是 | 是 | Agent 用 sourcePath 流式导入 |
| 对象 archive/restore | 是 | 是 | 同权 |
| purge | 人类二次确认 | 否 | 系统 30 天任务也可执行 |
| 外部编辑器选择/另存为 | 是 | 否 | 人类本机 UI 能力，不属于地图语义 |

### 契约 J：旧数据与外部编辑器

1. 新节点只写 `goal`/`problem`；旧 `result` 原样保留，显示和检索按普通节点。Agent 新提交 `result` 时兼容接收但规范化为 `goal`。
2. 旧 milestone、milestoneSuggestion 原样保留但完全忽略；不因旧字段形状阻断加载；新 `suggest_milestone` 返回 `FEATURE_RETIRED`。
3. 编辑器设置存 `%LOCALAPPDATA%\live-dot-map\settings.json`，浏览器只传服务端登记的 opaque editor id，不传任意命令行。
4. VS Code 优先解析真实 `Code.exe`（App Paths/已知安装位置），不用 `code.cmd` + shell。默认关联、文件夹打开、手动选程序和“另存为”均通过本产品原生 helper 的固定参数执行。

### 契约 K：测试与全局配置安全

1. `createBridgeServer` 必须可注入 `runtimeStateDir`、recentProjectsStore、sessionStore、portState、clock、RecycleBin、editorOpener；生产默认才指向真实 `%LOCALAPPDATA%`。
2. 每个 Server fixture 使用独立 mkdtemp 状态目录；测试前后用户真实运行目录字节不变。
3. 修复 `recent projects` flake：不得让同文件并发 fixture 共用 `recent-projects-server-test.json`；不能只替换共同父目录。
4. Hooks 去重逐个处理 `group.hooks[]`：只匹配已知产品 exe/cmd/mjs、事件参数与历史安装目录；大小写无关、路径规范化；保留 matcher 和第三方 Hook；过滤后空组才删除；写前备份。
5. `.gitignore` 使用能覆盖根目录和各地图运行态的精确规则（如 `/.live-dot-map/**/.bridge/`）。任何 `git rm --cached` 必须先列出精确文件并单独征得用户确认，本计划不自动执行。

---

## 批次 1：单例 Bridge + 数据不丢 + 连接体验

### 改动清单

1. 重构 Windows launcher 与 `serve` 生命周期：实现单例检测、稳定端口、受认证 control/open-project、bootstrap ticket 和安全退出/更新接管。
2. Bridge 增加 projectHandle 路由；REST、SSE、日志和浏览器请求都绑定 projectHandle + mapKey，命令 envelope 另校验 documentId；移除 URL 中原始项目路径。
3. 按契约 B 实现 session 持久化、节流续期、过期清理、reconnect 旋转和损坏文件隔离。
4. 按契约 C 重写 BridgeClient 草稿结构、初始化回读、三方合并、401 中央转换、heartbeat/watchdog 和 ready 对账。
5. 同步修改权威生成源 `scripts/build-app.mjs` 与生成后的 `app.html`；断线后不得绕过 BridgeClient。
6. 顶栏改为单一 flex 容器：项目、绿/红状态灯、工具栏不重叠；状态灯为可键盘操作的 button。
7. 先完成契约 K 的测试状态注入与 recent-projects 确定性隔离，再为新全局运行态写测试。
8. 精确补充运行态 `.gitignore` 规则；只报告已跟踪运行文件，不执行 untrack。

### 自动化门禁

- 同时启动两个 launcher：最终只有一个 Bridge PID、一个稳定 origin。
- A/B 两项目两个标签页同时编辑和收 SSE，互不切换、互不覆盖。
- 强杀 Bridge 后从桌面重启：端口不变；旧标签重新连接；图草稿和 Markdown 草稿可恢复。
- 外部程序占用持久化端口时明确失败，不生成新 origin。
- 会话 7 天滑动边界、cookie 同步续期、写盘节流、损坏/过期/重复 reconnect。
- 401 后继续编辑：IndexedDB 更新，legacy 保存函数未调用；连续错误只弹一次。
- 断线时 Agent 改不同字段自动合并；同字段冲突保留双方。
- SSE heartbeat/休眠/恢复；10 秒 watchdog。
- 375/700/960/1280/1920px 与 200% 缩放无重叠，状态灯可键盘触发。
- `npm test` 连续两次全绿，且 recent-projects 不再偶发失败。

### 人工卡点

两个项目同时打开 → A/B 各编辑 → 强杀 Bridge → 双击桌面入口 → 原标签恢复、origin 不变、两边草稿和项目上下文不串。

---

## 批次 2：MCP/Hook fail-open 与安装器安全升级

### 改动清单

1. MCP/Hook 打开 store 前做只读项目资格检查；只有显式安装/创建入口可以初始化 `.live-dot-map`。
2. 无项目、空目录、只读目录：
   - MCP transport、initialize、tools/list 正常；
   - tools/call 返回 `isError:true` 的人话错误；
   - Hook 退出 0、stdout/stderr 为空；
   - 不创建任何文件，也不写 agent-health。
3. 有效项目的损坏、冲突、未来版本只读和人工停止信号照常上报，不得被 fail-open 吞掉。
4. Codex 配置 `required=true` 改 `required=false`；同步更新真实 Codex 测试断言。
5. 按契约 K 逐 Hook 精确去重，保留第三方同组 Hook、matcher 和未知配置；备份后原子写。

### 门禁

- 可写空目录、只读目录、无 cwd 的真实 Codex/Kimi 均能对话且目录零变化。
- 10 类历史产品路径、混合第三方 Hook、大小写/引号/参数含 livedot 的误匹配用例。
- 连装两次后本产品每事件恰好一条，第三方配置逐字保留。
- `npm run verify:agents`
- `npm run verify:installer`
- `$env:LIVEDOT_USE_GLOBAL_CODEX='1'; npm run verify:real-codex`

---

## 批次 3：最终资料包布局、安全附件与一次性迁移

### 改动清单

1. 先修浏览器 canonicalizer：已有合法 md 指针不被 `preferStable` 覆盖；新对象用 documentMapDir + 最终 `index.md` 路径。
2. 实现 BundleStore：主文档、补充 md、附件的 list/read/create/replace/append/rename/archive/restore；路径由 owner 生成。
3. 按契约 F 实现每地图 bundleLayoutVersion、预检、备份、staging、journal、故障恢复和幂等迁移。
4. 实现 REST 流式 asset 上传/下载与全部安全头、类型、配额和 Windows 路径防护。
5. 实现 `map_import_asset` 服务语义；stdio 接线留到批次 5，但本批先完成可独立测试的流式导入服务。
6. 画布 Markdown 编辑器 paste 图片走 REST，写入当前资料包并插入相对引用。
7. 面板改为资料包列表；index 固定，补充 md 可管理；问题节点可列出延伸方案线。
8. Markdown 错误统一进入中央流程：401 调 reconnect；404 由用户明确点击重建；409 保留编辑内容并提供重新加载/复制/继续处理。

### 门禁

- 人建、Agent 服务建、拖动、重命名、保存后路径始终是最终资料包路径。
- 旧平铺成功迁移、内容和未知字段不变；在每个 staging/journal 故障点强杀后可续跑。
- 目标冲突、大小写冲突、空文件、锁定文件、磁盘满、symlink、未来 schema 均不覆盖数据。
- 自定义项目内 md 保持原路径且继续可检索；用户确认后可导入资料包。
- REST 20 MiB 成功、20 MiB+1 拒绝；MIME/魔数、ADS、设备名、双编码、SVG attachment、并发重名全部通过。
- MCP 导入服务不经过 base64；源变化、越界、symlink、错误 owner、磁盘满安全失败。
- 迁移后的真实安装版可打开、可保存、可再次启动。

---

## 批次 4：归档、恢复与 purge 一次到位

### 改动清单

1. Shared reducer 增加显式 archive/restore/purge 命令和元数据；现有 delete 兼容入口只转换成 archive，不执行物理删除。
2. 更新全部前端删除入口与 diff， archived 对象保留在基线、从可见画布过滤，不重复发 archive。
3. projection、BM25/邻接检索、候选、标注、Markdown 上下文统一使用归档过滤器。
4. 新增“设置 → 已归档”：列表、恢复、人工二次确认 purge。
5. 实现可注入 RecycleBin helper、同盘 purge staging、回滚和 30 天任务；永久清除不进入 Agent 工具。
6. 同步 Agent Skill 中“delete 仅人类”的旧文案为 archive/restore 同权，并执行 `npm run sync:agent-skill`。

### 门禁

- 所有 UI 删除入口和 Agent archive 都进入同一语义；连续 snapshot/diff 不重复归档。
- 节点归档后入边、出边、标注、bundle、检索和上下文均不可见；恢复后坐标、拓扑、资料完整。
- 单独归档的边不会因恢复节点而错误复活。
- 离线 archive 与 Agent 同时更新，三方合并不丢内容。
- 29/30/31 天及旧无 archivedAt 数据；回收站失败、map 提交失败、helper 崩溃都保留/回滚归档。
- Agent archive/restore 成功；purge 返回 403。
- `npm run verify:agent-skill`
- `npm run verify:agents`

---

## 批次 5：MapManager、统一工具服务与上下文收敛

### 改动清单

1. 建立唯一 MapManager/ActiveMapCoordinator，REST、stdio、画布 active-map 监听都调用它。
2. 建立唯一工具 registry/schema/dispatcher，接入契约 I 全部工具；Agent Kit 从同一 schema 生成工具定义。
3. 实现显式 projectHandle + mapKey 的命令路由并校验 documentId，以及 active-map-changed、客户端旧图草稿停放/续传和 SSE 重绑。
4. `map_create` 只创建；`map_switch` 才提交 active-map。并发 id 分配使用原子占用。
5. MarkdownStore 实现契约 H 的 replace/append 锁、commandId 幂等与崩溃安全。
6. 建立唯一 ContextDocumentProvider，删除 CLI/Server 项目级递归扫描；REST 和 stdio 获得完全相同的当前上下文文档集合。
7. reducer collection 白名单继续生效，地图管理不伪装成普通 collection 命令。

### 门禁

- 两个窗口 + 一个长驻 stdio MCP 同时在线：建图、切图、读写、归档后最终一致。
- dirty、pending、正在 flush 时切图，旧命令始终带旧 mapKey/documentId，不丢、不串。
- 初始化失败、并发同名、快速 A→B→A：pointer/store/SSE 一致。
- 20 个并发 append 每段恰好一次；append/replace 顺序与 etag 规则一致；崩溃不截断文件。
- A/B 地图同 id 对象不串；归档 owner 不进上下文；自定义授权 md 继续可检索；symlink 不越界。
- REST 与 stdio 的工具名、schema、错误码、返回结构和 ContextDocumentProvider 结果一致。
- 按契约 I 全能力矩阵逐格测试。
- `npm run verify:agents`

### 人工卡点

向 Agent 发：“新建一张地图，切过去，创建节点，给节点新增补充 md 和附件，再归档并恢复。”画布自动跟随且每一步可在资料包和设置中核对。

---

## 批次 6：外部编辑器、两态节点、里程碑下线与文档收尾

### 改动清单

1. 实现 EditorService 与原生 helper：检测 VS Code `Code.exe`、系统默认关联、打开文件夹、手动选择 exe、另存为；浏览器只使用 opaque editor id。
2. 记住上次编辑器到用户设置目录；失效时回退默认关联并给人话提示，不执行任意命令。
3. UI 只显示普通/问题；新写入只用 goal/problem；旧 result 原样保存并按普通显示，Agent 新 result 规范化为 goal。
4. 下线 milestone 的 UI、验证、检索加权、projection/autonomy、命令和测试；旧字段忽略，`suggest_milestone` 返回 `FEATURE_RETIRED`。
5. 必须同步：`goal.md`、`产品需求文档-PRD.md`、`docs/map-json-v2.md`、`docs/agent-protocol.md`、`docs/技术架构与记忆演化.md`、`agent-kit/`、《后端使用修改/人工体验验收清单.md》及相关复制 Skill。

### 门禁

- 编辑器四种入口逐项真实 Windows 验收；参数含空格、中文、引号时无命令注入。
- “另存为”只产生副本，不改原资料包指针。
- 旧 result/milestone 地图不报错、不改旧字段；新数据不再产生 result/milestone。
- `suggest_milestone` 明确返回 `FEATURE_RETIRED`。
- `npm run sync:agent-skill`
- `npm run verify:agent-skill`

---

## 总验收（全部批次完成后）

### 自动化固定门禁

1. 修复隔离后：`npm test` 连续两次全绿，不允许靠串行掩盖共享状态。
2. `npm run verify`
3. `npm run verify:web`
4. `npm run verify:agents`
5. `npm run verify:agent-skill`
6. `npm run verify:installer`
7. `npm run verify:windows-installer`
8. `$env:LIVEDOT_USE_GLOBAL_CODEX='1'; npm run verify:real-codex`
9. 新增并运行 `npm run verify:real-clients -- codex kimi`，封装现有 `tests/e2e/real-client-smoke.mjs`，同步更新最终工具名、两态和资料包路径。

新增的 stable-origin、多项目并行、迁移中断、归档时钟、Bundle/Asset、MapManager 测试必须进入 `npm run verify` 固定列表，不能只作为人工备注或孤立脚本。

### 真实安装版验收

使用安装后的桌面版而不是源码目录，完整执行更新后的人工清单并保留截图/日志：

1. 两个项目同时打开，确认只有一个 Bridge PID、一个稳定 origin，标签页和 SSE 不串。
2. 图与 Markdown 均有未保存改动时强杀 Bridge；桌面重启后草稿恢复并三方合并。
3. dirty/pending/flush 三种状态下由 Agent 切图，旧图内容不写进新图。
4. 旧平铺地图在迁移多个故障点中断后重新启动，继续或安全回滚。
5. 20 MiB 浏览器上传和 Agent sourcePath 导入。
6. 无目录、空目录、只读目录中的真实 Codex/Kimi 对话与工具错误。
7. 375–1920px、200% 缩放、键盘状态灯、断线弹窗和冲突处理。
8. 归档、恢复、29/30/31 天、回收站失败和系统任务。
9. 外部编辑器、手动选择、另存为、中文/空格路径。

### 文档和工作区收尾

- 执行与验证追加到 `implement.md`；重大方向同步 `goal.md`。
- 协议、Agent Kit、Skill 与安装 payload 的版本/hash 一致。
- 对照 `git diff`，只提交本轮范围文件；不得回滚用户原有改动。
- 任何 untrack、清理运行文件或删除归档数据都单独向用户确认。

---

## 风险登记与失败策略

| 风险 | 失败策略 |
|---|---|
| 单例锁/端口异常 | 不换 origin；明确失败并保留草稿，允许用户重试或结束已识别的旧实例 |
| session 文件损坏 | 隔离坏文件、重新由 launcher 授权；不开放无认证 reconnect |
| IndexedDB 不可用/配额满 | 当场红灯并提供导出草稿；不得显示“改动没丢” |
| 迁移冲突/中断 | 旧布局保持只读可用；journal 可续跑；不覆盖目标 |
| 回收站/磁盘/权限失败 | 回滚并保留归档；不降级永久删除 |
| 外部编辑器不存在 | 回退系统默认关联；不拼接 shell |
| Agent 工具部分安装 | 工具 schema/version 检查失败即明确提示修复，不假装能力存在 |

---

## 进度记录

| 批次 | 状态 | 完成日期 | 备注 |
|---|---|---|---|
| plan v2.1 用户审核 | 已通过 | 2026-08-20 | 用户已同意进入执行阶段 |
| 0 契约同步 | 已完成 | 2026-08-20 | 已同步 `docs/map-json-v2.md` 与 `docs/agent-protocol.md`；未修改产品代码 |
| 1 单例 Bridge + 数据不丢 | 已完成 | 2026-08-20 | 稳定 origin、单例控制通道、projectHandle/mapKey 路由、会话续期/reconnect、图与 Markdown 草稿、命令回执恢复、SSE 断线与跨项目竞态均已落地并进入浏览器回归 |
| 2 MCP/Hook fail-open | 已完成 | 2026-08-20 | 空/无效项目零写入 fail-open；损坏项目真实报错；Codex required=false；Hook 精确去重；相关测试与 verify 通过 |
| 3 资料包与附件 | 已完成 | 2026-08-20 | 最终 `nodes|routes/<id>/index.md` 布局、补充 Markdown、二进制附件、安全配额、迁移 journal/备份/冲突保护与 append crash receipt 已完成 |
| 4 归档/恢复/purge | 已完成 | 2026-08-20 | 人与 Agent 同权归档/恢复；30 天 purge、级联、资料包 staging、回收站失败回滚与人工 ID 确认已完成 |
| 5 MapManager + 统一工具/上下文 | 已完成 | 2026-08-20 | MapManager、24 项唯一工具 schema/dispatcher、stdio/HTTP 统一、当前地图可见资料上下文和并发建图锁已完成 |
| 6 体验与文档收尾 | 已完成 | 2026-08-20 | 外部编辑器、资料包与归档 UI、goal/problem 两态、旧值兼容、milestone 退役、协议/PRD/Skill/安装 payload 同步完成 |
| 总验收 | 自动化完成 | 2026-08-20 | `npm run verify` 全门禁通过；真实 Codex 与 Codex/Kimi smoke 通过；最终主观体验审核、线上更新渠道和公开发布不在本次自动化结论内 |

### 8-20 实际验收摘要

- `npm test` 连续两次：每次 192 项，189 通过、0 失败、3 项因当前 Windows 无法创建 symlink/特定 ACL 而跳过；对应拒绝路径已有同层替代覆盖。
- `npm run verify`：核心、Chromium/Firefox/WebKit 强模式、Chrome/Edge 降级模式、性能、四 Agent 周期、基础安装器、Windows 安装/修复/快捷方式/产品入口、SEA 与 release manifest 全部通过。
- `npm run verify:web`：32/32；同时固定检查 375/700/960/1280/1920px、200% 缩放和键盘状态灯。
- `npm run verify:agents`：22 通过、0 失败、1 个 Windows ACL 跳过；`npm run verify:agent-skill` 的 canonical 与 5 个分发副本 hash 一致。
- 真实客户端：全局已登录 Codex 初始化写回通过；Codex 与 Kimi 均完成读取人类标注、确认并写回，revision 正常推进。
- 本轮浏览器实测额外发现并修复三项计划外竞态：旧项目异步响应覆盖新项目、服务端已提交但 IndexedDB 草稿未清时刷新产生假冲突、两个 MapManager 首次并发初始化争写 `active-map`。
- 未执行生产部署，也未清理用户运行文件、旧地图或测试证据；工作区中原有和运行态改动保持原样。
