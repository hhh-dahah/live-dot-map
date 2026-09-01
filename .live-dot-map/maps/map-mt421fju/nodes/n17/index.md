# 新节点18


   发现的关键情况

   • 你的桌面图标现在指向的是 dist\windows-installer\LiveDotMapSetup.exe（v1 开发输出），不是某
     个独立安装目录——之前装到 D:\8-20livedotmap安装测试 的那份在 8-24 被归档了，所以你最近一直
     在跑 v1。
   • 桥是单例（%LOCALAPPDATA%\live-dot-map\run\bridge.json 记录 pid/port）。如果现在直接装 v5
     再打开，新程序会复用正在跑的旧桥——你测到的还是旧代码。所以装之前必须先杀旧桥。
   • 安装器只会杀「安装目录内」的进程（Program.cs:1095），杀不掉 dist 里的旧桥，这步得我来。

   逐条回答

   1. 直接安装吗？ 先别。顺序应该是：我杀旧桥 → 你双击
   dist\windows-installer-v5\LiveDotMapSetup.exe → 它会通过 install-location.txt 记起
   D:\8-20livedotmap安装测试，选同一位置即可。

   2. MCP 要重连吗？ 要，而且是两层：
   • 桥重启后，我这边的工具调用会自动重连，这层不用管；
   • 但 n9 检索修复和 n12 守卫是打包进 C:\Users\Thomas\.live-dot-map\livedot.mjs 的（MCP 进程是
     内嵌运行，不代理到桥），这个文件还是 8 月 22 日的旧版。装好 v5、打开一次项目后它应该会被自
     动同步，我会校验 hash；没同步我手动补。然后这个 kimi 会话要重开（或 /mcp 重连），我手里的
     工具才是新代码。

   3. 旧安装包归档？ 现在不动。v1–v4 都在 dist\ 下，是构建产物、可从源码重现。等 v5 验收通过，
   我再删或归档。验收前留着 v1 当回退。

   4. 桌面图标会指向旧的吗？ 不会。安装器每次都会重写「活点地图.lnk」（覆盖式），装完它会指向
   D:\8-20livedotmap安装测试\livedotmap\current\LiveDotMapSetup.exe，同时清掉「活点地图本地桥」
   之类的旧入口。装完我帮你核对图标指向。

   建议顺序

   1. 你确认画布里没有未保存的内容，然后我来杀旧桥
   2. 你装 v5（同一位置）
   3. 从桌面图标打开，进项目
   4. 我校验运行时同步 + 图标指向
   5. 你重开 kimi 会话，我做 n9/n12 验收，你过 n7 三项
   6. 全过后我清理 v1–v4

   确认的话我现在就杀桥。