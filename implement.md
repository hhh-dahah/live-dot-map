# implement.md — 执行与修改过程记录

> 用途：追加式日志，记录重大执行与修改过程，以及当前原型的实现要点。
> 走查发现的问题与正式版期望行为记 `设计细节.md`；阶段路线与边界记 `goal.md`。

## 时间线

- **ReactFlow 验证 Demo**：早期产品验证，已废弃（在 `live-dot-map/` 上级目录，不维护、不迁移代码，仅保留数据示例参考）。
- **HTML 原型建立**：零依赖单文件静态 HTML（`canvas.html` 核心画布、`landing.html` 落地页、`index (2).html` 导航页），全部逻辑内联。
- **走查第 1 轮**：取消独立首屏 start.html，打开/新建/导入/保存/导出收进画布左上项目菜单（Excalidraw 式）。（`设计细节.md` 第 1 条）
- **走查第 2 轮**：三种状态方案线统一带箭头；悬空端点可自由拖拽；线身可弯折。（第 2 条）
- **走查第 3 轮**：节点去编号、名称写进圆内自动适配；标注加归属引导线；拥挤问题定为「自动布局为主 + 手动微调为辅」。（第 3 条）
- **走查第 4 轮**：标注改黄色小便签 + 自动避让升级；方案线可直接按住线身弯折。（第 4 条）
- **走查第 5 轮**：Excalidraw 式交互细节——悬浮发光、抓取点固定弯折、便签小尾巴、框选一键删除、拉出式新建箭头、新建地图直进空白画布。（第 5 条）
- **走查第 6 轮**：手掌工具；拖末端时前半段固定弯折；绿色已连接线末端可拖起脱钩变灰。（第 6 条）
- **冻结**：原型定稿，git 提交 `42bf985`，作为 Excalidraw 改造的验收样板，不再修改。
- **走查工具链切换**：Kimi WebBridge 已删除（用户侧卸载），交互式走查改用 opencode 自带 Playwright MCP 工具（`playwright_browser_*`）；headless Chrome 纯视觉截图保留。
- **走查第 10 轮**：状态与连接解耦——绿/红/灰三色均可连接或不连接节点，`setEdgeStatus` 只改颜色不再强制建节点/脱钩（推翻第 7 条自动建目标节点行为）；右键悬空方案线新增「新建连接节点」（自动创建结果节点并连接，状态保持）；三个点菜单新增「显示失败方案」开关，一键隐藏全部红色失败线（渲染/标注避让/框选同步过滤）。（第 10 条）
- **走查第 11 轮**：修复选择模式双击无法编辑（根因：点击选中同步 render 重建 DOM 使浏览器不再派发 click/dblclick；改为 rAF 延迟渲染 + 标签按对象 key 手动双击检测），节点/方案名/路线名双击编辑恢复；属性面板字段统一为「所属路线置顶 → 名称 → 类型/状态 → 其余」；所属路线显示"无"（无关联时）且支持下拉选择已有路线 + 重命名当前路线；新建节点默认"无"路线，方案线跟随起点。（第 11 条）
- **原型定稿**：11 轮走查后用户验收基本满意，`canvas.html` 正式冻结为 Excalidraw 改造的验收样板，不再修改；进入阶段 2（画布可行性验证，见 `goal.md`）。
- **阶段 2 方案与计划**：用户确认 goal.md 阶段 2 为「在 Excalidraw fork 上复刻 canvas.html 全部画布功能」，路径定为方案 A（组合原生元素：ellipse+bound text 做节点、arrow+binding 做方案线），数据写死示例，验收按交互对齐（视觉不抠像素）。计划存 `docs/plans/2026-08-06-阶段2-excalidraw复刻.md`（含方案决策记录与 5 条关键假设）。
- **文档一致性修订**：按 11 轮走查结论修订 PRD（v2.0→v2.1）：第五章改为「状态与连接解耦」（推翻红灰禁连/标成功强制建点）；§6.2 问题路线改为就地升级（推翻另建独立问题节点）；§7.1/§10.1/§15 取消首屏与中央输入态；§8.2 节点去编号；§8.3/§8.4 补拉出式创建、新建连接节点、隐藏失败方案、所属路线改挂；§9.2/§11.1/§14.2 同步；§16 更新为当前状态。同步修订 `UI设计需求文档.md`（§2.1 首屏借鉴、§8 项目入口、§10 三态与方案线交互、§12 面板字段、§13 右键菜单）与 `goal.md` 最终形态方案线条目、`AGENTS.md` 版本行。

## 当前原型实现要点（canvas.html）

单文件自包含实现，无框架：

