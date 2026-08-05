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
- **方案状态切换**：`setEdgeStatus()` 强制实现连接规则（待验证→成功会自动创建目标节点）。
- **Agent 模拟**：`agentWork()`/`submitAgent()` 仅模拟 Agent 更新流程（状态提示 + 高亮），没有真实 Agent 连接。

## 已知遗留小项（原型已冻结，仅记录，留待 Excalidraw 版对照）

- `setEdgeStatus()` 切换状态时会重建 `dx/dy` 但保留旧 `cx/cy` 弯曲，切换后曲线可能突兀。
- 项目菜单「设置」项是改造时主动保留的入口（否则设置抽屉无处打开），是否保留待正式版定夺。
- 项目菜单中 Ctrl+O / Ctrl+Shift+E 只是提示文字，未绑定真实快捷键。

## 本次执行记录（阶段 1）

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

## 走查工具链（第 7 轮起）

- **原型解冻**：用户反馈仍有细节体验问题，冻结暂缓，继续按「记入 `设计细节.md` → 改 canvas.html → 截图验证 → 提交」迭代。
- **截图产物**：`走查截图/` 目录，已加入 `.gitignore` 不进仓库。
- **headless Chrome**（无交互、纯视觉）：`chrome.exe --headless=new --screenshot=<绝对Windows路径> --window-size=1600,1000 <url>`；注意 `--screenshot` 必须用绝对 Windows 路径（相对路径+中文会写盘失败）。
- **Playwright MCP**（可交互，opencode 会话自带）：`playwright_browser_*` 工具（navigate / snapshot / click / type / take_screenshot 等），可直接打开 `file://` 或本地服务器页面；交互后截图落盘到 `走查截图/` 供 `see` 技能识别。
- **本地服务器**（可选）：`node 走查截图/serve.cjs` → `http://127.0.0.1:8123/canvas.html`（CommonJS 必须 `.cjs` 后缀——上级目录 package.json 是 `"type":"module"`）。
- **弃用记录**：Kimi WebBridge 实测后被弃用（用户反馈太慢），已用其官方 `uninstall` 命令卸载 daemon 并删除 `~/.kimi-webbridge` 与三个 skill 目录（kimi-code/claude/codex）；浏览器里的 WebBridge 扩展需用户在 chrome://extensions 手动移除。
