# map.json v1.1 — 活点地图数据格式

> 单一事实源：人和 Agent 都读写这份文件。设计目标：**Agent 每次会话无脑全读得起**，因此长文本一律不进 map.json（进 Markdown 分片）。
> 对应 PRD §4 术语与 §5.4 状态/连接规则；画布实现见 `app.html`。
> v1.1（2026-08-07）：新增 `score`/`archived`（记忆生命周期：重要性标签与归档衰减）与「投影读取」约定。均为可选字段，v1 文件完全兼容，`version` 仍为 `1`。演化依据见 `docs/plans/2026-08-07-记忆系统演化路径研究.md`。
> 目录约定（2026-08-08）：地图与分片统一收纳进项目根的 `.live-dot-map/` 目录——`map.json` 在 `.live-dot-map/map.json`，分片在 `.live-dot-map/nodes/`、`.live-dot-map/routes/`，下文所有 `md` 路径均相对项目根、以 `.live-dot-map/` 开头。画布兼容读取项目根目录的旧版 `map.json`（读得到就用，新建一律进 `.live-dot-map/`）。

## 顶层结构

```json
{
  "version": 1,
  "name": "项目名",
  "updatedAt": "2026-08-06",
  "view":  { "x": 0, "y": 0, "k": 1 },
  "ui":    { "showAnns": true, "showRoutes": true, "showNums": false, "showFailed": true },
  "counters": { "num": 7, "edge": 9, "ann": 3, "nodeName": 1, "edgeName": 1, "routeName": 1 },
  "routes": [],
  "nodes":  [],
  "edges":  [],
  "anns":   []
}
```

| 字段 | 说明 |
|---|---|
| `version` | 格式版本，当前固定 `1`。画布按此字段做兼容判断。 |
| `name` | 地图/项目名，显示在画布左上。 |
| `updatedAt` | 文件级最后更新日期，`YYYY-MM-DD`。 |
| `view` | 可选。上次浏览视角（平移 x/y、缩放 k），恢复用；缺失则打开时自动适应视图。 |
| `ui` | 可选。四个显示开关，对应画布「更多」菜单。 |
| `counters` | 编号计数器，新建对象时递增，**禁止回退复用**（删除不重排）。 |

## routes[] 路线

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `r1`、`r2`… 或 `r<时间戳>`（升级为问题路线时）。 |
| `name` | string | ≤20 字。 |
| `source` | string\|null | 问题路线的来源节点 id；主路线/专题路线为 `null`。 |
| `main` | bool | 可选。`true` 标记项目主路线，全图仅一条；Agent 摘要以此汇报「主路线当前位置」。 |
| `archived` | bool | 可选。`true` = 整条路线归档折叠：其下方案线视为归档（不进投影、画布弱化），数据保留。归档 ≠ 删除。 |
| `createdAt` / `updatedAt` | date | `YYYY-MM-DD`。 |

## nodes[] 节点

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `n<num>`。 |
| `num` | string | 零填充内部编号 `"01"`，用于文件命名与 Agent 引用；画布不显示。 |
| `name` | string | ≤20 字，写在圆内，每行≤4 字自动换行。 |
| `type` | string | `目的` / `问题` / `结果`，可自定义其他值；`问题` 渲染为虚线边框。 |
| `route` | string\|null | 所属路线 id；`null` = 无。 |
| `x` / `y` | number | 画布世界坐标（圆心）。半径不存，按文字重算。 |
| `md` | string\|null | 详情 Markdown 相对路径，约定 `.live-dot-map/nodes/<num>-<名称>.md`。 |
| `createdAt` / `updatedAt` | date | 停滞检测依据。 |

