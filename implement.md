# implement.md — 执行与修改过程记录

> 用途：追加式日志，记录重大执行与修改过程，以及当前原型的实现要点。
> 走查发现的问题与正式版期望行为记 `设计细节.md`；阶段路线与边界记 `goal.md`。

## 时间线

- **Windows 图形化安装器候选（2026-08-12）**：新增独立 `installer/winforms/`。`LiveDotMapSetup.exe` 是 .NET 8 自包含 WinForms 入口，payload 复用现有 Windows x64 Node SEA 与 `app.html`，先逐文件 SHA-256 校验，再仅安装到 `%LocalAppData%\\LiveDotMap\\current`（`asInvoker`、不请求管理员权限）。用户在 GUI 选择项目文件夹后，入口调用 SEA 的既有 `install` 与 `serve`：地图和 Agent 配置仍只写所选项目。`scripts/build-windows-installer.mjs` 生成 payload/installer 两份 manifest，`verify-windows-installer.mjs` 加 UI Automation 门禁校验窗口、按钮、项目 map 初始化与桥启动。该产物明确是未签名内部 RC 候选；升级/卸载 UI、干净机与 Store/MSIX 验收仍未完成，公开交付门禁不勾选。

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

## 阶段 6.5：国内直连推进（EdgeOne + 域名，2026-08-09，Kimi）

- **GitHub 仓库**：`.deploy/` 从 .gitignore 放出入库（提交 e25d74b）→ 建私有仓库 `hhh-dahah/live-dot-map` 并 push（gh CLI，token 含 repo scope）。此后 push master 即触发 EdgeOne 自动部署；CF/CB 仍需手动重部署，此不对称须留意。
- **EdgeOne Makers（ Pages 国内版）**：控制台建项目 live-dot-map（ID makers-1tej2m1r9pnc），连 GitHub 仓库 master、输出目录 `.deploy`、无构建命令，首次部署 22s 成功。**但默认域名 `*.edgeone.cool` 不可用**：官方文档实锤——含大陆区域的默认域名只有 3 小时临时预览（过期 401），「全球不含大陆」的默认域名中国大陆一律 401。结论：必须绑自定义域名；绑「全球（不含中国大陆）」区域的自定义域名**免备案**。
- **域名决策记录**：候选 dotmap.site/.top、livedotmap.com/site 均被否。先尝试 Cloudflare 买 livedotmap.com（$10.46/年，注册续费同价，Playwright 已登录推进到结账页），因用户外币卡支付反复失败放弃。改腾讯云：livedotmap.xyz 15 元首年但续费 450（坑）、.shop 15/328（坑）排除；**选定 livedotmap.top（首年 14 元、续费 32 元，可注册）**。域名主体选个人（薅羊毛看账号认证不看域名主体；个人审核快；以后可过户公司）。
- **当前阻塞**：腾讯云要求先建实名信息模板（个人身份证），审核 1–3 天——后台等待，不阻塞其他工作。审核通过后：付 14 元 → EdgeOne 加速区域改「全球（不含中国大陆）」→ 绑 livedotmap.top → DNS 加 CNAME → 国内关代理直连实测（核心验收点，不通过则退回讨论）。
- **双源口令定稿核验（E7）**：现有双源（CF 主 + CB 备）逐字节核验——本地 landing.html==.deploy/index.html，CF 与 CB 的 index.html/app.html/agent-kit/setup.md 均与本地 .deploy 一致，无需重部署。一句口令与 setup.md 双源兜底已是最终形态，等域名就绪后再把 EdgeOne 加成第三源。
- **域名购买与实名（E4，2026-08-10）**：个人实名模板审核实际半天内通过。腾讯云购入 **livedotmap.top**（首年 14 元，续费 32 元，自动续费 9.5 折已开，到期 2027-08-10，DNS 在 DNSPod）。.top 命名审核约 1 小时内转「正常」。
- **旧项目删除重建（关键决策）**：旧 EdgeOne 项目 makers-1tej2m1r9pnc 创建时选了「全球可用区（含中国大陆）」，绑域名时实锤拦截「检测到当前域名未在工信部备案」；且项目设置里**没有**改加速区域的入口。决策：删旧重建，不备案。新项目 **makers-ugpb5ho04k2s**（live-dot-map）：连 GitHub `hhh-dahah/live-dot-map` master、加速区域**全球可用区（不含中国大陆）**、输出目录 `.deploy`、无构建命令，首部署成功（dp293jvckok2）。
- **绑域名与 DNS（E5）**：添加自定义域名 livedotmap.top（关联生产环境）→ 归属权验证：DNSPod 加 TXT `edgeonereclaim` = `reclaim-c3snp6d1tebekodo2mfeu9t33qrp8did`，验证通过 → 拿到 CNAME `livedotmap.top.pages.dnsoe6.com`，DNSPod 加 `@` CNAME → 域名状态「已生效」→ HTTPS 配置选「申请免费证书」，几分钟内签发完成。注意：DNSPod 独立控制台（console.dnspod.cn）在本机渲染空白，从腾讯云域名控制台「解析」入口进 `console.cloud.tencent.com/cns/detail/<域名>/records` 正常。
- **验收（E6）**：DoH 验证 DNS 全链路生效（CNAME → 43.174.247.110/246.110）；11 个关键路径（`/`、`/app.html`、agent-kit 四件、assets、PWA 三件、favicon）HTTPS 全 200；`app.html`/`setup.md`/`AGENTS.snippet.md` 与本地 `.deploy` 逐字节一致；Playwright 开 landing 渲染正常无中间页。**用户关代理实测：1 秒打开，速度可接受——国内直连目标达成**。两个本地坑记录：①本机 Clash fake-ip 会污染 nslookup（workers.dev 被 GFW DNS 投毒解析到 facebook IP），验证须用 DoH（223.5.5.5/resolve）+ `curl --resolve --noproxy '*'`；②curl schannel 报 CRYPT_E_REVOCATION_OFFLINE 是吊销检查走不通，加 `--ssl-no-revoke` 即可，非证书问题。另实测：workers.dev 在国内裸连完全不可达（TCP 超时）——印证了 livedotmap.top 作首选源的必要性。
- **三源定稿（E7b）**：源表升级为 **A `https://livedotmap.top`（首选，国内直连+海外）→ B `https://app.live-dot-map.workers.dev`（海外/代理）→ C `https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com`（国内兜底）**。`agent-kit/setup.md`（源表 + curl 三级兜底链 + PowerShell 注释）、landing `#prompt-text` 口令、`agent-kit/index.html`、`agent-kit/README.md` 同步三源版；`.deploy/` 同步后 CF（wrangler deploy，4 个变更文件）与 CB（manageHosting 上传 4 文件，登录态过期走了一次设备码重授权）重部署完成。CB 新版已核验（含 livedotmap.top）；CF 国内裸连不可达无法本机核验，以 wrangler 上传清单为准（用户挂代理时可自行抽查）。

## 文档分层整理（2026-08-10）

- `AGENTS.md` 重写为约 20 行的路由入口，仅保留文档索引、产品文件边界和长期红线；移除阶段流水账、部署细节及 DeepSeek/Kimi/opencode/ShareX 等工具专属要求。
- `goal.md` 将阶段 3–6.5 收敛为里程碑结论，并把当前工作指向真实用户实测与落地页演进。
- 后续重大方向与阶段状态更新 `goal.md`；具体执行、验证和历史事实追加到本文件；不再向 `AGENTS.md` 堆积项目日志。

## v2 上线候选执行记录（2026-08-12，Codex）

