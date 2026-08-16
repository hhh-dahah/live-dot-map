### 活点地图 v2

先加载用户级 `live-dot-map` Skill；它是唯一的探索策展规则源。项目地图事实源是 `.live-dot-map/active-map` 指针指向的 `maps/<地图id>/map.json`，长文在该地图目录的 `nodes/`、`routes/` 下。

会话开始调用 `map_get_context`（阅读 `projection`），再处理 `map_list_human_updates`；本轮用 `map_next_candidates` 检索；所有修改统一调用 `map_apply_commands`，结束前调用 `map_validate`。MCP/Hook 失败必须保留未确认状态，不得宣称已同步。

节点使用 `kind:goal|problem|result`；未解决 `problem` 会优先进入相关上下文，但问题节点不等于失败方案，也不会自动创建路线。地图名称用 `set_meta` 修改，Markdown 详情通过本地桥编辑保存。

## 首次初始化请求

只有用户明确发送初始化请求后，Agent 才能读取用户授权范围内的项目文档并创建首张地图。初始化前先读地图，不把 `AGENTS.md` 当作默认入口：

> 请初始化我的活点地图：先调用 `map_get_context` 和 `map_validate`，以 `.live-dot-map/active-map` 指向的当前地图 `map.json` 为事实源。只有我明确授权扫描项目资料时，才读取 `AGENTS.md`、`goal.md`、PRD、README、计划和最新执行记录；`AGENTS.md` 只是可选入口提示，不是地图规则。只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建或补充地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

服务端会将首次初始化限制为最多 15 个活跃节点；超过上限先合并、压缩或结束初始化。

完整协议：`docs/agent-protocol.md`；数据格式：`docs/map-json-v2.md`。
