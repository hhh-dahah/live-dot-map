# bug2 写md工具owner参数被拒

**现象**：MCP 调用 `map_write_markdown`/`map_append_markdown` 时传 `ownerKind+ownerId` 被拒绝（错误「路径必须指向当前地图的 nodes|routes/<id>/<file>」）；`map_write_markdown` 改用完整 `path` 后成功，但 `map_append_markdown` 带 path 仍失败。同时 `map_read_markdown` 用 owner 参数一直正常（行为不一致）。

**疑点**：
1. 当前会话 stdio 桥为会话启动时加载的旧版 livedot.mjs（无 v8 建卡/索引逻辑），其 ownerArgs/参数适配与源码测试版本不一致（tool-service 单测 owner 分支正常）。
2. MCP 传输层是否过滤 ownerKind/ownerId 待核实（read 用 owner 成功、write/append 却失败）。

**影响**：Agent 在旧桥上写/追加须用 path 形式，owner 形式不可靠 → 参数契约或桥需统一升级。

**验证方式**：升级桥（重建 livedot.mjs 重启会话）后重试 owner 参数；仍失败再查 stdio 适配层透传。

**附加观察**：本节点经 MCP `map_apply_commands` 创建后旧桥未自动生成 index.md（有记录无文件），且 nodes/n3 目录都不存在——v8 已修复的「建节点即建主文档」在旧桥上不存在，升级后回归。

---
## 验证结论（2026-08-22, v8.2）

已修复并验证通过：
- 端到端（新 stdio 子进程）：指针切 B 项目 → map_list 跟随；切回 A → 跟随；owner 参数写/append path 追加/建节点即建文件+卡片 全过
- 单测：current-project 读写/失效回退 2 例；全量 npm test 208 项 205 过 0 失败（复跑 2 轮稳定）
- 部署：v8.2 安装包已装（桥含 current-project 指针写入与 stdio 跟随）
- 备注：画布引导态首次点击「选择项目」偶发无响应（UI 操作问题，已 F5 恢复）；真机点选演示留待日常使用自然触发