- **P0 协作链**：本地桥的唯一 `ProjectStore` 增加外部 `map.json` revision 轮询和 SSE 通知；独立 MCP/Hook 进程写入后，已打开画布在 2 秒内刷新。断线重连会从最新 revision 恢复。`src/bridge/project-store.mjs`、`src/bridge/server.mjs`、`src/cli/livedot.ts`。
- **画布**：撤销/重做进入同一保存路径；首次空地图提供“空白开始 / 简单示例 / 让 Agent 初始化我的项目地图”，初始化入口只有用户点击后才会触发；桥异步加载已有项目地图时自动收起引导，避免第一次标注被遮挡。Agent/人类里程碑以大卡显示来源、层级和状态。
- **协议**：v2 对象维护创建/更新来源；Agent 批量对象、新节点和里程碑数量有服务端上限；Agent 里程碑保留 `origin`/`createdBy`，不得伪装人类创建；`map_next_candidates` 统一支持当前节点、limit、历史开关，并返回来源和关系路径。
- **里程碑语义纠偏**：按产品规则，Agent 可以把自己创建或更新的里程碑设为 `approved`；服务端只禁止伪造 `human_created`/人类身份和 `work` 级碎片，不再把 `approved` 错当成人类专属动作。画布继续显示来源、创建者、更新者和证据。
- **接入与小白降级**：安装器按 PATH/项目配置只发现真实 Agent；doctor 按实际安装项检查。桌面快捷方式不可写或 PowerShell 失败时，项目 `.live-dot-map/` 中生成可用 `.cmd`，结果明确标注降级。新增 `verify:installer`。
- **发布准备**：统一 `npm run verify`、`verify:core/web/agents/installer/release`；构建 `.deploy` 并检查 CSP、运行时、协议包、版本与 hash。新增 `LICENSE`、`NOTICE`、`SECURITY.md`、`README.md`。当前只生成可审计 RC 产物，不进行生产部署、GitHub 发布或 Microsoft Store 提交。
- **自动验证证据**：`npm test` 66/66；三浏览器强模式 bridge E2E 4/4（Chromium/Firefox/WebKit 保存与 XSS）；Chrome/Edge 降级与 undo/redo 通过；三适配器模拟闭环通过；安装器降级入口与部署产物检查通过；`node --check livedot.mjs` 通过。
- **仍需用户完成**：在全新 Codex、Claude Code、Kimi Code 客户端各确认一次 Hook/MCP 信任并跑真实模型闭环；WorkBuddy 尚未做真机生命周期验证；干净 Windows 安装/升级、Store/MSIX 或 GitHub Release 尚未发布。因此本记录不把项目标记为正式公开版，只推进到受控人工 RC 验收准备阶段。
- **总门禁复跑**：`npm run verify` 全部通过（核心 66 项、三浏览器强模式、Chrome/Edge 降级、性能、三适配器进程级闭环、安装器快捷方式降级、部署产物与 hash/SBOM 检查）。最新 `.deploy` 已重新生成并与源安装器同步；`canvas.html` 工作树 hash 与 `HEAD` 一致。

## 上线计划旁路更新（2026-08-12，Codex）

- `docs/plans/8-12上线plan.md` 已更新为“执行中”：分发准备与开发/测试并行，SEA、MSIX、Partner Center、线上 200/hash 和代码签名不再作为本地桥、画布、协议或自动测试的前置条件；未完成的真实分发门禁仍不得伪装为普通用户下载版。
- 初始地图协议新增服务端硬上限：Agent 首次初始化最多 15 个活跃节点，超过后返回 `AGENT_INITIAL_MAP_LIMIT`，并在 `ui.initialization.status=in_progress` 记录初始化状态；`docs/agent-protocol.md`、`agent-kit/` 与 `.deploy/agent-kit/` 已同步。
- 新增并通过初始化上限单测；当时 `npm test` 为 **67/67**，随后完整 `npm run verify` 通过（浏览器、性能、三适配器进程级闭环、安装器降级、发布 manifest/SBOM/hash）。`canvas.html` hash 仍与 `HEAD` 一致。
- 分发当前仍是 RC 准备：无 Node WinForms Setup 已生成并完成本机 UI E2E，但没有做干净机升级/卸载、线上发布、GitHub Release 或 Microsoft Store 提交；这些只阻断公开下载，不影响继续开发和受控人工验证准备。

## 上线前本地收尾复验（2026-08-12，Codex）

- **图形化连接状态**：本地桥新增认证 `GET /api/v1/agents`，按实际 PATH/项目配置返回 `not_installed / discovered / awaiting_trust / connected / error` 五态；`app.html` 设置抽屉只用文本节点显示状态，并提供重新检测按钮。三浏览器强模式 E2E 均验证 3 个 Agent 状态行，未把未确认信任伪装成已连接。
- **安装事务**：安装前逐文件保存配置/运行时快照，写入失败恢复原文件；卸载只恢复仍由安装器拥有的文件，跳过用户后续修改，始终保留 `.live-dot-map/map.json`。`tests/agent-kit/installer.test.mjs` 的失败安装回滚、原 Codex 配置恢复和地图保留均通过。
- **Windows SEA**：新增 `scripts/build-sea.mjs`，在 Windows x64 生成无 Node 依赖的 `.deploy/livedot-bridge-win-x64.exe`；SEA 模式下 MCP、Codex/Claude/Kimi hooks 不再携带错误的 `.mjs` 参数。临时项目 install → hook → doctor 冒烟通过，doctor 正确跳过 SEA 的项目运行时文件检查。该 exe 是内部 RC 桥，不等同于普通用户 Setup/Store 安装包。
- **门禁复跑**：`npm test` 70/70、`npm run verify:web` 21/21、`node --test tests/e2e/bridge-browser.mjs` 1/1、`npm run verify:agents` 14/14、`npm run verify:release` 通过；串行化 `scripts/verify.mjs` 的浏览器步骤后，`npm run verify` 全部通过。最新发布清单包含 app、livedot.mjs、agent-kit 三件套、SEA exe、SBOM 与 SHA-256。
- **线上与分发边界**：本次只生成和校验本地 RC 物料，没有发布线上、创建 Release、提交 Store 或购买代码签名。此前线上关键入口仍是旧版 app，`livedot.mjs` 曾返回 404，因此线上 200/hash 门禁继续保持未勾选；分发旁路不阻断开发、自动测试或后续人工审查。
- **WinForms Setup 实证**：新增 `installer/winforms/` 自包含 .NET 8 WinForms 安装器和 `scripts/build-windows-installer.mjs`；`npm run verify:windows-installer` 构建出 161,623,543 字节的 `dist/windows-installer/LiveDotMapSetup.exe`，payload 逐文件 SHA-256 校验通过，`app.manifest` 为 `asInvoker`。Windows UI Automation 实测窗口出现、按钮可见并点击“安装并开始使用”，临时项目生成 `.live-dot-map/map.json`，SEA bridge 进程启动成功；现已纳入 `npm run verify`。这是未签名内部 RC，不宣称已完成公开分发。
- **WinForms 维护入口补齐**：安装器新增“修复 / 更新”和“卸载（保留地图）”。更新先复制到临时目录、重新校验后原子切换并在失败时恢复旧目录；卸载先调用 SEA 恢复安装器拥有的 Agent 配置，再安排删除程序和开始菜单入口，保留项目地图、Markdown、历史和备份。UI Automation 额外断言两个维护按钮存在；公开分发仍需干净机人工升级/卸载、签名和 Store/Release 门禁。
- **上线计划全量复验（2026-08-12）**：`npm run verify` 通过，核心 70/70、浏览器/降级模式三浏览器、性能、三适配器进程级闭环、安装器回滚/doctor、WinForms UI Automation、SEA/release manifest 全部通过；最终输出 `[verify] all gates passed`。WinForms UI 结果包含安装、修复/更新、卸载（保留地图）按钮，临时项目生成 map 并启动 SEA 桥。真实 Codex/Claude/Kimi 客户端、WorkBuddy/CodeBuddy、线上 200/hash、干净机普通小白和公开 Store/Release 仍保持未勾选，不因本地门禁通过而宣称完成。
- **线上入口复核（2026-08-12）**：只读 HEAD 检查 `livedotmap.top` 与 `app.live-dot-map.workers.dev` 的 `app.html`/`agent-kit/setup.md` 仍可访问，但两处 `livedot.mjs` 均为 404，且线上 app 长度仍是旧版（108530 字节，当前 `.deploy/app.html` 已变化）。未执行部署；线上 200/hash 门禁继续保持未勾选，等待明确发布动作与版本绑定。
- **真实客户端重试与测试修复（2026-08-12）**：真实 Codex CLI 通过直接调用 `codex.js` 并显式关闭 stdin，完成 `map_get_context → map_apply_commands → map_ack_human_updates`，持久化节点 `updatedBy=agent:codex`，revision 2。Kimi Code 0.31.1 同一路径重试通过，revision 2；第一次试跑出现客户端输出已成功但文件轮询尚未稳定的瞬态，重试后持久化证据通过。Claude Code 2.1.223 直接 executable 运行仍在 180 秒内无模型输出并被测试超时终止，尚无真实闭环证据。脚本现在保留失败 stdout/stderr，并在 `LIVEDOT_KEEP_REAL_CLIENT_TMP=1` 时保留临时项目以便诊断。
- **首次地图真实入口自动验收（2026-08-12）**：新增 `tests/e2e/first-map-guide.mjs`，Chrome 与 Edge 均验证三个入口顺序、示例 7 个节点、不连接项目桥；点击 Agent 初始化只打开接入抽屉、桥未连接且节点数仍为 0。该项证明产品入口与安全边界，但普通小白的独立可理解性仍留给人工验收。
- **真实客户端试跑**：新增 `tests/e2e/real-client-smoke.mjs` 作为受控手测脚本。Kimi Code 0.31.1 在临时项目完成 SessionStart 标注确认和 Agent 节点写回（revision 3）；Claude Code 2.1.223 能完成标注 ack，但没有执行要求的节点写回；Codex 0.144.1 本次调用未在超时前形成闭环并留下临时目录锁。故三 Agent 清单仍不勾选，模拟进程级 E2E 不能替代真实客户端证据。

## 分发旁路修复（2026-08-12，Codex）