## edges[] 方案线

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `e<num>`。 |
| `from` | string | 起点节点 id，必有。 |
| `to` | string\|null | 目标节点 id；`null` = 悬空。 |
| `name` | string | ≤20 字，附着在线中。 |
| `status` | enum | `success`（绿实线）/ `failed`（红虚线）/ `pending`（灰点线）。与连接解耦，规则见 PRD §5.4。 |
| `score` | number | 可选。0–100 质量评分（重要性感官标签：三态是粗分类，score 是细粒度）。由人评定或 Agent 建议；用于方案排序与创新循环的比较依据。画布在方案名旁渲染徽标。 |
| `shelved` | bool | 可选。`true` = 已否决勿再提议（仅对 `failed` 有意义）；Agent 见到不得再建议该方向。 |
| `archived` | bool | 可选。`true` = 归档：不进投影、画布弱化半透明，数据保留，随时可恢复。归档 ≠ 删除（没有自动遗忘，判断权在人）。 |
| `route` | string\|null | 所属路线 id。 |
| `dx` / `dy` | number | 仅悬空线：悬空端相对起点的偏移。连接时删除。 |
| `cx` / `cy` | number | 可选。弯折控制点相对直线中点的偏移，缺省为直线。 |
| `md` | string\|null | 方案记录 Markdown，约定 `.live-dot-map/routes/<id>-<方案名>.md`。 |
| `createdAt` / `updatedAt` | date | |

## anns[] 标注（便签）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `a<num>`。 |
| `target` | object | `{ "kind": "node"\|"edge", "id": "<目标id>" }`。 |
| `text` | string | ≤80 字；长内容写进目标对象的 md，便签只留结论。 |
| `hidden` | bool | 隐藏后仍在数据中，Agent 必须能读。 |
| `dx` / `dy` | number | 可选。手动微调相对自动避让位置的偏移；双击复位即删除。 |
| `createdAt` / `updatedAt` | date | |

## 投影读取（中图模式）

「百行级」是**读取预算**而非地图容量上限。地图长大后，Agent 不逐条吞全量，按投影读全局：

- **小图（节点 < 100）**：照旧全读。
- **中图（节点 ≥ 100，或全读明显占上下文）**：只读以下四块——
  1. 主路线（`main:true`）链：按连接顺序的节点序列与当前位置；
  2. 全部未归档的 `pending` 方案线（等待判断清单）；
  3. 停滞路线（其下对象最大 `updatedAt` 距今 >7 天）；
  4. 每条未归档路线的一行摘要（路线名：当前位置 / 下一步 / 最高分方案）。
  需要细节再按 `md` 指针下探对应分片。
- **归档对象（`archived:true` 及其路线归档的边）一律不进投影**，但仍在文件里，需要时可查。
- 画布同步遵守：归档线在画布上弱化显示，不参与悬停命中。

## 写入规则（人与 Agent 共同遵守）

1. **删除级联**：删节点 → 从它出发的方案线随删；指向它的方案线变 `to:null` + `status:pending` + 补 `dx/dy`（沿原方向外延 50px）。删方案线不连带节点。
2. **状态/连接**：手动改 `status` 不动 `to/dx/dy`；吸附连接默认 `status:success`、脱钩默认 `status:pending`（默认推断可被手动覆盖），见 PRD §5.4。
3. **改名同步**：节点改名 → `md` 同步为 `.live-dot-map/nodes/<num>-<新名>.md`；方案改名 → `.live-dot-map/routes/<id>-<新名>.md`（不重排 num/id）。
4. **任何修改**：更新对象的 `updatedAt` 与文件级 `updatedAt`；新建对象递增对应 counter。
5. **长度约束**：节点/方案/路线名 ≤20 字，标注 ≤80 字；超出写入对应 md。
6. **评分与归档**：`score` 取 0–100 整数，改分即更新 `updatedAt`；归档只置 `archived:true`，**不删任何字段**，恢复即删该字段；归档对象照常可读。
7. 未知字段保留不删（前向兼容）；`version` 不认识的文件不写。

## 示例（PRD §13 案例）