- **设计令牌**：`<style>` 顶部的 `:root` CSS 变量，与 `brand-spec.md` 一一对应，改色值必须两边同步。
- **种子数据**：`seed()` 函数（约第 406 行）按 PRD §13 案例生成三条路线（动态壁纸主路线、幽灵脸问题、性能优化）的演示数据。
- **状态模型**：全局对象 `S`，含 `routes / nodes / edges / anns / view / sel / multi / tool` 等字段；节点字段 `{id,num,name,type,route,x,y,r,md}`（`num` 仅供文件命名，界面不显示；名称写在圆内，`r` 按文字自动计算），方案线字段 `{id,from,to,name,status,route,md,dx,dy,cx,cy}`（`to:null` + `dx/dy` 表示悬空末端；`cx/cy` 为弯曲控制点偏移）；`hoverEdge/snapTo/selAnn/drawingEdge` 是瞬时交互态，不进撤销快照。
- **渲染**：`render()` 全量重绘；节点是 `translate(-50%,-50%)` 定位的绝对定位 DOM（名称在圆内），方案线是 `<svg id="edges">` 内的二次贝塞尔 path，三种状态都带箭头（各自颜色的 marker）。
- **方案线交互**：悬空端点可拖拽（更新 `dx/dy`，拖动时钉住曲线前段锚点 B(0.25)，前半段基本固定、后半段自由弯折；命中节点时吸附高亮，松手自动连接变绿）；已连接（绿色）线选中或悬停时末端出现手柄，拖起即脱钩变灰（待验证），拖到别的节点松手重新吸附变绿；按住线身或中点手柄弯折（抓取点固定在指针下，按曲线参数 t 反推 `cx/cy`）；箭头工具在节点上按住直接拉出新线；方案名标签沿曲线法向偏移，同节点多条线交替取侧避让。
- **标注**：黄色小便签，归属用四角的小尾巴（小角角）连向所属对象，随拖动拉伸；自动避让布局 + 拖拽微调 + 双击复位；点击紫色选中、再点行内编辑。
- **选择**：空白处拖拽出紫色框选（`#marquee`），多选包围框 `#selbox` + 悬浮一键删除按钮 `#del-float`；平移用滚轮/中键/空格。悬浮节点/方案线时紫色发光。
- **项目菜单**：左上 `#proj-menu-btn` 弹出 Excalidraw 式菜单（打开/新建/导入地图、保存、导出），原型阶段多数为 toast 演示项，「新建地图」（`newBlankMap()`）直接切到空白画布，无中央输入态。
- **撤销/重做**：`snapshot()`/`pushHistory()` 用 JSON 快照实现。
- **方案状态切换**：`setEdgeStatus()` 只改颜色与线型，不动连接（走查 10 解耦后行为；连接由拖拽吸附/脱钩与「新建连接节点」决定）。
- **Agent 模拟**：`agentWork()`/`submitAgent()` 仅模拟 Agent 更新流程（状态提示 + 高亮），没有真实 Agent 连接。

## 已知遗留小项（原型已冻结，仅记录，留待正式版 app.html 对照）

- `setEdgeStatus()` 切换状态时会重建 `dx/dy` 但保留旧 `cx/cy` 弯曲，切换后曲线可能突兀。
- 项目菜单「设置」项是改造时主动保留的入口（否则设置抽屉无处打开），是否保留待正式版定夺。
- 项目菜单中 Ctrl+O / Ctrl+Shift+E 只是提示文字，未绑定真实快捷键。

## 本次执行记录（阶段 1，已完成）

- 第一次提交 `42bf985`：冻结原型（6 文件改动）。
- 新建 `goal.md`（重大方案与阶段路线）、`implement.md`（本文件）。
- 精简 `AGENTS.md` 为路由式索引，canvas.html 实现要点搬入本文件。
- 修正 `设计细节.md` 头部过时引用（start.html 已删除）。
- Excalidraw 环境：
  - 克隆位置：`D:/桌面/活点地图/excalidraw`（`--depth 1`）
  - commit hash：`39103bd33a3365f4134958fe5e932678fcd12fb8`（2026-08-03，master）
  - 仓库要求：`packageManager: yarn@1.22.22`、`engines: node>=18`，与本机匹配；`yarn start` 实际执行 `yarn --cwd ./excalidraw-app start`
  - 本机环境：node v24.15.0 / npm 11.12.1 / yarn 1.22.22 / git 2.47.0
  - `yarn install`：官方源直连不通，换 npmmirror 镜像后成功（`yarn install --registry https://registry.npmmirror.com`，1213s）；peer dependency 警告为正常噪音
  - `yarn start`：跑通，TypeScript 0 错误、ESLint 0 错误；本机实际端口 **3001**（3000 被占用），访问 `http://localhost:3001/` 返回 200（页面标题 Excalidraw Whiteboard）；验证后已关闭服务器