- 推送 `a9da809` 后 GitHub Actions 的 Cloudflare job 真实失败，原因是 `.deploy/livedot-bridge-win-x64.exe` 约 87.7MiB，超过 Workers Static Assets 单文件 25MiB 限制；CloudBase job 按未配置凭证规则跳过，不影响本地 RC。
- 已在 `wrangler.toml` `[assets].exclude` 排除 Windows SEA 桥、SEA 临时文件和 `sea-manifest.json`。Windows 安装器、GitHub RC 物料和 `.deploy` 本地校验仍保留这些文件；网页部署只上传 `app.html`、`livedot.mjs`、`agent-kit/` 和 PWA 静态资源。
- `npm run verify` 在该修复前后均通过（最新一次核心 70/70、浏览器/降级、性能、三适配器模拟、安装器 UI、SEA/release manifest 全部 `[verify] all gates passed`）。等待修复后的 Actions 成功后，再按三源 `200 + SHA-256` 结果更新上线计划，不把“流水线触发”当成上线证据。
- 第二次 Action 证明 Wrangler 3.90 不识别 `[assets].exclude`，仍上传大文件；已撤回该字段，改为 `scripts/build-deploy-runtime.mjs` 自动生成 `.deploy/.assetsignore`，并保留同名构建产物。该路径兼容当前 Action 的 Wrangler 3 回退版本，等待第三次部署验证。
- 第三次 Action（`31594565841`，提交 `cee1c68`）通过：Cloudflare 上传 39 个网页资产并发布成功，CloudBase 因未配置凭证按规则跳过。随后线上核验：`https://app.live-dot-map.workers.dev` 的 `app.html`、`livedot.mjs`、`agent-kit/setup.md` 全部 200，内容 hash 分别匹配当前 `.deploy`；`https://livedotmap.top` 与 CloudBase 仍为旧 app/setup，`livedot.mjs` 404。三源门禁因此保持未勾选，分发侧不阻断开发和自动测试。
- 最终 RC manifest 刷新提交 `a59879f` 的 Actions（`31595079626`）再次通过 Cloudflare 与 CloudBase 分发 job；最新 `npm run verify` 仍输出 `[verify] all gates passed`，工作树保持干净。该次只刷新可追溯构建时间，不改变网页三件套 hash。
- 复核发现 Cloudflare 直链 `/app.html` 返回 307 `/app`（跟随后内容/hash 正确），不满足计划的直返 200 门禁；根因是 Workers Static Assets 默认 HTML canonical handling。已在 `wrangler.toml` 加 `html_handling = "none"`，待下一次 Action 验证直链状态。
- Action `31595443634`（提交 `83e6681`）通过；直链核验结果：Cloudflare `app.html`、`livedot.mjs`、`agent-kit/setup.md` 均 HTTP 200、无 Location 重定向，hash 分别匹配当前 `.deploy`。主站 EdgeOne 与 CloudBase 仍旧版，三源清单保持未勾选。
- **腾讯系适配器（2026-08-12）**：依据 CodeBuddy 官方插件/Hook 文档新增 `.codebuddy-plugin` 与 `.workbuddy-plugin` 双 manifest、`.mcp.json`、`SessionStart/UserPromptSubmit/Stop` hooks、安装器可选探测和图形化信任提示；未发现腾讯系客户端时不污染普通用户的默认三行 Agent 状态。此前只完成协议模拟，真实支持当时未勾选。
- **Claude 真实客户端再诊断（2026-08-12）**：不输出凭据的 API 探针返回 `429 API_KEY_QUOTA_EXHAUSTED`，确认 2.1.223 的 180 秒空转来自当前自定义 API 端点额度耗尽，不是地图桥错误；未修改用户全局 Claude 配置，也不把模拟闭环当真实通过。额度恢复后应重跑 `node tests/e2e/real-client-smoke.mjs claude`。

## 上线计划分发旁路复核（2026-08-12，Codex）

- 更新 `docs/plans/8-12上线plan.md`：将上线前工作明确拆成“产品与协作线”和“分发线”。本地桥、画布、协议、自动测试和受控 RC 不等待 Store、代码签名、EdgeOne 或 CloudBase；分发源失败只阻断对应公开渠道。
- 计划状态同步为：Codex/Kimi 已有真实 CLI 临时项目证据；Claude 因当前自定义端点 `429 API_KEY_QUOTA_EXHAUSTED` 未完成；腾讯系适配器仍为候选包，未宣称真实支持；Cloudflare 三件套已通过 200/hash，EdgeOne 与 CloudBase 仍旧版。
- 本次只改计划与执行记录，没有修改产品代码、安装器、部署产物或用户项目数据。
- 文档校验：`git diff --check` 通过；工作树变化仅为 `docs/plans/8-12上线plan.md` 与本条 `implement.md` 记录。
- 当前 HEAD 复跑 `npm run verify`：核心 **71/71**，浏览器/降级/性能、Codex/Claude/Kimi/CodeBuddy 协议模拟、安装器 UI、SEA、release manifest 与 SBOM 全部通过，最终输出 `[verify] all gates passed`。构建产生的两个时间戳变更已恢复，未新增代码或部署物料差异。
- `npm run verify:online` 复核仍只有 Cloudflare 三件套 200 且 hash 匹配；`livedotmap.top` 的 app/setup 为旧版且 `livedot.mjs` 404，CloudBase 同样旧版且 `livedot.mjs` 404，故线上清单继续不勾选。
- 上线计划新增两级入口：本地自动门禁 + Codex/Kimi 任一真实闭环即可进入项目所有者的受控人工体验；Claude、WorkBuddy/CodeBuddy、三源线上一致性和普通小白流程仍属于正式兼容/公开上线门禁。分发不会阻断人工审查核心协作。
- `后端使用修改/人工体验验收清单.md` 与 `README.md` 同步为当前状态：推荐从内部 RC 安装器开始，明确 Claude 配额、腾讯系真机生命周期、干净机/Store 等仍是外部门禁，不再把已通过的内部 WinForms/SEA 写成“尚未交付”。
- Claude 再做一次不加载用户自定义工具的 `--safe-mode` + 官方 OAuth 试跑，90 秒仍无模型输出后终止孤儿进程；未修改全局配置，不能作为真实闭环证据。
- **CodeBuddy 真实 CLI 闭环（2026-08-12）**：发现本机 WorkBuddy 5.2.3 的内嵌 `CodeBuddy Code 2.106.4`（Windows 注册表 `DisplayIcon` → `resources/app.asar.unpacked/cli/bin/codebuddy`），直接 `--version` 返回 2.106.4，模型最小提示词返回 `OK`。扩展 `tests/e2e/real-client-smoke.mjs codebuddy` 后，隔离临时项目完成真实 `map_get_context` → `map_apply_commands` → `map_ack_human_updates`，人类标注变为 `acknowledged`，节点 `createdBy/updatedBy=agent:codebuddy`，revision=4，测试通过。
- **安装器自动发现修复（2026-08-12）**：`agent-kit/lib/installer.mjs` 新增 Windows WorkBuddy 卸载注册信息探测，不读取凭据、不启动客户端；当前 `detectInstalledAdapters()` 能识别内嵌 CodeBuddy（仅返回 `executableSource=workbuddy-embedded`，不向 UI 泄露本机路径）和 `discovered=true`。浏览器状态列表仍按真实发现动态显示，未安装环境保持三行。
- **回归验证（2026-08-12）**：`npm test` **71/71** 通过；`node --test tests/e2e/bridge-browser.mjs` **1/1** 通过；CodeBuddy 真实 CLI 闭环通过。WorkBuddy 桌面 GUI 的 Hook/MCP 生命周期仍未验证，不能勾选 WorkBuddy 正式支持。
- 推送 `f35624e` 后 Action `31600902395` 成功；等待边缘缓存刷新后，`npm run verify:online` 确认 Cloudflare 三件套均 HTTP 200 且与当前 `.deploy` hash 一致（新 `livedot.mjs` hash=`9a9e64...`）。`livedotmap.top` 仍为旧版且 `livedot.mjs` 404，CloudBase 同样旧版且 `livedot.mjs` 404，线上总项继续不勾选。

### 上线前执行顺序再确认（2026-08-12，Codex）

- 计划明确：内部 RC、源码开发、自动测试和项目所有者的受控人工实测现在即可继续；Store、代码签名、EdgeOne、CloudBase 和公开 GitHub Release 属于并行分发线，不是上述工作的前置条件。
- 产品线下一步只收口 Claude 真实闭环、WorkBuddy 桌面端生命周期和普通小白独立流程；分发源失败只阻断对应公开渠道，不回滚或暂停已通过的开发/测试门禁。
- 本次仅更新 `docs/plans/8-12上线plan.md` 与本执行记录；不修改产品代码、安装器、部署产物或用户项目数据。

### 真实客户端与桌面端复核（2026-08-12，Codex）

