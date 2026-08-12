### 活点地图 v2

- `.live-dot-map/map.json` 是项目探索状态的单一事实源；长文在 `.live-dot-map/nodes/`、`.live-dot-map/routes/`。
- 会话开始先使用 `map_list_human_updates`；首次摘要逐项引用所有人类标注 ID，再调用 `map_ack_human_updates`。
- 本轮问题用 `map_get_context` / `map_next_candidates` 检索，不凭记忆猜测全图。
- `map_next_candidates` 参数固定为 `{ query, currentNodeId, limit, includeHistory }`；默认 `currentNodeId:null`、`limit:12`、`includeHistory:false`，需要历史时必须显式传 `includeHistory:true`。
- 所有地图修改统一调用 `map_apply_commands`，禁止直接覆盖 `map.json`。
- Agent 可以创建项目级/路线级里程碑大节点（自动探索每次最多 2 个、每批最多 5 个新节点），不能创建 work 级执行碎片或批量超过 10 个对象；里程碑必须保留 `createdBy`、`updatedBy`、`origin`、`level`。
- Agent 可以直接写入里程碑状态（包括 `approved`），但必须保留并展示 `createdBy`/`origin`；跨待审里程碑、重大新方向、删除/归档或批量超过 10 项时停下询问人。
- 会话结束前调用 `map_validate`；存在未确认标注或冲突时不得宣称协作已闭环。
- MCP/hook 失败时保留未确认状态并明确报错，绝不假装已读取或已保存。

## 首次初始化请求

只有用户明确发送初始化请求后，Agent 才能读取项目文档并创建首张地图。推荐请求：

> 请初始化我的活点地图：先读取 `AGENTS.md` 路由，再按顺序读取 `goal.md`、PRD、README、计划和最新执行记录；只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

服务端会将首次初始化限制为最多 15 个活跃节点；超过上限先合并、压缩或结束初始化。

完整协议：`docs/agent-protocol.md`；数据格式：`docs/map-json-v2.md`。