- 第二次提交：文档类改动（新建 goal/implement、精简 AGENTS、修设计细节头部）。
- **阶段 1 完成标记**：以上各项均已落地；阶段 0 原型亦于走查第 11 轮后定稿，项目进入阶段 2。

## 阶段 2：Excalidraw 画布复刻（2026-08-06）

> 工程：`D:/桌面/活点地图/excalidraw`（fork），`yarn start` 3001 端口。计划见 `docs/plans/2026-08-06-阶段2-excalidraw复刻.md`。

- **T1 品牌主题**：`theme.scss` 新增状态色/便签黄令牌（light+dark）、`styles.scss` `--ui-font` 加 PingFang SC/Microsoft YaHei、`common/colors.ts` 加 `STATUS_COLORS`。
- **T2 工具栏裁剪**：`Tools.tsx` 移除原生工具快捷键（保留定义兼容引用）、新增 `CUSTOM_TOOLS`（N 建节点/L 方案线/M 标注）与 `CustomToolButton`；`Toolbar.tsx` 只留 5 工具；`HintViewer` 中文提示对齐原型 TOOL_HINTS；N/L/M 快捷键分发在 `App.tsx` handleKeyDown。
- **T3 菜单裁剪**：`getContextMenuItems` 重写为 节点/方案线/画布 三类（对齐 canvas.html）；主菜单（`excalidraw-app/AppMainMenu.tsx`）改活点地图项目菜单 + 视图开关（显示标注/路线名/失败方案/内部编号 + 适应视图）；`ContextMenu.tsx` 支持中文 label（i18n 键仍走翻译）；移除欢迎屏（goal.md「打开即画布」）；新增 `dotmap/Toast` 轻提示。
- **T4 属性面板**：`excalidraw-app/DotMapPropsPanel.tsx`（Sidebar name="props" 非 docked），选中单个业务元素自动滑入/取消选中隐藏；字段顺序=所属路线→名称→类型/状态→起点/目标→Markdown→标注→内部编号（可隐藏）；行内编辑 Enter 提交/Esc 取消/blur 提交 + `isComposing` 中文组词保护；新增 `setElementText/setElementDm` action。
- **T5 圆形节点**：`element/textElement.ts` 新增 `getNodeCircleLayout`（每行≤4 字、直径 max(68, 宽/高+28)），`redrawTextBoundingBox`/`handleBindTextResize` 的 ellipse 分支改为正圆自适配；`dotmap/createNode.ts` 节点工厂（问题=虚线边框）。
- **T6 建节点工具**：`dotmap/DotMapTools.ts`（组合到 App 的 dotMapTools），N 工具点空白建点（编号自动递增 01/02…）后切回选择；右键画布「新建节点」同 action。
- **T7 三态渲染**：`dotmap.ts` `setEdgeStatus`/`EDGE_STATUS_COLOR|STROKE`（成功绿实线/失败红虚线/待验证灰点线）；面板 seg 与右键菜单切状态只改色不动连接（走查 10）；`actionSetElementDm` 同步 strokeColor/strokeStyle。
- **T8 拉出式创建**：L 工具激活原生 arrow 工具（起点吸附/终点高亮/悬空端原生能力）；arrow 分支限制「只在节点上按住拉出」（空白点击不绘制，命中检测兼容 bound text 与多元素）；箭头创建后经 `dotmap/tagArrow.ts` 延迟 250ms 打标（dm/颜色/线型/方案名标签），拉完保持 L 可连续拉。
- **T9 点击默认线**：原生点击节点产生 0 长度箭头，打标时 `getDefaultClickArrowPoints`（avoidAngleDeg 移植：方向与同节点已有线 ≥30° 错开，长 220）修正为默认线。
- **T10 方案名标签**：arrow 作 text 容器（bound text），`方案N` 按起点节点计数删除不重排；渲染定位在线中点上方（Excalidraw 原生）；双击行内编辑。
- **T11 端点吸附/脱钩 + 新建连接节点**：端点拖拽吸附/脱钩为 Excalidraw 原生；右键悬空线「新建连接节点」在悬空端点建「目的」类型节点并双向绑定（`actionNewConnectionNode` + `calculateFixedPointForNonElbowArrowBinding`）。
- **T12 线身弯折与平行避让**：线身弯折用原生点编辑（双击进编辑、拖线身加点）；平行线避让移植 staggerParallel 思路（同起讫点第 n 条线中点沿法线错开 46px，打标时应用）。
- **T13 隐藏失败方案**：`renderElement.ts`/`collision.ts` 对 dm.hidden 的 edge 不渲染/不命中（数据保留）；`actionSetFailedEdgesHidden` + `DotMapViewSync` 联动开关。
- **T14 便签元素**：黄底 rectangle（#fff3c0/#efdf7a）+ bound text + id 哈希微旋转（±1.2°）；M 工具点节点/线即创建（T15 避让定位）。
- **T15 自动避让**：`dotmap/annLayout.ts` 移植 annScore 打分（障碍物=线采样点+节点圆+已摆放便签；节点标注 8 方向候选右侧优先、线标注法向 28px 外移）；手动拖动微调为 Excalidraw 原生；双击复位与「小尾巴」归属暂未实现（记差异）。
- **T16 标注管理**：面板「标注」列表（隐藏/删除）；全局「显示标注」开关（dm.hidden 模式）；`setAllAnnotationsHidden/setAnnotationHidden/deleteAnnotation` action。
- **T17 路线数据与标签**：`dotmap/routes.ts` 路线注册表（jotai）+ 路线名标签（routeLabel：首节点上方 30px 紫色低强调、双击改名）；「显示路线名称」开关。
- **T18 所属路线与升级**：面板「所属路线」下拉列出全部路线（无/路线列表/重命名提示）；「升级为问题路线」= 节点变问题类型（虚线）+ 建分支路线N + 直连方案与对端归入 + 重复升级拒绝。
- **T19 删除级联**：`actionDeleteSelected.tsx` 加级联——删除节点时指向它的线解绑变灰悬空（pending）、从它出发的线随删；框选批量删除同语义；`selfHealOrphanTexts` 清理孤儿 label。
- **T20 交互细节**：隐藏原生「选定形状操作」浮动面板（属性由右侧面板管理）；光标/平移/缩放/框选/适应视图为 Excalidraw 原生；撤销重做覆盖 customData（action 管线）。
- **T21 界面外壳**：左上项目 pill（主菜单）、右下 Agent 入口占位（toast）、设置/文件操作占位 toast、footer 裁剪（去 EncryptedIcon）。
- **T22 示例数据**：`dotmap/demoScene.ts` `buildDemoScene()`——首次空场景自动注入示例地图（4 节点/问题路线+紫色标签/三态 6 线/平行线 2 条/便签 2 个）。
- **与原型的主要差异（记设计细节）**：线身弯折交互（Excalidraw 双击进编辑 vs 原型按住弯折）；便签无「小尾巴」与双击复位；自定义属性面板为浮层（brand-spec「按需滑入」）；方案名标签位置由 Excalidraw 定位（线中上方）。