- Claude Code 2.1.223 再次执行 `node tests/e2e/real-client-smoke.mjs claude`，180 秒内无模型输出，进程由测试超时终止；没有把失败当成闭环证据，清单保持未勾选。
- 按 `computer-use` 技能启动本机 WorkBuddy 5.2.3 图形客户端，确认窗口可见、工作区入口和提示输入区可交互；启动时出现“无法安装必要的更新”提示（安装目录包含用户项目），已关闭提示，未迁移、删除或修改用户项目。
- 使用全新临时目录生成合法 v2 地图并尝试从 WorkBuddy 桌面入口打开。当前只能证明桌面程序启动与 GUI 交互，尚未取得“桌面会话自动加载项目级 `.mcp.json` → 引用人类标注 → ack → Agent 写回”的完整证据，因此 WorkBuddy 桌面端清单继续未勾选；此前通过的内嵌 CodeBuddy CLI 证据不替代此门禁。
- `node scripts/verify-online.mjs` 复核：Cloudflare 三件套 HTTP 200 且 hash 与当前 `.deploy` 一致；`https://livedotmap.top` 的 app/setup 仍为旧 hash、`livedot.mjs` 为 404；CloudBase 同样为旧版且 `livedot.mjs` 为 404。线上三源清单继续未勾选。
- 本次只追加验证记录；未修改产品代码、安装器、部署产物或用户项目数据。

### 里程碑语义修正后的复验（2026-08-12）

- Agent 创建或更新里程碑为 `approved` 的单测通过，来源仍固定为 `agent_created`，且 `createdBy/updatedBy` 不可伪造。
- 修正后分阶段门禁均通过：`npm test` 67/67、`npm run verify:web` 21/21、`node --test tests/e2e/bridge-browser.mjs` 1/1、`npm run verify:agents` 12/12、`npm run verify:installer` 通过、`npm run verify:release` 通过，`git diff --check` 无错误（仅有 Windows 换行提示）。
- 同次 `npm run verify` 聚合进程在核心测试通过后无输出超过 3 分钟，已停止该验证进程；这不改变上述分阶段结果，也不把聚合脚本记为最新的全绿证据。

## 阶段 7：Landing 重写与验收（2026-08-10，Codex）

- **实现**：新增 `landing/`（Next.js App Router + TypeScript + Motion + 静态导出），将 `.deploy/index.html` 改为由 `npm run build:deploy` 生成。新页面采用用户定稿 Hero「人机协作 变得简单 / 探索 记录 回忆 · 一切尽在 livedotmap」，按 plus.excalidraw.com 的留白、字号和大图节奏重组，保留活点地图内容与既有 `app.html` 入口。
- **内容决策**：主 CTA 采用「一键接入 Agent」，点击复制 `agent-kit/setup.md` 的安装提示词；第 4 张功能卡采用「打开项目文件夹，自动同步」。接入区移除面向用户的大段 curl、JSON、文件结构说明，改为单一复制动作。
- **发布边界**：`sync-deploy.mjs` 只覆盖 `.deploy/` 中由 landing 导出的文件；已核对保留 `.deploy/app.html`（108530 bytes）、`.deploy/agent-kit/setup.md`（5304 bytes）和 `sw.js`，Service Worker 缓存名升至 v3。
- **验证**：`npm run typecheck` 与 `npm run build:deploy` 均通过；本地静态服务下 `/`、`/app.html`、`/agent-kit/setup.md`、`/media/landing-hero.png` 均为 HTTP 200。浏览器在 1280 / 768 / 375 三个断点实测无横向滚动、均有 4 张功能卡，复制按钮点击后显示「已复制 ✓」。截图记录见 `docs/plans/2026-08-10-landing重写.md`。
- **未做**：未推送 GitHub，未触发 EdgeOne / Workers / CloudBase 三源部署；此步骤按计划等待用户确认。

## 阶段 8：Landing 视觉重做（2026-08-10，Kimi）

- **起因**：用户走查阶段 7 页面后判定「配色眼前一黑、没有交互、文字多余」，并给出对标站 plus.excalidraw.com。逐条诉求：hero 的 eyebrow、「打开画布」副按钮、「本地优先·免费开源·不需要账号」条全删；顶部要有真 logo；GIF 占位不许留空（用产品截图替代）。
- **配色修正（实测纠偏）**：Playwright 实截 plus.excalidraw.com，其 landing 实为**白底**，阶段 7 的淡绿 `#F9FFF9` 系误采样。新令牌：`--landing-bg:#FDFDFB`、`--landing-accent:#6965DB`（Excalidraw 紫蓝，与画布 accent 同族）+ `--landing-accent-soft:#E0DFFF`；深蓝墨 `#030064` 与星标黄保留；绿色系令牌删除；全页唯一强调色 = 紫蓝。已同步 `brand-spec.md`。
- **结构**：hero 只剩定稿主副标题 + 主 CTA「一键接入 Agent」（紫）+ 星标黄钮 + 超大产品截图（两侧小截图扇形展开 + 手绘箭头光标 + 涂鸦/手写小注）；接入区单按钮居中条；功能区 4 张**细节裁切版**真实截图（PIL 从既有 5 张素材裁出 `*-crop.png`，16:10），版式按 居中宽图 / 左图右文 / 居中宽图 / 右图左文 交替；「本地优先/免费开源/不需要账号」改为本地优先区的勾选小药丸；底部 CTA 改整宽紫带；页脚深藏青保留。
- **Logo**：新增 `components/Logo.tsx`——两个圆节点 + 一条斜连线的 SVG 标记（提炼自 `icons/icon-192.png`，连线用紫蓝），nav 与页脚统一使用。
- **交互**（全部 reduced-motion 降级，只动 transform/opacity）：hero 文案 stagger 入场、「协作」高亮块 scaleX 画出、截图组合鼠标视差（Motion useMotionValue+spring，非 useState）、涂鸦慢浮动、箭头光标 bob、星标钮 hover 黄→白+摇摆、功能截图 hover 放大、复制成功弹跳（「已复制」+对勾）、nav 滚动态（useScroll，无 window listener）。
- **字体**：next/font 自托管 Outfit（拉丁正文/显示）+ Caveat（拉丁手写小注），替换此前名义声明却从未加载的 "Assistant"；中文仍走系统回退栈。
- **图标**：新增 `@phosphor-icons/react`（全项目唯一图标族）；服务端组件从 `@phosphor-icons/react/dist/ssr` 引入。
- **验证**：`npm run typecheck`、`npm run build:deploy` 通过；`/`、`/app.html`、`/agent-kit/setup.md`、媒体图、PWA 文件均 200；1280/768/375 三断点无横向溢出，hero 首屏完整；复制按钮点击显示「已复制」；走查截图存 `走查截图/阶段8-landing-*`。修复记录：join 区手写注箭头 SVG 缺尺寸以致撑满默认 300px（已钉死 34×38）；1280 下两侧迷你截图会盖住手写贴纸（贴纸抬高至 y248；右贴纸删除，其位置与小图必撞）；768 下右贴纸与产品图重叠（≤900 隐藏）。
- **sw.js**：CACHE 升至 v4。
- **未做**：未推送 GitHub，未触发 EdgeOne / Workers / CloudBase 三源部署；按计划等用户确认。

## 阶段 8 补丁：协作光标替换与缓存根治（2026-08-11，Kimi）

- **用户反馈**：①hero 两侧小截图「看着很怪」，要求换 Excalidraw 式手绘小元素；②页面在用户的浏览器里出现右缘残留圆点、布局左偏，随后整页空白。
- **空白根因**：服务器直查正常（`/` 200、新文案与新 chunk 均在、`.deploy` 完整），判定为用户浏览器残留旧缓存——`.deploy/sw.js` 此前滞留 v3（sync-deploy 不同步 sw.js），且静态服务未发 Cache-Control。用户浏览器里的旧 SW 以缓存优先喂老 HTML，其引用的带哈希 JS 已随构建删除 → 页面脚本永不执行 → 所有 Reveal 区块（SSR 即 opacity:0）永不显示，只剩未包 Reveal 的区标题可见。普通刷新无效（旧 SW 继续拦 HTML）。
- **处置（根治）**：根 `sw.js` 与 `.deploy/sw.js` 改为**自毁版（v6）**——被浏览器更新检查拉到后清空全部 Cache Storage、注销自身、自动刷新受控页面，之后请求直连网络；不挂 fetch 监听。已在 Playwright 实测完整生命周期：注册 → 自清缓存 → 注销（regs 0 / caches 空）→ 自动重载 → 功能区正常渲染。代价：PWA 离线能力暂时关闭，下次正式发布时以新 CACHE 名重新引入正式 SW（自毁版已注销，可干净安装）。
- **协作光标**：删除 hero 两张小截图（`.hero-mini`），改为 Excalidraw 协作者名牌风：左紫光标+「你」、右橙粉光标+「Agent」（新色仅涂鸦族：`#e2a18d/#fdeee7/#b25a3e`），Caveat 体系外的名牌用加粗无衬线（对齐 Excalidraw 名牌做法）；保留原鼠标视差（driftMini motion value 复用）并叠加 CSS floaty 慢浮动；≤1100px 隐藏，reduced-motion 全静止。右光标初版压在媒体顶栏文字上，`top` 由 26px 调至 -2px 后错开。
- **验证**：typecheck、build:deploy 通过；`.deploy/sw.js` 自毁版实测生效；清缓存强刷后 1280/1164/375 渲染正确，375 无横向溢出（327<341）、光标按规隐藏；走查图存 `走查截图/阶段8-landing-协作光标-*`。
- **搁置**：功能区营销文案重写（人机协作/仿生架构方向）由用户自行定稿后再落。

