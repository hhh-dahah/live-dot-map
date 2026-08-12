# 活点地图 Agent 协议 v2

## 单一事实源

- 地图位于 `.live-dot-map/map.json`，格式见 `map-json-v2.md`。
- 人、画布和 Agent 都只能通过 `livedot.mjs` 的命令处理器写入；禁止直接覆盖 JSON。
- 长文固定写入 `.live-dot-map/nodes/<node-id>.md` 与 `.live-dot-map/routes/<edge-id>.md`，改名不移动文件。

## 会话闭环

1. `SessionStart` 注入全部 `new`/`delivered` 人类标注；首次摘要必须引用标注 ID。
2. Agent 调用 `map_ack_human_updates` 后，服务端验证摘要确实包含全部 ID，才能标为已读取。
3. `UserPromptSubmit` 按本轮问题执行图邻域、状态优先级和本地 Markdown BM25 检索。
4. 实质工作只通过 `map_apply_commands` 写回证据、方案和节点。
5. `Stop` 检查未确认标注、未闭环修改和冲突；第一次要求补救，第二次允许结束但画布保持红色。

### 首次初始化请求

安装和 `SessionStart` 不会自动扫描项目。只有用户明确向 Agent 发送初始化请求后，Agent 才能按 `AGENTS.md` → `goal.md`/PRD/README/计划/最新记录的顺序读取上下文并创建首张地图。推荐模板：

> 请初始化我的活点地图：先读取 `AGENTS.md` 路由，再按顺序读取 `goal.md`、PRD、README、计划和最新执行记录；只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

已有地图始终不覆盖；执行细节进入 Markdown，不创建 work 级里程碑。

首次初始化由命令处理器执行硬上限：初始化期间最多保留 15 个活跃节点；第 16 个节点会被拒绝，Agent 必须先合并、压缩或结束初始化。服务端会在 `ui.initialization.status=in_progress` 记录初始化状态，不依赖提示词自觉限量。

## 固定 MCP 工具

- `map_get_context`
- `map_list_human_updates`
- `map_ack_human_updates`
- `map_next_candidates`
- `map_apply_commands`
- `map_validate`
- `map_checkpoint`

`map_next_candidates` 的唯一参数契约为 `query`、`currentNodeId`、`limit`、`includeHistory`（默认分别为 `""`、`null`、12、false）。

## 判断权与安全边界

- Agent 可以直接写入 `pending`、`approved` 或 `changes_requested`；`approved` 表示 Agent 对自身探索结论的状态判断，不等于伪造人类创建或人类确认。画布必须同时展示 `createdBy`/`origin`，由人决定是否采纳或继续修改。
- Agent 可以创建项目级/路线级里程碑大节点；命令处理器限制每次自动探索最多 2 个里程碑、最多 5 个活跃节点、单批最多 10 个对象，并拒绝 `work` 级里程碑。每个里程碑保留 `createdBy`、`updatedBy`、`origin`、`level`。
- 有未确认人类标注、跨待审里程碑、重大新方向、删除/归档或批量超过 10 个对象时，必须停下让人选择。
- 不认识的 schema 只读；未知字段原样保留；同字段并发冲突必须显式交给人处理。
- `archived`、`shelved` 默认不召回，除非人明确询问历史。
- hook 失败不得假装已读；Kimi 的 fail-open 也必须保留未确认状态。

## 降级模式

直接双击 `app.html` 可以浏览和导入导出，但不具备 Agent 自动读取、WAL、冲突保护和可靠性认证。正式协作必须从本地桥启动。