## 走查工具链（第 7 轮起）

- **原型解冻**：用户反馈仍有细节体验问题，冻结暂缓，继续按「记入 `设计细节.md` → 改 canvas.html → 截图验证 → 提交」迭代。
- **截图产物**：`走查截图/` 目录，已加入 `.gitignore` 不进仓库。
- **headless Chrome**（无交互、纯视觉）：`chrome.exe --headless=new --screenshot=<绝对Windows路径> --window-size=1600,1000 <url>`；注意 `--screenshot` 必须用绝对 Windows 路径（相对路径+中文会写盘失败）。
- **Playwright MCP**（可交互，opencode 会话自带）：`playwright_browser_*` 工具（navigate / snapshot / click / type / take_screenshot 等），可直接打开 `file://` 或本地服务器页面；交互后截图落盘到 `走查截图/` 供 `see` 技能识别。
- **本地服务器**（可选）：`node 走查截图/serve.cjs` → `http://127.0.0.1:8123/canvas.html`（CommonJS 必须 `.cjs` 后缀——上级目录 package.json 是 `"type":"module"`）。
- **弃用记录**：Kimi WebBridge 实测后被弃用（用户反馈太慢），已用其官方 `uninstall` 命令卸载 daemon 并删除 `~/.kimi-webbridge` 与三个 skill 目录（kimi-code/claude/codex）；浏览器里的 WebBridge 扩展需用户在 chrome://extensions 手动移除。

### 阶段 2 修复轮（2026-08-06 第二轮，Kimi）

> 承接 deepseek 走查问题清单（`设计细节.md` W1–W14），全部修复并 Playwright 实测销号。要点：