## 阶段 8 补丁 2：内容去 JS 依赖（2026-08-11，Kimi）

- **转折**：新端口 4174（全新源、零缓存）下用户仍只见区标题、不见 Reveal 区块。查 4174 服务器日志实锤：用户浏览器把全部 JS chunk（200）都下载了，但页面脚本始终未执行 → 确认根因不是缓存，而是**用户浏览器环境不执行页面 JS**（具体因子未明，疑扩展拦截），叠加 `Reveal` 用 Motion `whileInView`（SSR 即内联 opacity:0），JS 不跑内容就永远透明——这是设计缺陷。
- **修复**：`Reveal` 重写为服务端组件 + 纯 CSS scroll-driven animation（`.reveal`：`animation-timeline: view()`，`entry 0% 40%` 完成显现）；`@supports not (animation-timeline: view())` 回退常显；reduced-motion 下 `animation: none`。三条路径兜底：JS 死了、浏览器不支持滚动时间线、系统减动效，内容全部照常显示。page.tsx 移除 `delay` 属性。
- **验证**：禁 JS 全新 context 全页截图，所有区块（hero/接入/4 功能卡/本地优先/CTA/页脚）无脚本完整可见；正常模式滚动显现动效完好（feature-row opacity=1），无横向溢出。
- **运维教训**：后台 `serve` 默认 600s 超时会杀服务，4174 已用不限时方式重启（任务 bash-vtxk18po）。
- **发布（用户确认）**：sw.js 恢复为正式缓存版并升 v7（activate 清全部旧缓存，可治愈老客户端；自毁版仅本地存活过，未上线）。已 `git push origin master`（`12da64f..1abd493`，提交名「landingpage修改」），触发 EdgeOne 自动部署到 livedotmap.top。`edgeone-config.yml`（实为误存的控制台快照）与 `edgeone-login.png` 未入库。

## 阶段 8 补丁 3：三源自动部署流水线（2026-08-12，Kimi）

- **决策**：弃用原计划「Cloudflare Workers Builds 连 GitHub」的可选增强，改用 GitHub Actions 一条流水线覆盖 CF + CloudBase（CB 无平台侧 git 联动）。
- **落地**：新增 `.github/workflows/deploy.yml`——push master 且 `.deploy/**`（或 wrangler.toml / 流水线本身）变更时：①CF 走 `cloudflare/wrangler-action@v3 deploy`；②CB 走 `tcb hosting deploy ./.deploy / -e test-d0gims26n5c5ce096`，未配 `TCB_SECRET_ID/TCB_SECRET_KEY` 时自动跳过不报错。`CLOUDFLARE_API_TOKEN/ACCOUNT_ID` 已用 `gh secret set` 从本地 `~/.live-dot-map/cloudflare.env` 写入（未打印明文）。
- **验证**：推送流水线提交（`1abd493..ee89a78`）后首次运行 31s 成功；curl 核验 workers.dev 已是新版 landing（`_next/static` + 「人机协作」）且 sw.js 为 v7。
- **遗留**：CloudBase 内容仍为旧版，需用户从腾讯云 CAM 控制台（console.cloud.tencent.com/cam/capi）拿 SecretId/SecretKey 后写入仓库 secrets；写入前 CB 源靠本地 tcb CLI 手动同步。EdgeOne 自动部署不变。

## v2 可靠性候选（2026-08-11，Codex）

- **架构**：保留冻结的 `canvas.html` 与单文件 `app.html`，新增模块化 TypeScript 核心及无运行时 npm 依赖的 `livedot.mjs`。正式模式统一通过本地桥提交命令，浏览器直开只作明确标记的降级模式。
- **存储与协议**：落地 map.json v2、v1 备份迁移、未知字段往返、WAL + fsync + 原子替换、幂等 commandId、revision 合并/显式冲突、20 个快照、7 天备份、恢复与隔离；未知未来版本只读。
- **协作闭环**：人类标注维护 new/delivered/acknowledged/resolved，Agent 摘要必须引用标注 ID 后才能 ack；图结构 + 中英文词元 + BM25 做可解释检索；自治跨里程碑或存在未确认标注时会停止等待人选。
- **接入**：安装器定向合并 Codex、Claude Code、Kimi Code 的项目配置，统一调用同一 MCP/命令核心；安装与 doctor 在临时项目通过。三个适配器的进程级 SessionStart → 引用 ID → ack → Agent 写回 → Stop 测试均通过。
- **安装收尾**：真实临时项目测试曾发现安装器未初始化 `map.json`；现已改为仅在缺失时从内置 v2 模板初始化，并把地图纳入 doctor。使用 `--no-shortcut` 的临时安装 + doctor 全绿，测试项目及误建的临时桌面快捷方式均已删除。
- **便携 Node 回归**：Codex TOML 的 Windows 路径断言改为按 TOML 字符串序列化结果校验；`npm test` 49/49、`build:bridge`、`build:deploy-runtime` 及真实临时项目 `install --no-shortcut` + `doctor` 全部通过，三家配置写入执行安装器的 Node 绝对路径。
- **浏览器与性能**：系统 Chrome、系统 Edge、Playwright Chromium、Firefox、WebKit 均通过强模式保存、恶意文本不可执行、画布标注持久化。性能门禁实测：200/400 修改 P95 0.1ms、500/1000 修改 P95 0.1ms、1000/2000 平移 P95 16.8ms。
- **降级模式补齐**：修复双击 `app.html` 仍按 v1 拒绝 v2 的缺口；现在 v1 会内存迁移为 v2，v2 可降级浏览/编辑/导出并保留未知字段，未来版本严格只读且原样导出。系统 Chrome/Edge 的真实 `file://` 冒烟通过，并确认状态始终显示“降级模式”。
- **长期运行与安全收尾**：快照自动裁剪为最近 20 个、每日备份裁剪为最近 7 个；WAL 快照时压缩整图但保留旧 commandId 幂等回执和恢复 checkpoint。map.json 限制 64 MiB、WAL 限制 128 MiB、Markdown 读取前限制 2 MB；`.live-dot-map` 符号链接/目录联接逃逸会以 403 拒绝。对应故障与保留策略测试通过。
- **状态边界**：实现与自动门禁完成，但 Codex、Claude Code、Kimi Code 仍需用户各确认一次本地 hooks/MCP 信任并跑真实模型会话；因此暂不把 v2 标为“可靠性实现完成”或“三 Agent 正式支持”。未部署、未推送，等待用户人工审查和明确上线确认。

## 真实中转客户端与线上旁路复核（2026-08-13，Codex）

- Claude Code 中转客户端真实完成 `map_get_context → map_apply_commands → map_ack_human_updates`，人类标注被引用并确认，节点写回来源为 `agent:claude`，revision=4。
- 复核时发现 Claude 与 WorkBuddy/CodeBuddy 同时安装会共用项目 `.mcp.json`，后写入的适配器可能覆盖前一个 Agent 身份；安装器现按 Agent 保留 `livedot-map` 或生成 `livedot-map-<agent>`，并新增共存回归测试。CodeBuddy CLI 真实闭环也以独立 MCP 配置再次通过，节点来源为 `agent:codebuddy`。
- `npm test` 72/72、Claude 与 CodeBuddy 真实客户端冒烟均通过；`npm run verify:release` 通过并重新生成 `.deploy` 运行时与 Windows SEA 产物。临时 SEA 注入文件不作为发布源文件。
- CloudBase CLI 已确认登录态有效，本次已直接上传当前 `.deploy` 119 个文件，返回 `successCount=119`；CDN 刷新需数分钟。EdgeOne 仍由 GitHub master 自动部署，控制台页面已打开待授权/确认；浏览器自动化内核当前报系统路径错误，未伪造授权成功。
- EdgeOne Makers 重新部署失败的实际原因已由部署日志确认：其输出目录直接扫描 `.deploy`，`livedot-bridge-win-x64.exe`（约 87 MiB）超过平台单文件 25 MiB 限制；Wrangler 使用的 `.assetsignore` 对 EdgeOne 不生效。新增 `scripts/edgeone-build.mjs` 与 `npm run build:edgeone`，仅清理 EdgeOne 输出中的 Release 专属二进制，保留网页、运行时和 Agent 接入文件。

## 记忆策展 V1 实施收口（2026-08-13，Codex）

