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