- **W7 响应式隐藏**：`dotmap.ts` setEdgeStatus 收口处按 showFailedEdgesAtom 同步 dm.hidden；面板 setElementDm 同规则；删除级联清 hidden 残留。
- **W8 便签**：新增 `dotmap/annTail.ts`（黄色小三角楔，挂 staticScene 渲染）；`annLayout.ts` computeAnnPosition 改为传入实测文本宽高、返回左上角；创建即编辑（DotMapTools.editNewAnnSoon 调 public 化的 app.startTextEditing）；双击复位（App.tsx pointerup 本地双击判定，actionResetAnnPosition）；bound text 存储坐标用 computeBoundTextPosition 置中（修命中检测）。
- **W9/W10**：分支路线编号取已有最大值+1；新增 `routes.ts` rebuildRoutesRegistry 在 excalidraw-app onChange 持续重建内存注册表（修刷新后丢名/重名）；节点显示名去零填充。
- **W11–W13**：HintViewer arrow 分支改原型文案；renderTopRightUI 置空；vite.config.mts 关 checker overlay（左下橙色徽章=dev 工具徽章非应用 UI）。
- **面板**：RoutePicker trigger 单行不换行（nowrap + 对称 bleed）；标注隐藏/删除往返实测通过。
- 未提交 git；改动均在 wip-stage2 工作区。


## 路线修正：否决 fork，回 HTML 路线（2026-08-06，Kimi）

- **决策**：用户否决阶段 2 的 fork 路线。理由：底层要做自定义的人机共享记忆格式（map.json + Markdown 分片），Excalidraw 数据模型与架构构成约束；组件复用收益不抵改造成本。fork 作为阶段 2 可行性验证收尾，仅作参考实现保留。
- **存档**：fork 本地原为浅克隆导致推送失败，`git fetch origin --unshallow` 补全完整历史后，master（干净基线）推送至 GitHub 私有仓库 `hhh-dahah/live-dot-map-canvas`；`wip-stage2`（deepseek T1–T22 + Kimi W1–W14 修复，提交 `f3891a3`）仅保留本地，不推送。
- **新阶段 3**：计划见 `docs/plans/2026-08-06-阶段3-协议层与HTML正式化.md`。要点：协议层先行（map.json v1 + Agent 协议段 + 壁纸项目 `E:\壁纸制作` 迁移狗粮）；产品本体为 `app.html`（从冻结样板 canvas.html 复制起步），File System Access API 读写项目文件夹 + 2s 轮询自动同步 + 编辑防抖原子落盘；200 节点/400 线压测实证性能。
- **文档同步（A1）**：goal.md 阶段 2 改写为「已完成，路线否决并存档」、阶段 3 更新；PRD §9.1 文件结构定稿 map.json、§11.1 改自研单文件 HTML、§11.2 改许可与分发、§11.4 发布形态更新、§15 P0 首条与 §16 现状更新；AGENTS.md 当前阶段与红线同步。


## 阶段 3 执行：协议层（A1–A4，2026-08-06，Kimi）

- **A1 文档一致性**：goal/PRD(v2.2)/implement/AGENTS/设计细节 全部从 Excalidraw 路线改自研 HTML 路线；另按验收样板修三处 PRD 矛盾——§5.4/§8.3 解耦措辞与原型「吸附变绿/脱钩变灰、手动切状态不动连接」行为对齐（走查 5/6/10）；§8.2 节点类型由「两类」改回「目的/问题/结果」三类可自定义（deepseek 阶段 2 修订引入的错误）。
- **A2 `docs/map-json-v1.md`**：map.json v1 schema（routes/nodes/edges/anns + meta/counters/ui/view；时间戳天级供停滞检测；`shelved` 表达「勿再提议」；写入规则含删除级联/改名同步/长度约束；示例用 PRD §13 案例建模）。
- **A3 `docs/agent-protocol.md`**：贴入项目 AGENTS.md 的协议段——会话开始铁律（读 map.json 主动输出地图摘要：主路线位置/pending 清单/停滞路线/建议下一步）、干活后同步、语义规则、安全边界、迁移四步。
- **A4 壁纸项目迁移（狗粮）**：explore 子代理通读 `E:/壁纸制作/PROJECT_STATUS_AND_ACCEPTANCE.md` 689 行提取 → 生成 `E:/壁纸制作/map.json`（9 路线/20 节点/60 方案线/24 标注；pending 全部显式化并挂等待原因标注；已排除平台 failed+shelved；md 链接挂现有文档不新建内容文件）；`E:/壁纸制作/AGENTS.md` 追加协议段。迁移为草稿，待用户在画布审核。

## 阶段 3 执行：app.html 正式版（B/C，2026-08-06，Kimi，提交 4fb3c1b）