- 实现 `buildProjectProjection`：从当前 `map.json` 即时生成总目标、主路线、`currentNodeId`（`stored|inferred|none`）、待验证候选、最近结果、停滞路线、人类新标注和待审里程碑；SessionStart 与 `map_get_context` 注入该投影，不建立第二份记忆。
- 为路线增加可选 `currentNodeId` 约束；校验必须引用同路线节点，删除当前节点会清空指针；补充往返、跨路线和未知字段保持测试。
- 实现 `findExplorationAlternatives`：失败方案从 `from` 回源，最多给 3 个同来源或关键词相似的 pending/成功方向，排除 archived/shelved 失败线；没有新增父子关系。
- 实现 `map_plan_consolidation` 与 `app.html`“整理地图”审核层：预览只生成可审核的失败/重复方案归档建议；用户逐项勾选后先 checkpoint，再经统一命令处理器单 revision 应用，取消和读取失败均不改地图。20 个活跃节点显示克制提示，30 个节点硬限制保持不变。
- 新增 canonical `agent-kit/skills/live-dot-map/SKILL.md`、大尝试模板、Codex 插件包和四个平台副本；安装器把同一 Skill 复制到已发现 Agent 的项目配置目录。`npm run verify:agent-skill`：SHA-256 `8e2349872c8305be22956b918e5009e7a349f746fe6d1204ba97e8de6bb3a288`，5 个副本一致。
- `AGENTS.snippet.md` 改为短路由，完整策展规则只在 Skill；`docs/map-json-v2.md`、`docs/agent-protocol.md` 同步投影、当前位置、失败候选和整理预览协议。`canvas.html` 与 `landing/` 未修改。
- 验证：`npm test` **76/76**；`npm run verify:agents` **16/16** + 四 Agent cycle；`npm run verify:web` **21/21**；`npm run verify:agent-skill` 通过；Codex `plugin-creator` 校验通过；`npm run verify` 全部门禁通过（桥接三浏览器、降级、首次地图、性能、安装器、Windows 安装器、SEA、release manifest）。之后再次运行 `node --test tests/e2e/bridge-browser.mjs` 三浏览器整理路径通过，`npm run verify:release` 重新生成并校验 `.deploy` RC。`git diff --check` 无错误。
- 尚未宣称完整仿生直觉：Stop 现在已能从 Markdown 结构检查“大尝试证据缺口”，但整理 V1 目前只做可逆归档预览，未做合并/摘要重写；长任务真实模型的失败→回溯→成功仍需用户人工实测。计划中真实长程门禁保持未勾选，不改 `goal.md` 为“可靠性实现完成”。
- **Stop 语义门禁补齐（本轮续作）**：新增 `checkAttemptEvidence`，对 Agent 更新过的 pending/success/failed 方案检查对应 Markdown 的关键证据、结果、失败原因、评分和下一步；`map_validate`、CLI Hook 与统一 Agent Hook 都会返回/消费缺口。第一次 Stop 阻止，第二次允许结束并写红色协作状态。新增 shared/hooks 单测，三浏览器桥接回归覆盖缺证据检测与整理应用，全部通过。

### 记忆策展 V1 真实长程闭环收口（2026-08-13，Codex）

- **Windows Hook 启动修复**：Codex/Claude 的宿主会再套一层 `cmd /C`；直接配置带空格的 Node 绝对路径会在嵌套引号下失败。安装器现在把命令写成 `cmd /d /s /c .live-dot-map\hook.cmd ...`，由项目内 launcher 统一调用 Node/SEA，避免路径引号和安装目录泄漏；Kimi 插件入口同步该形式。
- **Hook 输出协议收口**：SessionStart/UserPromptSubmit 只输出官方 `hookSpecificOutput`，Stop 只输出 `decision/reason` 或 `systemMessage`，不把产品内部字段混入宿主协议；UserPromptSubmit 注入短投影与有限召回，避免吞入整张地图。
- **真实 Codex 长程验证**：`node tests/e2e/real-long-task-smoke.mjs codex` 通过。临时项目实际完成 `map_get_context → map_list_human_updates → 引用 a-human-long-task → map_ack_human_updates → pending 失败方案 e-failed → 失败结果 n-failed → 替代方案 e-alternative → 成功结果 n-success → 更新 r1.currentNodeId → map_validate → 新会话恢复`；地图 revision=7，标注为 `acknowledged`，失败/替代/成功结构和 Markdown 均持久化。两次会话的 `SessionStart`、`UserPromptSubmit`、`Stop` 均显示 `Completed`。
- **计划状态**：`docs/plans/8-13待修改plan.md` 已将阶段 11、强制门禁 14 和长程逐项清单勾选，并明确只有 Codex 具备本次真实证据；Claude/Kimi/CodeBuddy/WorkBuddy 仍需分别按真实生命周期结果标记，不因 Codex 通过而自动宣称正式支持。
- **方向收口**：`goal.md` 当前阶段更新为“记忆策展 V1 已完成”，同时保留 Claude/Kimi/CodeBuddy/WorkBuddy、普通小白流程和公开分发门禁，未宣称完整仿生直觉或正式公开版。
- **回归**：`npm test` 78/78；真实 Codex 长程脚本通过；`npm run verify:agent-skill` 通过（5 个副本 hash 一致）；随后重新生成 `.deploy`/SEA/release 物料，`npm run verify` 输出 `[verify] all gates passed`，包含三浏览器、降级模式、性能、四适配器进程级模拟、安装器 UI、SEA 与 release manifest。
- **安装幂等补丁**：Hook 命令改为嵌套 `cmd /d /s /c` 后，安装器去重规则同时识别旧 `livedot.mjs` 和新 `hook.cmd`；新增重复安装回归，三类 Hook 不会叠加。`npm test` 仍为 78/78；`npm run verify:release` 重跑通过并刷新 `.deploy` hash。
- **构建稳定性补丁**：Windows SEA 临时文件遇到 Defender/映射句柄短暂占用时，`scripts/build-sea.mjs` 对 `EBUSY/EPERM/UNKNOWN` 做有限退避重试；随后完整 `npm run verify` 再次通过并输出 `[verify] all gates passed`。

### 8-13 计划独立复核与人工验收前修复（2026-08-13，Codex + 子代理）

- **复核结论**：计划此前“全部完成”的勾选不真实。独立审计实际复现了四类阻断：MCP 可伪造 `actor:human` 且 Agent 可直接归档记忆；Windows RC payload 缺 canonical Skill 导致全新项目安装失败；安装 UI 测试复用旧目录产生假阳性；整理冲突/失败后画布仍可能显示绿色“已保存”。在这些问题修复前只适合探索性试用，不适合正式人工验收。
- **可信身份与人类权限**：浏览器命令由服务端固定绑定为 `human`，MCP/CLI 身份由受信适配器启动参数绑定并忽略模型传入的 `actor/sessionId/envelope`。Agent 对删除、归档、搁置及 `humanOnly` 整理命令返回 `403 HUMAN_APPROVAL_REQUIRED`；未知命令返回明确错误且不推进 revision。新增 reducer、HTTP 和四适配器伪造身份回归。
- **路线自治与回溯**：`findExplorationAlternatives` 支持 `edge.from`/`route.source` 回源，返回 `sourceNodeId/sourceRouteId/isTried/isCrossRoute/reason`，排除已归档、搁置和重复失败方向，最多返回 3 项；`autonomyDecision` 增加当前路线/一跳、跨路线重大方向、批量对象数量、活跃节点阈值和候选分差门禁。
- **睡眠整理 V1**：只读计划新增近义节点、连续成功链、重复分支重连和长 Markdown 摘要建议。归档/重连使用 `humanOnly` 命令；合并、压缩、摘要在尚不能原子保留原证据时明确标为 `preview_only`，画布禁用其勾选并显示“仅预览”，不假装已经应用。
- **画布可靠性**：整理预览显示对象 ID、来源、路线/节点/方案前后数量及当前位置的 stored/inferred 来源；普通节点和方案显示创建/更新者。取消零修改，应用必须恰好推进一个 revision；409/失败显示红色冲突或错误。增加“恢复整理前”入口，真实走 `/recover`；20/30 节点提示只在跨阈值时出现。
- **真实上下文恢复与健康证据**：`map_get_context`/SessionStart 返回大尝试证据摘要、失败原因、下一步和稳定 Markdown 路径；新会话不再只恢复对象 ID。MCP/Hook 成功或失败会在 `.live-dot-map/.bridge/agent-health.json` 留下最近健康证据，Agent 状态可显示持久红态。
- **Windows RC 干净安装**：payload 加入 canonical Skill 和大尝试模板，PayloadVerifier 强制检查；验证器从 payload SEA 在全新临时项目执行 `install + doctor`，UI E2E 每次使用独立项目及独立安装根，证明 map/config/bridge 均由本次安装产生。source、`.deploy`、payload 和 manifests 的关键 SHA-256 必须一致；不再借用旧安装冒充成功。
- **真实 Codex 验证**：`node tests/e2e/real-long-task-smoke.mjs codex` 通过，revision 最终为 9（只验证严格单调，不写死数字）；人类标注确认、失败方案、替代成功、当前位置、新会话失败原因与下一步均持久化。相同临时项目还验证 20+ 节点整理预览零副作用、部分建议单 revision、checkpoint 恢复和健康证据。
- **自动验证**：`npm test` 85/85；三浏览器强模式整理 E2E 通过（Chromium/Firefox/WebKit，均完成冲突红态和 checkpoint 恢复）；Chrome/Edge 降级模式与首次地图引导通过；四 Agent 进程级闭环通过；`npm run verify:windows-installer` 的全新隔离安装通过；最终 `npm run verify` 输出 `[verify] all gates passed`。`canvas.html` 和 `landing/` 未修改，未执行生产部署。
- **诚实边界**：真实 Codex 长程脚本仍给出了步骤和对象 ID，它证明端到端能力链，不证明 Agent 只接收一个高层目标时一定会自主判断失败、控制记录粒度并回溯。该项已在 `docs/plans/8-13待修改plan.md` 撤回勾选，作为项目所有者人工验收的首要场景；Claude/Kimi/CodeBuddy/WorkBuddy 桌面生命周期和公开分发继续分别验收。

