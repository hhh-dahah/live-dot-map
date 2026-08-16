---
name: live-dot-map
description: 活点地图项目记忆与开放式探索策展规则
---

# 活点地图：探索策展 Skill

活点地图是项目记忆与推进地图，不是聊天记录，也不是第二个代码仓库。地图事实只通过本地桥的 MCP 命令读取和写入。

## 每次会话

1. 先调用 `map_get_context`，阅读 `projection`；再调用 `map_list_human_updates`。
2. 摘要中逐字引用所有 `new`/`delivered` 标注 ID；确认摘要完整后调用 `map_ack_human_updates`。
3. 本轮问题用 `map_next_candidates({query,currentNodeId,limit,includeHistory})`；默认只召回活动对象，历史需明确说明。

## 增量通知（无事不打扰，有事必回应）

- SessionStart hook 只报告**自上次以来**的地图变化（节点/方案/标注/路线的新增或修改），无变化时完全不打扰。
- 收到变更清单后：按清单中的 id 调用 `map_get_context` 或读对应 Markdown 补足上下文；清单本身就是"人想让你看到的东西"，先处理其中的 `new` 标注。
- 不主动输出全量地图摘要；人没有新增内容时，按人当前的请求工作即可。

## 画布引用寻址（人把某块地图信息直接交给你）

人从画布复制的引用文本形如：

```
[活点地图] 节点「新问题」n3（问题，路线 r1）→ .live-dot-map/maps/default/nodes/n3.md
```

- 地图事实源是 `.live-dot-map/active-map` 指针指向的 `maps/<地图id>/map.json`；收到引用后按 id 前缀（`n*` 节点、`e*` 方案、`a*` 标注、`r*` 路线）在当前地图的 `map.json` 中定位对象，读取对应 Markdown 详情。
- 回答时围绕该对象：当前状态、此前尝试与失败原因、人的标注、可继续的方向——不需要人重复解释背景。
- 未找到 id 时，把 `map.json` 中名称相近的对象列给人确认，不要猜。

## 命令格式（不要猜命令名）

`map_apply_commands` 必须使用 `commands` 数组里的固定操作：

- 新建：`{op:"create",collection:"nodes|edges|routes|anns",value:{...}}`
- 修改：`{op:"update",collection:"nodes|edges|routes|anns",id:"...",patch:{...}}`
- 删除：`{op:"delete",collection:"...",id:"..."}`（仅人可用）
- 地图名称：`{op:"set_meta",patch:{name:"..."}}`；改名不得移动 Markdown。
- 视图/UI：`{op:"set_view|set_ui",patch:{...}}`

调用前使用返回的 `revision` 作为 `baseRevision`；遇到未知命令或冲突要停止并报告，不要换一个自造的操作名重试。

## Markdown 读写

本地桥 MCP 还提供 `map_read_markdown({path,create?,title?})` 与
`map_write_markdown({path,content,baseEtag?})`。先 read，再把返回的 `etag` 作为
`baseEtag` 写回；etag 冲突必须停止并让人选择，不得覆盖另一方内容。`create:true`
会初始化缺失或零字节旧文件。路径只能是当前已连接项目根内的相对 `.md` 文件；不要
使用绝对路径、`..`、符号链接，也不要把路径当作“已打开”。需要人工查看时由桥的
`POST /api/v1/markdown/reveal` 打开已校验路径，不能让 Agent 拼接或执行 shell 命令。
读写工具与其它 MCP 工具共用 loopback 会话、项目白名单、HttpOnly/SameSite 会话和
Origin/Host 校验；MCP、写入和 reveal 等有副作用的请求还需 CSRF。单个 Markdown
文件及 `content` 不超过 2 MiB，请求正文另受桥默认 16 MiB body limit 限制。

## 记录与推进

- 只记录大的探索方向、阶段变化、可复用证据、真实失败和关键结果；细节写入对应 Markdown。
- 节点使用 `kind:goal|problem|result`：问题节点表示尚未解决的问题，优先进入相关检索；它不等于失败方案，也不会自动创建路线。需要分支时再显式从问题节点建立路线。
- 一个大尝试通常是“来源节点 → 方案边 → 结果节点”；一条路线失败后，从来源节点读取候选再尝试，不要在失败节点上盲目堆子节点。
- Agent 创建的里程碑保留 `origin=agent_created`、`createdBy`、`level=project|route`；执行碎片写 Markdown，不建 `work` 里程碑。
- 每个真实尝试结束时写结果、证据、评分和下一步；失败也要记录，不能删除或改写成成功。
- 发现路线重复、停滞或活动节点接近 20 个时，调用 `map_plan_consolidation` 生成只读建议，等待人审核后再用 `map_apply_commands`。
- 详情通过本地桥 Markdown API 读取/保存；不要只把相对路径当成已打开，也不要直接覆盖用户文件。
- 不直接写 `map.json`、不静默归档、不跨待审核里程碑、不批量修改超过 10 个对象；冲突交给人选择。

## 结束前

调用 `map_validate`；必要时调用 `map_checkpoint`。有未确认标注、冲突、保存失败或 Hook/MCP 失败时，明确报告未闭环，不能说“已同步”。

## 初始化

用户明确要求初始化时，先调用 `map_get_context` 与 `map_validate`，以 `.live-dot-map/active-map` 指向的当前地图 `map.json` 为事实源；只有用户明确授权扫描项目资料时，才把 `AGENTS.md`、`goal.md`、PRD、README、计划或记录作为来源入口。`AGENTS.md` 不是默认必读项，也不是地图规则。只创建一个总目标、3–7 个关键阶段和当前待判断路线；不要按文件、函数或聊天轮次建节点。若没有地图，先用桥创建空白地图，再按用户目标逐步补充。