- **B 文件 IO**：`app.html`（自 canvas.html 复制起步，1924 行）接入 File System Access API——`showDirectoryPicker` 打开项目文件夹、IndexedDB 记句柄（刷新后 queryPermission 自动重连）、无 map.json 时确认创建；编辑经 `scheduleSave()` 防抖 800ms 用 `createWritable` 原子写回；2s 轮询 `lastModified` 自动重读外部改动（Agent 改 map.json → 画布自动刷新）；降级路径：不支持的浏览器用导入/导出（动态 input + Blob 下载，Ctrl+S）。左上 pill 圆点三态（未连接/保存中/已同步）。启动参数 `?blank=1`（空白）、`?stress=N`（N 节点 +2N 边压测数据）。
- **C 编辑落盘与 md 分片**：节点/边右键菜单与面板「打开 Markdown」接通 `openMd()`——连接文件夹时读 `md` 路径文件，读不到确认后创建（带标题模板），内置查看器展示；改名同步 md 路径（原型原有逻辑保留）。项目菜单改真实功能（打开项目文件夹/新建空白/导入/导出）。新建空白地图在连接中需确认覆盖，并写入 main 路线日期字段。
- **顺带修遗传 bug**：canvas.html 的撤销栈只存前态，导致「最新一步无法重做」（走查实测 a4 重做后丢便签）。改标准双栈（undoStack/redoStack，上限 200 步），重做任意深度完整恢复。
- **走查（Playwright MCP，截图在 走查截图/阶段3-*）**：加载零报错；导入 `E:/壁纸制作/map.json` 精确渲染 20 节点/60 边/9 路线/24 便签并自适应缩放；L 拉线悬空灰 → 拖端点吸附变绿；M 便签、右键菜单、面板切三态、隐藏失败过滤、撤销重做、导出下载逐项通过。
- **压测结论**：平移/缩放走 `applyView()` 纯 CSS transform，任意节点数 60fps；全量 `render()`（拖拽节点等数据变更）200 节点约 24ms/帧（~40fps）、400 节点约 50-64ms/帧（~15-20fps）。真实项目体量（数十节点）流畅；超大图的增量渲染优化记入后续候选。
- **待人工手测**：FS Access 文件夹直连与轮询同步无法自动化（需真实用户授权手势），留给用户在 Chrome/Edge 实测「打开项目文件夹 → 连 E:/壁纸制作 → Agent 改 map.json 后画布 2s 内自刷新」。


## 阶段 4：记忆生命周期——路径 A（2026-08-07，Kimi）

- **背景与决策**：用户质疑单层 JSON 索引能否支撑长程任务与非二元评价（60/70/80 打分）。研读 HippoRAG / Generative Agents / Sleep-time Compute / MemoryBank / Zep 等记忆系统研究后，产出三条演化路径（A 单图深化 / B 双层记忆 / C 事件溯源），用户选定 **A：给共享地图补记忆生命周期**（评分/归档/投影读取/整理例程/创新循环），不动人机共享基底。研究报告与决策记录见 `docs/plans/2026-08-07-记忆系统演化路径研究.md`。
- **schema v1.1**（`docs/map-json-v1.md`）：edges 增 `score`（0–100 可选，人打或 Agent 建议人确认，不做自动评分）与 `archived`（归档≠删除：不进投影、画布弱化、数据保留）；routes 增 `archived`；新增「投影读取（中图模式）」节（节点 ≥100 时只读四块：主路线链/未归档 pending/停滞路线/各路线一行摘要）。`version` 仍为 1（可选字段前向兼容）。
- **协议 v1.1**（`docs/agent-protocol.md`）：新增三节——投影读取（archived 不进投影，细节按 md 指针下探）、整理例程（合并冗余/低分停滞建议归档/走通绿线建议沉淀 skill/重算路线摘要；只归档不删除，归档前逐条等用户确认）、创新循环（结构空隙检查：停滞复活/高分迁移/路线交叉/低分方向替代路径，只提 1–2 条且引用具体 id）。语义规则补 score 与 archived。
- **app.html**：面板方案分支加「评分」数字输入（0–100，留空未评）与「归档/取消归档」按钮；画布方案名旁渲染 score 徽标（--muted 小字，避开绿红灰状态色）；归档线（自身或所属路线归档）线身 opacity .28、标签 .45、悬停命中跳过；serialize 整对象拷贝天然落盘新字段，无需改 IO。
- **走查（Playwright，截图 走查截图/阶段4-*）**：评分输入 → 徽标渲染 → 归档弱化/悬停跳过 → serialize 含 score/archived → 恢复演示状态，逐项通过；console 零报错（仅 favicon 404）。
- **壁纸狗粮**：`E:/壁纸制作/map.json` 补 19 条绿线 score（v17 底座 95、S3 overlap16 90、一键18秒 90 等，按验收记录定分）；归档 8 条 failed+shelved 死方案（规划器落选模型 3 条 + 已排除发布平台 5 条），供 Codex 新会事实测投影读取与整理例程。
- **未做**：路线级归档暂无画布入口（路线不是可选中对象），由 Agent 按协议置 `routes[].archived`，画布渲染已支持。