```json
{
  "version": 1, "name": "动态壁纸", "updatedAt": "2026-08-06",
  "counters": { "num": 6, "edge": 7, "ann": 1, "nodeName": 1, "edgeName": 1, "routeName": 1 },
  "routes": [
    { "id": "r1", "name": "动态壁纸", "source": null, "main": true, "createdAt": "2026-08-01", "updatedAt": "2026-08-06" },
    { "id": "r2", "name": "幽灵脸问题", "source": "n2", "createdAt": "2026-08-03", "updatedAt": "2026-08-05" }
  ],
  "nodes": [
    { "id": "n1", "num": "01", "name": "开始", "type": "目的", "route": "r1", "x": 0, "y": 0, "md": ".live-dot-map/nodes/01-开始.md", "createdAt": "2026-08-01", "updatedAt": "2026-08-01" },
    { "id": "n2", "num": "02", "name": "生成图片", "type": "结果", "route": "r1", "x": 260, "y": 0, "md": ".live-dot-map/nodes/02-生成图片.md", "createdAt": "2026-08-01", "updatedAt": "2026-08-03" },
    { "id": "n3", "num": "03", "name": "完成放大", "type": "结果", "route": "r1", "x": 520, "y": 0, "md": ".live-dot-map/nodes/03-完成放大.md", "createdAt": "2026-08-02", "updatedAt": "2026-08-04" },
    { "id": "n4", "num": "04", "name": "动态壁纸完成", "type": "目的", "route": "r1", "x": 780, "y": 0, "md": ".live-dot-map/nodes/04-动态壁纸完成.md", "createdAt": "2026-08-01", "updatedAt": "2026-08-01" },
    { "id": "n5", "num": "05", "name": "幽灵脸问题", "type": "问题", "route": "r2", "x": 260, "y": 220, "md": ".live-dot-map/nodes/05-幽灵脸问题.md", "createdAt": "2026-08-03", "updatedAt": "2026-08-05" },
    { "id": "n6", "num": "06", "name": "幽灵脸问题解决", "type": "结果", "route": "r2", "x": 620, "y": 220, "md": ".live-dot-map/nodes/06-幽灵脸问题解决.md", "createdAt": "2026-08-05", "updatedAt": "2026-08-05" }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n2", "name": "生成基础图片", "status": "success", "route": "r1", "md": ".live-dot-map/routes/e1-生成基础图片.md", "createdAt": "2026-08-01", "updatedAt": "2026-08-03" },
    { "id": "e2", "from": "n2", "to": "n3", "name": "实现放大", "status": "success", "score": 85, "route": "r1", "md": ".live-dot-map/routes/e2-实现放大.md", "createdAt": "2026-08-02", "updatedAt": "2026-08-04" },
    { "id": "e3", "from": "n3", "to": "n4", "name": "生成动画", "status": "success", "route": "r1", "md": ".live-dot-map/routes/e3-生成动画.md", "createdAt": "2026-08-04", "updatedAt": "2026-08-06" },
    { "id": "e5", "from": "n5", "to": null, "name": "修改提示词", "status": "failed", "archived": true, "route": "r2", "dx": 150, "dy": 110, "md": ".live-dot-map/routes/e5-修改提示词.md", "createdAt": "2026-08-03", "updatedAt": "2026-08-04" },
    { "id": "e6", "from": "n5", "to": null, "name": "更换模型", "status": "pending", "route": "r2", "dx": 60, "dy": 150, "md": ".live-dot-map/routes/e6-更换模型.md", "createdAt": "2026-08-04", "updatedAt": "2026-08-04" },
    { "id": "e7", "from": "n5", "to": "n6", "name": "引入遮罩检测", "status": "success", "route": "r2", "md": ".live-dot-map/routes/e7-引入遮罩检测.md", "createdAt": "2026-08-05", "updatedAt": "2026-08-05" }
  ],
  "anns": [
    { "id": "a1", "target": { "kind": "node", "id": "n2" }, "text": "人脸在多毛动物上失真最明显", "hidden": false, "createdAt": "2026-08-03", "updatedAt": "2026-08-03" }
  ]
}
```
