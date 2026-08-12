# 活点地图 v2 接入指引

> 按顺序执行；任何一步失败就报告真实错误，不得跳过或假装成功。不要覆盖项目已有 Agent 配置，安装器会做定向合并。

## 1. 下载正式产物

首选 `https://livedotmap.top`；失败依次换成 `https://app.live-dot-map.workers.dev`、`https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com`。

Windows PowerShell：

```powershell
$liveDotHome = Join-Path $env:USERPROFILE '.live-dot-map'
New-Item -ItemType Directory -Force -Path $liveDotHome | Out-Null
Invoke-WebRequest 'https://livedotmap.top/app.html' -OutFile (Join-Path $liveDotHome 'app.html')
Invoke-WebRequest 'https://livedotmap.top/livedot.mjs' -OutFile (Join-Path $liveDotHome 'livedot.mjs')
```

macOS / Linux：

```bash
mkdir -p ~/.live-dot-map
curl -fsSL https://livedotmap.top/app.html -o ~/.live-dot-map/app.html
curl -fsSL https://livedotmap.top/livedot.mjs -o ~/.live-dot-map/livedot.mjs
```

验证两个文件非空；`app.html` 必须以 `<!DOCTYPE html>` 开头，`livedot.mjs` 不得是 HTML 错误页。

## 2. Node 20.12+ 兜底

优先使用系统 Node。若没有或版本过低，下载 Node 官方便携包到 `~/.live-dot-map/runtime/`，不需要管理员权限。Windows x64 固定包与 SHA-256：

```powershell
$zip = Join-Path $liveDotHome 'node-v20.12.2-win-x64.zip'
Invoke-WebRequest 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip' -OutFile $zip
if ((Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower() -ne '66dda1717cae30a13be6bb17ad96ee54b69f2c23c85acd9c3299b095fa26b452') { throw 'Node SHA-256 校验失败' }
Expand-Archive -Force $zip (Join-Path $liveDotHome 'runtime')
$node = Join-Path $liveDotHome 'runtime\node-v20.12.2-win-x64\node.exe'
```

macOS/Linux 按操作系统与架构从 Node 官方 `v20.12.2` 目录取包，并用官方 `SHASUMS256.txt` 校验后解压；不要执行未经校验的运行时。

若系统 Node 合格，PowerShell 先执行 `$node = (Get-Command node).Source`；macOS/Linux 令 `NODE=node`。安装器会把实际 Node 可执行文件的绝对路径写入 hooks、MCP 和快捷方式，因此便携 Node 不依赖 PATH。

## 3. 安装当前项目

在项目根执行：

```powershell
& $node (Join-Path $liveDotHome 'livedot.mjs') install --project (Get-Location).Path --app (Join-Path $liveDotHome 'app.html')
& $node (Join-Path $liveDotHome 'livedot.mjs') doctor --project (Get-Location).Path
```

```bash
NODE=node
$NODE ~/.live-dot-map/livedot.mjs install --project "$PWD" --app ~/.live-dot-map/app.html
$NODE ~/.live-dot-map/livedot.mjs doctor --project "$PWD"
```

安装器会复制同一运行时到项目、缺少时初始化 map.json v2、定向合并 Codex/Claude/Kimi 的项目 MCP 与 hooks 配置；已有 `map.json` 绝不覆盖。`doctor.ok` 必须为 `true`。

首次地图不会静默生成。用户需要明确向已连接的 Agent 发送初始化请求（可直接复制）：

> 请初始化我的活点地图：先读取 `AGENTS.md` 路由，再按顺序读取 `goal.md`、PRD、README、计划和最新执行记录；只保留一个总目标、3–7 个关键阶段和当前待判断路线，不要按文件/目录/函数或聊天轮次建节点。通过本地桥创建地图，为每个节点写入来源路径、生成理由、`createdBy` 和层级；不确定内容标为“待确认”，不要覆盖已有地图。

初始化由服务端限制为最多 15 个活跃节点；不要一次创建目录树或执行碎片。超过上限时先合并、压缩为项目/路线级大节点，再继续推进。

这条请求是一次性授权：Agent 只有收到它（或等价明确请求）后才扫描项目并写入首张地图；已有地图永远不覆盖。

## 4. 首次信任

- Codex：在 `/hooks` 信任项目 hooks，并确认 `livedot-map` MCP 已启用。
- Claude Code：首次打开项目时批准项目 `.mcp.json` 与 hooks。
- Kimi Code：执行 `/plugins install <项目>/.live-dot-map/kimi-plugin`，确认后新开会话。

这是三家产品要求的本地代码信任步骤，不能绕过，也不能伪造成功。

## 5. 启动正式画布

```powershell
& $node (Join-Path $liveDotHome 'livedot.mjs') serve --project (Get-Location).Path --app (Join-Path $liveDotHome 'app.html')
```

```bash
$NODE ~/.live-dot-map/livedot.mjs serve --project "$PWD" --app ~/.live-dot-map/app.html
```

打开终端输出的随机 `127.0.0.1` URL。只有这个入口具备已确认保存、WAL 恢复、冲突保护、Agent 自动读取和图检索；双击 HTML 只进入明显标记的降级模式。