## 阶段 5：分发与上手工程（2026-08-08，Kimi）

- **红线解除**：用户明确「单文件零依赖」不再硬约束，允许为分发/上手增加外挂工程文件。AGENTS.md 红线与 PRD §11.1 已同步改为「本体保持单文件零依赖（双击即用），新增第三方依赖前需在 implement.md 记录理由」。
- **A 首次引导**：app.html 首访弹引导卡（三步说明 + 三分钟教程 + 加载演示地图）；演示模式首次编辑弹一次性 toast「改动只在本页，连接文件夹或导出才能保存」（S5-1）；人话报错。
- **B agent-kit 接入包**：`agent-kit/`（AGENTS.snippet.md 协议段 / map.template.json 空模板 / README→index.html 说明页），用户让 Agent「读 agent-kit 接入」即可一次性配好。
- **C Cloudflare 部署**：Pages 令牌无权限走不通，改 Workers Static Assets——`wrangler.toml`（name=app、assets=./.deploy、workers.dev 子域 live-dot-map），部署到 `https://app.live-dot-map.workers.dev`；OAuth 设备码四次超时，最终用户注册后直接给 API Token 打通。凭证存仓库外 `~/.live-dot-map/cloudflare.env`，.gitignore 加 `*.env` 兜底。按 Cloudflare 官方 agent-setup 接入（mcp.json 加 5 个远程 MCP 服务器、.agents/skills 装 skills）。
- **D PWA**：manifest.webmanifest + sw.js v2（HTML 网络优先 + 静态资源缓存优先，修掉 v1 缓存不更新 S5-2）+ icons/ + favicon.ico（由 icon-192 生成）。
- **走查修复清单**（截图 走查截图/阶段5-公网-*）：标题残留「动态壁纸」→「活点地图」；favicon 404；设置抽屉演戏内容→诚实接入指引（S5-6）；删「交给 Agent」假模拟器（S5-7）；「自动整理」菜单文案改指向整理例程；agent-kit md 公网乱码→_headers 按扩展名分流 + agent-kit/index.html 说明页（S5-8，公网待下次部署生效）。
- **用户决策**：公网部署暂停（产品本地优先，本地问题未走查完）；landing page 重写为下一阶段。

## 阶段 5.5：landing page 重写（2026-08-08，Kimi）

- **目标**：Excalidraw Plus 式简洁落地页——产品图 + GIF 演示位（留空）+ 一键复制接入协议/口令，帮助用户一次性配好 Agent 接入。用户明确：先不部署，landing 本地用（双击即开）。
- **结构**：导航 → Hero（标题「给 YES 工程师与 TA 的 Agent 的行车记录仪」为用户指定文案，副标题「人机共享的探索地图：人看画布，Agent 读 map.json」，产品图 `assets/landing-hero.png` 为 app.html 演示地图实拍）→ #join 三步接入卡（①复制协议段 ②一键复制口令「把 agent-kit/AGENTS.snippet.md 的内容追加到我的 AGENTS.md 末尾」③打开画布连文件夹）→ 功能演示三张 GIF 虚线占位卡（建节点拉方案线/便签评分归档/与 Agent 共享一张图，待用户自录）→ 本地优先说明 → 底部 CTA → 页脚。
- **复制双通道**：`getSnippet()` 先 fetch `agent-kit/AGENTS.snippet.md`，file:// 失败回退页内 `<script type="text/plain">` 内嵌副本（83 行逐字同步，页内有注释提醒改协议时手动同步）；统一 CRLF→LF 归一；clipboard API + execCommand 兜底。实测 http 剪贴板内容与源文件逐字相等（归一后 2586 字符），file:// 回退路径比对一致。
- **过时内容修正**：底部 CTA 由 canvas.html（冻结样板）改指 app.html；目录树旧设计改 map.json 现行契约（map.json/nodes/routes/AGENTS.md）；页脚删「由 Excalidraw 改造」声明；去掉空 GitHub 链接（仓库暂无远程）。
- **验证（Playwright，截图 走查截图/阶段5-landing-*）**：桌面 1440px 与手机 390px 渲染正常无横向溢出；复制/口令复制精确；agent-kit 三个下载链接与 app.html 均 200；hero 图加载成功；node --check 通过。

## 阶段 6：公网部署与一句口令接入（2026-08-09，Kimi）