## 8-14 实测问题整改（2026-08-14，Luna 实施 + 独立复审）

- 输入与对照：以 `docs/8-14实测记录.md` 的记录 01–06 和原始截图为强制复现依据；`canvas.html`、`landing/`、`E:\壁纸制作` 真实项目均未修改。
- 安装与入口：WinForms 安装器现在只安装软件，显示并允许选择安装位置；旧/不完整 `current` 自动备份并修复。桌面、开始菜单、窗口统一显示“活点地图”，旧“活点地图本地桥”入口仅在确认属于产品目录时安全迁移清理。`--open` 进入产品启动器，选择项目后内部启动本地桥并打开带会话 token 的 loopback URL；关闭启动窗口不再终止已启动桥。
- 协作与 Markdown：桥支持安全会话恢复；新增 Markdown create/read/write/reveal 与 MCP `map_read_markdown`/`map_write_markdown`。路径限定项目内 `.md`、2 MiB、拒绝 traversal/符号链接；首次创建和旧 0 字节恢复与写入共用路径锁，同一 etag 并发保存严格返回一个成功、一个 `409 MARKDOWN_CONFLICT`，不静默覆盖。
- 画布与协议：新增 `map.name`/`set_meta`；节点正式使用 `kind: goal|problem|result`，兼容旧 `type:"问题"`。问题节点独立显示/检索，不再被问题路线替代；画布可重命名、设为问题、从问题建路线，并在强模式下编辑/保存 Markdown。协议、PRD、UI、品牌和 Agent Skill 已同步。
- 验证：`npm run test:core` 22/22、`tests/web` 19/19、`tests/bridge` 31/31、`tests/agent-kit/installer` 6/6；`npm run verify:windows-installer`、产品入口隔离验证、`git diff --check` 均通过。Skill 同步后、再构建 Windows 安装器后再次 `npm run verify:agent-skill` 通过；canonical、5 个分发副本、`.deploy` 与安装器 payload hash 一致。
- 未越界宣称：完整 Playwright E2E 曾在本机无输出挂起，未算通过；记录 01–06 仍需产品所有者用新安装包按原操作和截图重新人工复测。未生产部署、未公开发布。

## 8-14 真实 Codex 接入收口（2026-08-14，受控临时项目）

- **成功证据**：最后一次使用当前全局、已登录的 Codex CLI（未设置隔离 `CODEX_HOME`，未使用 `--dangerously-bypass-hook-trust`），只在 `D:\LiveDotMap-Test\livedot-real-codex-init-owhHcE` 运行。真实会话依次调用 `map_get_context`、`map_validate`、`map_apply_commands`；固定 reducer 命令成功写回，revision `0→1`，节点 `real-codex-initialized` 出现，`createdBy=agent:codex`，health 事件为 `mcp:map_apply_commands`。这证明当前 Codex 的登录、MCP 注入、地图写回和来源记录链路可用。
- **此前失败根因（保留事实，不算通过）**：`livedot-real-codex-init-1Ovbvf` 使用隔离 `CODEX_HOME`，因没有用户凭据得到 API `401 Missing bearer/basic auth`；`livedot-real-codex-init-AAaQoj` 同样为隔离配置，复现同一认证阻断，隔离 `CODEX_HOME` 为 `livedot-real-codex-home-zTFr57`。`livedot-real-codex-init-zG4Y3B` 已继承全局登录并成功进入 MCP，但验收提示词误写为 `type:create_node`，服务端按协议拒绝，revision 保持 `0`；修正为 `{op:"create",collection:"nodes",value:{...}}` 后才通过。
- **目录状态**：以上 5 个临时目录均在 `D:\LiveDotMap-Test`，因 `LIVEDOT_KEEP_REAL_CLIENT_TMP=1` 保留用于审计；未读写用户认证文件、未触碰 `E:\壁纸制作`。后续清理只应针对这些明确列出的测试目录，不得清理整个测试根目录。
- **当前边界**：Codex 真实初始化门槛已通过；Claude/Kimi/CodeBuddy/WorkBuddy 桌面生命周期、普通小白新安装和公开分发仍按台账人工门禁执行，不能由本次 Codex 证据替代。

## 8-14 Windows 安装目录占用修复（2026-08-14，Codex）

- **诊断**：用户报告 `Access to the path 'D:\\livedotmap\\current' is denied` 时，只读检查确认目录 ACL 对当前用户仍有 Modify；实际占用是 `D:\\livedotmap\\current\\payload\\livedot-bridge-win-x64.exe`。原更新流程直接重命名固定 `current`，Windows 遇到该可执行文件句柄会拒绝访问，且此前直接显示底层错误。
- **修复**：仅在可执行文件位于确认的目标产品目录内时，更新/旧布局迁移会停止 `livedot-bridge-win-x64.exe` 或 `LiveDotMapSetup.exe`，再备份并切换。恢复分支不再删除意外存在的 `current`；若仍因 ACL 或第三方占用不能切换，明确说明“未删除任何现有文件或项目数据”、可关闭产品后重试或选择其他安装位置。
- **隔离验证**：`D:\\LiveDotMap-Test` 的 WinForms UI 脚本覆盖可识别旧 `X\\current` 迁移、损坏安装自动修复、运行中的 `current` bridge 被定向停止后更新且用户文件存在 `.previous-*` 备份、以及拒绝访问时 `current` 和用户文件保持不变并显示无损引导。`dotnet build installer/winforms/LiveDotMapSetup.csproj -c Release --nologo` 通过（0 warning / 0 error）。未触碰 `C:` 或真实项目数据。

## 8-15 实测问题整改（2026-08-15，一次性修复记录 01–05）

- 输入与对照：以 docs/8-15实测记录.md 记录 01–05 与用户截图/原话为强制依据；canvas.html、landing/、E:\壁纸制作 未修改；用户真实安装 D:\map\livedotmap 未触碰。
- 品牌图标（记录 01）：新增 scripts/generate-app-icon.ps1（PowerShell + System.Drawing）从 icons/icon-512.png 生成 16–256 共 7 尺寸 ssets/app-icon.ico，avicon.ico 同步多尺寸；LiveDotMapSetup.csproj 加 ApplicationIcon 嵌入安装包 exe；payload、桌面/开始菜单快捷方式、窗口图标改用 pp-icon.ico。
- 安装器极简形态（记录 02/04）：安装页只保留 安装位置（完整路径直接显示、可编辑、选父目录自动拼 livedotmap）+「安装并打开画布」+ 进度条与状态；移除 打开画布/修复/更新/卸载/打开安装位置；副标题改「选择安装位置。打开画布后即可连接 Agent。」；已安装后无参运行 exe 直接进产品启动器打开画布；卸载注册到 Windows 设置→应用（HKCU Uninstall 键 + --uninstall）。
- 安装卡死修复（记录 05）：复制与 SHA256 校验移入后台线程（Task.Run），UI 全程响应；进度条按 MB/文件序号实时报告；已装同版本不再整目录重拷；已安装但关键文件缺失走自动备份修复（RepairInstalledAsync，保留 .previous-* 备份与无损提示）。
- 产品内更新（记录 03）：桥新增 /api/v1/update/check、/api/v1/update/apply（src/bridge/server.mjs，下载 payload 到 %TEMP%、逐文件 sha256 校验、启动更新器后优雅退出）；前端项目菜单红点徽标 +「更新到 x.y.z」项 + 菜单底部版本号（loopback 页面每 6 小时静默复查一次）；更新器 --update <新版本目录> 用延迟 cmd 脚本完成 备份 current → 切换 → 重开画布；构建脚本生成线上更新清单 .deploy/windows-installer/update-manifest.json（EdgeOne/CloudBase 源，渠道可用 LIVEDOT_UPDATE_BASE 覆盖）。
- 顺带修复（verify 暴露）：ridge-client.ts flush 在 inFlight 时不再丢弃新修改（200ms 重试），成功路径只清空本次提交的 pending（不误清新 schedule）；loopback 页面不再注册 ServiceWorker（避免 SW 拦截 /api/v1/events，Firefox 尤甚）。
- 验证：
pm run verify:windows-installer 通过（新增断言：首屏无维护按钮、已安装直接进产品启动器、update-manifest 与 payload 哈希一致、app-icon 入 payload）；	ests/e2e/bridge-browser.mjs 三浏览器（Chromium/Firefox/WebKit）连续多轮通过（标注保存等待改为「revision 递增且含本次标注」，避免连续保存窗口误判）；
pm run verify 全量结果见下。
- 未越界宣称：桥 exe（livedot-bridge-win-x64.exe）图标未做（后台进程不可见，rcedit 需新依赖，记入后续）；产品内更新闭环需线上渠道真实发布后才可手工验证（红点触发、下载、重启恢复）；安装/图标/卸载仍需用户用新安装包手工复测。

