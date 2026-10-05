---
name: live-dot-map
description: 活点地图项目记忆。需要项目历史/决策/数据，或要记下结论时用；命令 node "$HOME/.live-dot-map/livedot.mjs" look|read|write|note|analyze|manage（--help 看用法）。
---

# 活点地图

地图是项目的记忆目录：节点（目标/问题）各带一个资料包（`index.md` 主文档、补充 md、数据附件）。用到时再取，不必每次会话都读。

下文 `livedot` = `node "$HOME/.live-dot-map/livedot.mjs"`（PowerShell、bash 通用）。配了 livedot-map MCP 时等价工具：`map_look` / `map_read` / `map_write` / `analysis_run` / `map_manage`。

| 想做 | 命令 |
|---|---|
| 找相关记忆（只回目录） | `livedot look "抖音 爆款"` |
| 读正文 | `livedot read nodes/n3/index.md` 或 `livedot read n3` |
| 记一句结论 | `livedot note n3 "封面换暖色后播放 +40%，依据 nodes/n3/data.csv"` |
| 追加一段 | `livedot write nodes/n3/index.md "## 结论\n…"` |
| 新建节点 | `livedot write --new "节点名" --kind problem "背景…"` |
| 分析数据 | `livedot analyze nodes/n3/data.csv group --by 音乐 --metric 播放` |
| 导入数据/附件 | `livedot manage import --path n3 --source D:\data.csv` |
| 确认人类标注 | `livedot write --ack a1,a2` |

## 规则

1. 先 look 再 read：look 返回 `[id,名称,类型,路径,理由]`，只 read 需要的那几篇。
2. 写入默认追加；整文替换要带 read 返回的 etag（`--etag`）。人类写的文字受保护，不改写、不删除。
3. look 结果有 `human`（待确认的人类标注 id）时，先读并处理，再 `--ack`。
4. 数据结论先 analyze，回答里写明样本数 n 和文件路径；标了"样本不足"的不下结论。
5. 记方向变化、真实结果（含失败）、可复用证据、下一步；不记聊天过程和逐行改动。
6. 人从画布复制的引用 `[活点地图] 节点「…」n3 → …/nodes/n3/index.md`，直接 `livedot read n3`。
7. 出错看 stderr 的 message，按其中的正确用法改；同一错误别重试超过 2 次，说明情况交给人。
