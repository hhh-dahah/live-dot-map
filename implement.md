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
