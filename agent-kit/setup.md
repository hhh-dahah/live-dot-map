# 活点地图接入指引（给 Agent 看的）

> 用户要求把「活点地图」接入当前项目。你是 Agent，按本指引从上到下逐步执行。
> **铁律：每一步失败就停下，向用户报告哪一步、什么错、你打算怎么补救；不要静默跳过，不要假装成功。**
> 全程只需要一次手动操作（最后一步用户自己点「打开项目文件夹」），其余都由你完成。

## 下载源（按顺序兜底，一个失败换下一个）

| 源 | 地址前缀 | 说明 |
|---|---|---|
| 源 A | `https://app.live-dot-map.workers.dev` | Cloudflare，全球可访问 |
| 源 B | `https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com` | CloudBase 国内节点，国内网络更快 |

要下载的文件（两个源路径相同）：

- `/app.html` —— 画布程序本体（零依赖单文件）
- `/favicon.ico` —— 图标（快捷方式用）
- `/agent-kit/AGENTS.snippet.md` —— 协议段（第 4 步用）
- `/agent-kit/map.template.json` —— 空白地图模板（第 5 步用）

**注意：本机可能挂着代理（Clash 等），curl 被拦不是活点地图的问题——换源、换工具再试，都失败才报告。**

## 第 1 步：安装画布程序到 `~/.live-dot-map/`

程序装一次、所有项目共用；已存在则覆盖为最新版，不用担心重复执行。

```bash
# macOS / Linux / Windows 的 Git Bash 通用：
mkdir -p ~/.live-dot-map
curl -fsSL -o ~/.live-dot-map/app.html   "https://app.live-dot-map.workers.dev/app.html" \
  || curl -fsSL -o ~/.live-dot-map/app.html "https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com/app.html"
curl -fsSL -o ~/.live-dot-map/favicon.ico "https://app.live-dot-map.workers.dev/favicon.ico" \
  || curl -fsSL -o ~/.live-dot-map/favicon.ico "https://test-d0gims26n5c5ce096-1425841737.tcloudbaseapp.com/favicon.ico"
```

curl 不可用或全被拦时，Windows 换 PowerShell：

```powershell
mkdir "$env:USERPROFILE\.live-dot-map" -Force
Invoke-WebRequest "https://app.live-dot-map.workers.dev/app.html" -OutFile "$env:USERPROFILE\.live-dot-map\app.html"
# 失败则把网址换成源 B 再试；favicon.ico 同理
```

**验证**：确认 `app.html` 非空且开头是 `<!DOCTYPE html`（防止代理返回错误页当成下载成功）。不是就换源重下。

## 第 2 步：创建桌面快捷方式（仅 Windows；其他系统跳过）

```powershell
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\活点地图.lnk")
$sc.TargetPath = "$env:USERPROFILE\.live-dot-map\app.html"
$sc.IconLocation = "$env:USERPROFILE\.live-dot-map\favicon.ico"
$sc.Save()
```

桌面路径必须用 `[Environment]::GetFolderPath('Desktop')` 取（防 OneDrive 重定向到别的目录）。失败不阻塞，告知用户「双击 `~/.live-dot-map/app.html` 也能打开」即可。

## 第 3 步：在当前项目根建数据目录

在当前项目根目录（用户打开你时所在的目录）：

```bash
mkdir -p .live-dot-map
```

项目的地图数据（`map.json` 与 Markdown 分片）都住在这里，不污染项目根目录。

## 第 4 步：把协议段注入项目 AGENTS.md

1. 项目根有 `AGENTS.md` 就读它；没有就新建一个（先写一行 `# AGENTS.md`）。
2. 检查里面**是否已有「活点地图」字样**：有 → 说明协议已注入，跳到第 5 步；没有 → 继续。
3. 下载 `agent-kit/AGENTS.snippet.md`（两个源按顺序兜底），把全文**原样追加**到 AGENTS.md 末尾。
   - 项目里如果已有活点地图仓库的本地副本（如 `agent-kit/AGENTS.snippet.md`），直接拷贝，不用联网。

## 第 5 步：初始化项目地图

- **项目已有记录文件**（AGENTS.md 引用的 STATUS/PLAN/日志类 md，或 docs/ 目录）：按协议里的「初始化（迁移四步）」执行——读记录 → 提取路线/节点/方案并推断状态 → 在 `.live-dot-map/` 生成 `map.json` **草稿**（md 字段挂现有文档，不新建内容文件）→ 明确告诉用户这是草稿，请他在画布上审核修正。
- **项目没有任何记录**：下载 `agent-kit/map.template.json`，把 `name` 改成项目目录名、`updatedAt` 和日期字段改成今天，写入 `.live-dot-map/map.json`。

## 第 6 步：拉起画布

```bash
# Windows:
start "" "%USERPROFILE%\.live-dot-map\app.html"
# macOS:
open ~/.live-dot-map/app.html
# Linux:
xdg-open ~/.live-dot-map/app.html
```

## 第 7 步：交代用户（唯一的手动步）

明确告诉用户：

> 画布已打开。浏览器安全限制，最后一步只能你来：点画布里的「打开项目文件夹」，选中本项目目录（`<项目路径>`），画布就会和 `.live-dot-map/map.json` 连上，之后我（Agent）每次改地图你的画布自动刷新。
> 以后随时对我说「打开画布」就行；双击桌面的「活点地图」图标也可以。

然后按协议「会话开始铁律」输出一次地图摘要，接入完成。