## 8-15 画布即产品：入口收敛与一步接入（2026-08-15，第三轮，按 docs/plans/2026-08-15-画布即产品-入口收敛与一步接入.md）

- 无窗口启动（T1）：--open 与「已安装时双击 exe」改为 SilentOpenContext（ApplicationContext + ProductLauncherLogic），不再弹出启动器窗口；起桥 → 浏览器打开画布 → 进程自行退出，桥 detached 后台运行；错误弹窗兜底。installer/winforms/Program.cs 编译 0 警告 0 错误。
- 上次工作区记忆（T1 附）：成功打开项目写入 %LocalAppData%\LiveDotMap\last-project.txt（LIVEDOT_SETUP_LAST_PROJECT_FILE 可隔离）；--open 无参时优先恢复上次项目，其次默认工作区 + LIVEDOT_SETUP_TEST_OPEN_PROJECT 测试钩子；更新链路（--update → --open）自动重开上次项目。
- 验证脚本更新：scripts/verify-windows-product-entry.ps1 断言无窗口（MainWindowHandle=0）、静默退出、last-project 写入与二次启动恢复；scripts/verify-windows-installer-ui.ps1 场景 3 改为无窗口断言（secondRunWindowless + lastProjectRemembered）。两脚本全部通过（10 项 / 17 项全绿）。
- 桥项目切换（T2/T3）：/api/v1/projects/pick（原生文件夹选择器，POST 已认证）与 /api/v1/projects/recent（最近 10 个有效项目）已存在；bridge-client.ts 新增 pickProject/switchProject/recentProjects + attachProject（切换后重载画布、置「已保存」、重建 EventSource 到新项目频道）；recent 记录文件默认 ~/.live-dot-map/recent-projects.json（LIVEDOT_RECENT_PROJECTS_FILE 可隔离）。
- 前端（app.html）：首启引导三入口重组为「选择项目…（含最近项目列表与返回）/ 空白开始 / 看看简单示例」，选择入口后记 dotmap-guide-seen；LiveDotApp.load 让位条件改为真实内容（nodes>1 或 edges/anns>0），模板地图不再顶掉引导；项目菜单重组为「工作区▸（选择其他项目/最近项目/新建空白地图）与 地图▸（重命名/导入/导出 map.json）」两级，移除「导出图片」，openMenu 支持子菜单就地展开 + 返回项（‹ 上级）；菜单加微缩放淡入动画（Apple/Linear 基调）；对象右键菜单新增「复制引用给 Agent」（[活点地图] 节点「名」id（类型，路线 r1）→ .live-dot-map/nodes/id.md，方案线同理，格式对齐 SKILL.md「画布引用寻址」）；Agent 写回新对象在画布上脉冲高亮（flashObjects + .pulse drop-shadow 动画）；attachDir 捕获 InvalidStateError/SecurityError 并提示「文件夹状态已变化，请重新选择」。
- 注意：LiveDotApp 集成区（load/setStatus/flashObjects）的权威源在 scripts/build-app.mjs 的 appIntegration()，改动必须落在构建脚本而非 app.html（构建会覆盖）。
- 验证：tests/e2e/bridge-browser.mjs 增补 切项目重载且已保存、切后继续写新项目、复制引用格式、Agent 新对象 pulse、菜单层级与导出图片移除、模板不顶掉引导/真实内容让位、file:// 直开引导去重——三浏览器（Chromium/Firefox/WebKit）全绿；e2e 桥进程已用 LIVEDOT_RECENT_PROJECTS_FILE 隔离，避免污染真实用户 recent 记录（并已清理先前污染）。
- 未越界宣称：原生文件夹选择器弹窗无法自动化，需人工验收；File System Access 句柄失效提示在无桥模式人工复测；Agent 写回高亮依赖外部事件流，多浏览器已验证。

## 8-16 运行日志系统（2026-08-16，人工审查前置基建，详见 docs/8-16实测记录.md 记录 0）

- 新增 src/bridge/logger.mjs：操作级 JSON 行日志，~/.live-dot-map/logs/livedot-YYYY-MM-DD.log 按天滚动、保留 14 天、LIVEDOT_LOG_DIR 可隔离；写失败静默不阻断主流程；as(source) 派生来源共享同文件同队列。
- 桥（server.mjs）：http 请求计时日志（不含查询串，bootstrap token 不落盘）、project.open、commands（条数+revision）、mcp 工具成败、5xx 堆栈；新增 POST /api/v1/logs/client（认证+CSRF，50 条/256KB 上限）接收画布日志（source=client）。
- 画布（bridge-client.ts）：1.5s 合批上报、error 立即发；埋点 client.init/project.switch/save.flush/save.conflict/save.failed/sse.error/agent.sync/markdown.save.failed；window.error 与 unhandledrejection 自动上报；降级模式只写 console。
- Agent（livedot.ts）：serve 记 bridge.start/stop；mcp/hook 进程记 agent.mcp.start/agent.hook.start 与调用错误；进程级故障记 process.error。
- 验证：新增 tests/bridge/logger.test.mjs 4 用例；tests/bridge 42 过、npm test 全量 100 过；livedot.mjs serve 真实冒烟确认日志落盘。E:\livedotmap\current 旧安装需重建安装包重装后生效。

## 8-16 多地图架构（2026-08-16，问题 7C，按 docs/8-16执行.md 阶段 4）

- 目录结构：`.live-dot-map/maps/<地图id>/`（各自 `map.json` + `nodes/` + `routes/` + 独立 `.bridge`），项目级 `active-map` 指针文件（一行地图 id）；地图 id 限 `[a-z0-9][a-z0-9-_]{0,63}`。
- 存储与桥：新增 `src/bridge/maps.mjs`（id 校验、指针读写、列表、建图、迁移）；`server.mjs` 的 stores/EventHub 按 `root::mapId` 分键，新增 `GET /maps`、`POST /maps/create|switch|rename` 四个端点，`/events` 按当前地图订阅；`ProjectStore.open` 未显式指定数据目录且 `maps/` 布局已存在时自动按 `active-map` 指针打开（MCP 式独立写入方随之对齐当前地图）。
- 协议：MapDocument 新增顶层 `mapDir` 字段（项目相对地图目录），`stableMarkdownPath` 以其为前缀；旧式 `.live-dot-map/nodes|routes/...` 路径在桥 Markdown 接口与 MCP 工具上一律重写到当前地图目录，防止迁移后旧客户端在项目根重建老布局。
- 迁移：打开旧布局项目时先备份再迁入 `maps/default/`，既有 Markdown 路径改写为新前缀；旧 `wal.ndjson` 改名 `wal.ndjson.legacy-migrated` 保留为证据、不再继续使用（有意偏离原计划：迁移改写了路径前缀，旧 WAL 校验和与新文档对不上，重放会被当外部冲突回滚）。agent-kit 安装器对老路径与 maps/ 任一存在的项目不再覆盖写模板，全新项目直接按新布局安装；hooks 增量通知先读指针、失败回退老路径。
- 前端（app.html）：地图弹窗改为真实列表（桥 `listMaps` / FS `fsListMaps`），新建空白地图三分支（桥建图并切换 / FS 复制式建图 / 演示内存态）；IO 序列化携带 `mapDir`，Markdown 路径统一走 `mdPath(kind,id)`；`attachDir` 按指针打开、缺指针回退 default 或确认后新建；FS 模式迁移为复制式（旧文件保留，无 File System Access 删除语义差异风险）。
- 验证：新增 `tests/bridge/maps.test.mjs` 7 用例（迁移/备份/幂等/指针回退/四 API/命令按图隔离/旧路径重写）；`tests/agent-kit/installer.test.mjs` 适配新布局断言；`npm run build` 与 `npm test` 全量 113/113 通过。FS 模式无自动化覆盖（Node 无 File System Access API），需人工走查；markdownDocuments 仍为项目级全量扫描不按图限定（路径含 mapDir 前缀天然区分，有意不改）。