- **计划**：`docs/plans/2026-08-08-阶段6-公网部署与一句口令接入.md`（用户确认后执行）。核心形态：双点部署（Cloudflare 主 + CloudBase 国内备用）+ 多源下载兜底 + 数据目录收进 `.live-dot-map/` + 一句口令全自动接入。skill 包装/插件商店/自有域名/E2E 加密等明确暂缓，理由与重启条件记入 PRD §15「远期构想」。
- **数据目录约定（T1）**：`map.json` 与 Markdown 分片从项目根迁入 `.live-dot-map/`（项目根只留 AGENTS.md 等自有文件）。`docs/map-json-v1.md` 头部加目录约定说明、示例与改名规则全部加前缀；`docs/agent-protocol.md` 同步并新增「画布程序位置」一节（`~/.live-dot-map/app.html`，用户说「打开画布」时 Agent 直接拉起）；`agent-kit/AGENTS.snippet.md` 整文件重新生成；landing.html 页内内嵌回退副本逐字同步。app.html `attachDir` 改三级逻辑：优先 `.live-dot-map/map.json` → 兼容根目录旧 map.json → 都没有则在 `.live-dot-map/` 新建。壁纸狗粮项目已迁移（`E:/壁纸制作/.live-dot-map/map.json`；md 字段全指向项目现有 docs/，不动），其 AGENTS.md 协议段换新（保留「md 挂现有文档」变体）。
- **拖拽导入（T2）**：app.html 画布支持把 map.json 文件直接拖入加载（对齐 ComfyUI 拖 workflow 体验）：dragenter 深度计数防高亮闪烁、`.json` 扩展名与 version 校验、失败 toast 不动原图、成功走 importMap 同款流程。Playwright 实测：高亮正常、导入后标题变「活点地图 — tmp-e2e」、节点正确渲染。
- **setup.md 全自动接入（T3）**：新增 `agent-kit/setup.md`——给 Agent 看的接入指引：双源下载兜底（CF → CloudBase → PowerShell/wget → 报告）、装到 `~/.live-dot-map/`（下载后校验 doctype 防代理错误页）、PowerShell COM 建桌面快捷方式（`[Environment]::GetFolderPath('Desktop')` 防 OneDrive/自定义重定向——实测本机桌面在 `D:\桌面`，验证了这一防护的必要性）、项目侧建 `.live-dot-map/`、AGENTS.md 无「活点地图」标记才注入协议、初始化地图（有记录走迁移四步/没有用模板）、拉起画布、交代用户点「打开项目文件夹」（唯一手动步）。铁律：每步失败停下报告，不静默跳过。
- **landing/说明页/README 同步（T4/T5）**：landing 加「下载画布」按钮（Hero + .dls 区）；接入口令改双源版（`curl -sL …/agent-kit/setup.md`，失败换 CloudBase 源）；卡 2 说明改「Agent 全自动完成」清单；本地优先目录树改 `.live-dot-map/` 结构；agent-kit/index.html 与 README.md 同步新流程。
- **双点部署（T8/T9）**：`.deploy/` 重建（landing 为 index.html，新增 assets/）→ CF Workers 部署成功（`https://app.live-dot-map.workers.dev`，env 文件需 `set -a` 导出，纯 source 不会导出变量给子进程）；同内容（除 `_headers`）13 个文件上传 CloudBase 静态托管（test 环境，ap-shanghai）。
- **双点走查（T10，Playwright）**：CF 全绿——landing 渲染、口令逐字正确、5 个下载链接、app.html/agent-kit 三件套/assets/favicon 全 200、桌面与 390px 无横溢、hero 图加载。CloudBase：全部文件 curl/fetch 200 且字节正确（Agent 下载源职责达标），但浏览器直接导航 HTML 会被腾讯默认域名拦截返回 404「风险提醒」——CB 只作 Agent/口令的下载兜底，人访问一律用 CF 网址。
- **端到端新用户模拟（T11）**：建临时项目照 setup.md 真跑——本机两个源 curl 均 200（Clash 未拦这两个域名）；画布装进 `~/.live-dot-map/`（app.html 108530 字节 + favicon.ico）；桌面快捷方式真实落盘 `D:/桌面/活点地图.lnk`；项目侧 `.live-dot-map/map.json`（模板改名+当日日期）与 AGENTS.md 协议注入完成并校验；画布已通过 `start ""` 真实拉起。唯一未自动化项：「打开项目文件夹」需用户手势（浏览器安全限制，设计如此），待用户在壁纸项目实测。
- **收尾（T12）**：设计细节.md 销 S5-3（裸跳转页 → landing 双点首页）；PRD §15 新增「远期构想（已讨论，明确暂缓）」（E2E 加密/分享协作/网页内嵌 AI/skill 包装与商店/自有域名，含 E2E 与内嵌 AI 的矛盾提示与重启条件）；旧文档 `docs/活点地图-AGENTS指针段.md`、`docs/活点地图-SKILL.md` 经查已不存在于仓库（无 git 记录），无需标记。
