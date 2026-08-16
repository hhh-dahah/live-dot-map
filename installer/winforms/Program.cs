using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LiveDotMapSetup;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 2 && string.Equals(args[0], "--verify-payload", StringComparison.Ordinal))
        {
            var result = PayloadVerifier.Verify(args[1]);
            Console.Out.WriteLine(JsonSerializer.Serialize(result));
            return result.Ok ? 0 : 1;
        }

        ApplicationConfiguration.Initialize();

        if (args.Length >= 1 && string.Equals(args[0], "--open", StringComparison.Ordinal))
        {
            // --open [project]: 产品入口，直接打开画布（快捷方式与更新器调用）。
            // 无窗口启动：起桥 → 浏览器打开画布 → 本进程退出，桥 detached 后台运行。
            Application.Run(new SilentOpenContext(args.Length >= 2 ? args[1] : null));
            return 0;
        }

        if (args.Length >= 2 && string.Equals(args[0], "--update", StringComparison.Ordinal))
        {
            // --update <新安装包exe路径>: 产品内更新链路调用，替换 current 后重开画布。
            Application.Run(new UpdateForm(args[1]));
            return 0;
        }

        if (args.Length == 1 && string.Equals(args[0], "--uninstall", StringComparison.Ordinal))
        {
            // --uninstall: Windows 设置→应用 的卸载入口。
            Application.Run(new UninstallForm());
            return 0;
        }

        // 无参数：情境化入口。
        // 1) 正在运行安装目录里的 exe（桌面/开始菜单快捷方式）→ 无窗口直达画布。
        // 2) 否则（从安装包所在目录/下载目录运行）→ 总是显示安装 UI：
        //    未安装时是安装页；已安装时是修复/更新页（安装包负责安装，快捷方式负责打开）。
        var installedRoot = LauncherForm.CurrentInstalledRoot;
        var runningFromInstall = string.Equals(LauncherForm.SourceRoot, installedRoot, StringComparison.OrdinalIgnoreCase);
        if (runningFromInstall)
        {
            Application.Run(new SilentOpenContext(null));
            return 0;
        }
        Application.Run(new LauncherForm());
        return 0;
    }
}

internal sealed record VerificationResult(bool Ok, string Version, IReadOnlyList<string> Errors);

internal static class PayloadVerifier
{
    public static VerificationResult Verify(string payloadRoot) => Verify(payloadRoot, null);

    /// <summary>校验 payload 目录；progress 可选，按文件报告（file, 序号, 总数）。</summary>
    public static VerificationResult Verify(string payloadRoot, IProgress<(string File, int Done, int Total)>? progress)
    {
        var errors = new List<string>();
        var manifestPath = Path.Combine(payloadRoot, "payload-manifest.json");
        string version = "unknown";
        try
        {
            using var manifest = JsonDocument.Parse(File.ReadAllText(manifestPath, Encoding.UTF8));
            var root = manifest.RootElement;
            version = root.TryGetProperty("version", out var versionProperty) ? versionProperty.GetString() ?? version : version;
            if (root.GetProperty("schema").GetInt32() != 1) errors.Add("payload manifest schema must be 1");
            var files = root.GetProperty("files");
            var entries = files.EnumerateObject().ToList();
            var done = 0;
            foreach (var property in entries)
            {
                done++;
                progress?.Report((property.Name, done, entries.Count));
                var relative = property.Name.Replace('/', Path.DirectorySeparatorChar);
                if (Path.IsPathRooted(relative) || relative.Contains("..", StringComparison.Ordinal))
                {
                    errors.Add($"unsafe payload path: {property.Name}");
                    continue;
                }
                var path = Path.Combine(payloadRoot, relative);
                if (!File.Exists(path))
                {
                    errors.Add($"missing payload file: {property.Name}");
                    continue;
                }
                var expected = property.Value.GetProperty("sha256").GetString();
                var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
                if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase)) errors.Add($"payload hash mismatch: {property.Name}");
            }
            foreach (var required in new[]
            {
                "app.html",
                "livedot-bridge-win-x64.exe",
                "agent-kit/skills/live-dot-map/SKILL.md"
            })
            {
                if (!files.TryGetProperty(required, out _)) errors.Add($"payload manifest misses required file: {required}");
            }
        }
        catch (Exception error)
        {
            errors.Add($"invalid payload manifest: {error.Message}");
        }
        return new VerificationResult(errors.Count == 0, version, errors);
    }
}

/// <summary>
/// 产品打开画布的核心逻辑（无 UI）：确保默认项目 → 启动本地桥 → 打开浏览器画布 → 桥 detached 后台运行。
/// 供无窗口启动（SilentOpenContext）使用；状态经回调输出，错误直接抛出由调用方处理。
/// </summary>
internal sealed class ProductLauncherLogic
{
    private readonly Action<string> _status;
    private Process? _session;

    public ProductLauncherLogic(Action<string> status) { _status = status; }

    private static string DefaultWorkspaceRoot
    {
        get
        {
            var isolatedRoot = Environment.GetEnvironmentVariable("LIVEDOT_SETUP_WORKSPACE_ROOT");
            return string.IsNullOrWhiteSpace(isolatedRoot)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LiveDotMap", "workspace")
                : Path.GetFullPath(isolatedRoot);
        }
    }

    // ---- 上次工作区记忆（A2）：产品数据目录 last-project.txt ----
    private static string LastProjectFile()
    {
        var isolatedFile = Environment.GetEnvironmentVariable("LIVEDOT_SETUP_LAST_PROJECT_FILE");
        if (!string.IsNullOrWhiteSpace(isolatedFile)) return Path.GetFullPath(isolatedFile);
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LiveDotMap", "last-project.txt");
    }
    public static string? ReadLastProject()
    {
        try
        {
            var path = LastProjectFile();
            if (!File.Exists(path)) return null;
            var saved = File.ReadAllText(path, Encoding.UTF8).Trim();
            return !string.IsNullOrWhiteSpace(saved) && Directory.Exists(saved) ? saved : null;
        }
        catch { return null; }
    }
    public static void WriteLastProject(string project)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LastProjectFile())!);
            File.WriteAllText(LastProjectFile(), project + Environment.NewLine, new UTF8Encoding(false));
        }
        catch { /* 记忆失败不影响打开画布 */ }
    }

    public async Task OpenDefaultCanvasAsync()
    {
        await EnsureDefaultWorkspaceAsync();
        await StartCanvasAsync(DefaultWorkspaceRoot, "默认协作画布已打开。");
    }

    public async Task OpenProjectAsync(string project, bool confirmExisting)
    {
        if (string.Equals(project, DefaultWorkspaceRoot, StringComparison.OrdinalIgnoreCase))
        {
            await OpenDefaultCanvasAsync();
            return;
        }
        if (!ProjectHasAnyMap(project))
        {
            await EnsureDefaultWorkspaceAsync();
            CopyDefaultMapToProject(DefaultWorkspaceRoot, project);
            _status("已复制默认地图到所选项目；原有文件未覆盖。");
        }
        await StartCanvasAsync(project, "已切换到所选项目的协作画布。");
    }

    // 多地图布局（docs/map-json-v2.md）：地图在 .live-dot-map/maps/<id>/map.json；
    // 旧版单图布局的 .live-dot-map/map.json 由桥在打开时自动迁移，两种布局都算「已有地图」。
    private static bool ProjectHasAnyMap(string project)
    {
        var data = Path.Combine(project, ".live-dot-map");
        if (File.Exists(Path.Combine(data, "map.json"))) return true;
        var maps = Path.Combine(data, "maps");
        if (!Directory.Exists(maps)) return false;
        foreach (var dir in Directory.EnumerateDirectories(maps))
        {
            if (File.Exists(Path.Combine(dir, "map.json"))) return true;
        }
        return false;
    }

    private async Task EnsureDefaultWorkspaceAsync()
    {
        if (ProjectHasAnyMap(DefaultWorkspaceRoot)) return;
        Directory.CreateDirectory(DefaultWorkspaceRoot);
        var bridge = Path.Combine(LauncherForm.SourcePayload, "livedot-bridge-win-x64.exe");
        var app = Path.Combine(LauncherForm.SourcePayload, "app.html");
        if (!File.Exists(bridge) || !File.Exists(app)) throw new InvalidOperationException("安装文件不完整，请先重新运行安装包修复。");
        var info = new ProcessStartInfo { FileName = bridge, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = LauncherForm.SourcePayload };
        info.ArgumentList.Add("install");
        info.ArgumentList.Add("--project");
        info.ArgumentList.Add(DefaultWorkspaceRoot);
        info.ArgumentList.Add("--app");
        info.ArgumentList.Add(app);
        info.ArgumentList.Add("--no-shortcut");
        using var process = Process.Start(info) ?? throw new InvalidOperationException("无法准备默认项目。");
        var exitTask = process.WaitForExitAsync();
        if (await Task.WhenAny(exitTask, Task.Delay(TimeSpan.FromSeconds(20))) != exitTask)
        {
            process.Kill(true);
            throw new TimeoutException("准备默认项目超时，请重试。");
        }
        await exitTask;
        if (process.ExitCode != 0)
        {
            var error = (await process.StandardError.ReadToEndAsync()).Trim();
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? "准备默认项目失败。" : error);
        }
        if (!ProjectHasAnyMap(DefaultWorkspaceRoot)) throw new InvalidOperationException("默认地图没有生成，请重新运行安装包修复。");
    }

    private static void CopyDefaultMapToProject(string workspace, string project)
    {
        var source = Path.Combine(workspace, ".live-dot-map");
        var target = Path.Combine(project, ".live-dot-map");
        if (!ProjectHasAnyMap(workspace)) throw new InvalidOperationException("默认地图不可用，请重试。");
        if (ProjectHasAnyMap(project)) throw new InvalidOperationException("所选项目已有地图，未覆盖。");
        CopyDirectoryWithoutOverwrite(source, target, source);
        if (!ProjectHasAnyMap(project)) throw new InvalidOperationException("默认地图复制未完成。");
    }

    private static void CopyDirectoryWithoutOverwrite(string source, string target, string root)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) continue;
            var relative = Path.GetRelativePath(root, file).Replace('\\', '/');
            if (relative.StartsWith(".bridge/", StringComparison.OrdinalIgnoreCase) || relative.StartsWith(".snapshots/", StringComparison.OrdinalIgnoreCase) || relative.StartsWith(".backups/", StringComparison.OrdinalIgnoreCase) || relative.StartsWith(".quarantine/", StringComparison.OrdinalIgnoreCase)) continue;
            File.Copy(file, Path.Combine(target, Path.GetFileName(file)), false);
        }
        foreach (var directory in Directory.EnumerateDirectories(source))
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
            var name = Path.GetFileName(directory);
            if (name.Equals(".bridge", StringComparison.OrdinalIgnoreCase) || name.Equals(".snapshots", StringComparison.OrdinalIgnoreCase) || name.Equals(".backups", StringComparison.OrdinalIgnoreCase) || name.Equals(".quarantine", StringComparison.OrdinalIgnoreCase)) continue;
            CopyDirectoryWithoutOverwrite(directory, Path.Combine(target, name), root);
        }
    }

    public async Task StartCanvasAsync(string project, string successMessage)
    {
        var bridge = Path.Combine(LauncherForm.SourcePayload, "livedot-bridge-win-x64.exe");
        var app = Path.Combine(LauncherForm.SourcePayload, "app.html");
        if (!File.Exists(bridge) || !File.Exists(app)) throw new InvalidOperationException("安装文件不完整，请重新运行安装包修复。");
        if (_session is { HasExited: false }) _session.Kill(true);
        var info = new ProcessStartInfo { FileName = bridge, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = LauncherForm.SourcePayload };
        info.ArgumentList.Add("serve");
        info.ArgumentList.Add("--project");
        info.ArgumentList.Add(project);
        info.ArgumentList.Add("--app");
        info.ArgumentList.Add(app);
        _session = Process.Start(info) ?? throw new InvalidOperationException("无法打开项目画布。");
        var lineTask = _session.StandardOutput.ReadLineAsync();
        if (await Task.WhenAny(lineTask, Task.Delay(TimeSpan.FromSeconds(15))) != lineTask)
        {
            if (_session is { HasExited: false }) _session.Kill(true);
            var error = await _session.StandardError.ReadToEndAsync();
            throw new TimeoutException(string.IsNullOrWhiteSpace(error) ? "打开画布超时，请重试。" : error.Trim());
        }
        var line = await lineTask;
        if (string.IsNullOrWhiteSpace(line)) throw new InvalidOperationException("打开画布失败，请重试。");
        using var response = JsonDocument.Parse(line);
        var url = response.RootElement.GetProperty("url").GetString();
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("http://127.0.0.1:", StringComparison.Ordinal)) throw new InvalidOperationException("打开画布失败，请重试。");
        if (string.Equals(Environment.GetEnvironmentVariable("LIVEDOT_SETUP_SKIP_BROWSER"), "1", StringComparison.Ordinal)) _status("已建立带随机会话 token 的本机画布会话（隔离验证跳过浏览器）。");
        else Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        _status(successMessage + " 画布在浏览器中运行，本进程已退出。");
        WriteLastProject(project);
    }

    public void StopSession()
    {
        if (_session is { HasExited: false }) _session.Kill(true);
        _session?.Dispose();
        _session = null;
    }
}

/// <summary>无窗口产品入口：起桥 → 打开画布 → 进程退出（桥 detached 后台运行）。快捷方式与已安装双击直达。</summary>
internal sealed class SilentOpenContext : ApplicationContext
{
    public SilentOpenContext(string? initialProject)
    {
        var logic = new ProductLauncherLogic(message => { });
        _ = RunAsync(logic, initialProject);
    }

    private async Task RunAsync(ProductLauncherLogic logic, string? initialProject)
    {
        try
        {
            var project = !string.IsNullOrWhiteSpace(initialProject) && Directory.Exists(initialProject)
                ? Path.GetFullPath(initialProject)
                : ProductLauncherLogic.ReadLastProject();
            if (!string.IsNullOrWhiteSpace(project))
            {
                await logic.OpenProjectAsync(project, false);
            }
            else
            {
                await logic.OpenDefaultCanvasAsync();
                var automationProject = Environment.GetEnvironmentVariable("LIVEDOT_SETUP_TEST_OPEN_PROJECT");
                if (!string.IsNullOrWhiteSpace(automationProject) && Directory.Exists(automationProject))
                    await logic.OpenProjectAsync(Path.GetFullPath(automationProject), false);
            }
        }
        catch (Exception error)
        {
            var message = error.Message.Length <= 500 ? error.Message : error.Message[..500] + "…";
            MessageBox.Show(message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            ExitThread();
        }
    }
}

/// <summary>安装页：仅在未安装或安装不完整时出现。极简：位置 + 安装按钮 + 进度。</summary>
internal sealed class LauncherForm : Form
{
    private readonly TextBox _installPath = new() { Dock = DockStyle.Fill };
    private readonly Button _chooseInstallPath = new() { Text = "更改位置", AutoSize = true };
    private readonly Button _installAndOpen = new() { Text = "安装并打开画布", AutoSize = true };
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Top, Height = 14, Visible = false };
    private readonly TextBox _status = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };
    private string _productRoot = string.Empty;

    public const string ProductDirectoryName = "livedotmap";

    public static string SourceRoot => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    public static string SourcePayload => Path.Combine(SourceRoot, "payload");
    public static string CurrentInstalledRoot
    {
        get
        {
            var parent = DefaultInstallParent;
            try
            {
                var marker = Path.Combine(ProductRootFromParent(DefaultInstallParent), "install-location.txt");
                if (File.Exists(marker))
                {
                    var saved = File.ReadAllText(marker, Encoding.UTF8).Trim();
                    if (!string.IsNullOrWhiteSpace(saved) && Path.IsPathRooted(saved)) parent = NormalizeInstallParent(saved);
                }
            }
            catch { /* 读不到记忆位置就用默认 */ }
            return Path.Combine(ProductRootFromParent(parent), "current");
        }
    }
    private static string InstallLocationMarker => Path.Combine(ProductRootFromParent(DefaultInstallParent), "install-location.txt");
    private static string ShortcutRoot => Environment.GetEnvironmentVariable("LIVEDOT_SETUP_SHORTCUT_ROOT") ?? string.Empty;
    internal static string StartMenuDirectory => string.IsNullOrWhiteSpace(ShortcutRoot)
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs")
        : Path.Combine(Path.GetFullPath(ShortcutRoot), "StartMenu");
    internal static string DesktopDirectory => string.IsNullOrWhiteSpace(ShortcutRoot)
        ? Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
        : Path.Combine(Path.GetFullPath(ShortcutRoot), "Desktop");

    private static string DefaultInstallParent
    {
        get
        {
            var isolatedRoot = Environment.GetEnvironmentVariable("LIVEDOT_SETUP_PRODUCT_ROOT");
            return string.IsNullOrWhiteSpace(isolatedRoot)
                ? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
                : NormalizeInstallParent(isolatedRoot);
        }
    }

    private string ProductRoot => string.IsNullOrWhiteSpace(_productRoot) ? ProductRootFromParent(DefaultInstallParent) : _productRoot;
    private string InstalledRoot => Path.Combine(ProductRoot, "current");
    private string InstallParent => Directory.GetParent(ProductRoot)?.FullName ?? ProductRoot;

    /// <summary>关键文件存在性快速检查（毫秒级），用于入口分流，不做 hash 校验。</summary>
    public static bool HasKeyInstallerFiles(string installedRoot)
    {
        try
        {
            return File.Exists(Path.Combine(installedRoot, "LiveDotMapSetup.exe"))
                && File.Exists(Path.Combine(installedRoot, "payload", "payload-manifest.json"))
                && File.Exists(Path.Combine(installedRoot, "payload", "app.html"))
                && File.Exists(Path.Combine(installedRoot, "payload", "livedot-bridge-win-x64.exe"));
        }
        catch
        {
            return false;
        }
    }

    private static string NormalizeInstallParent(string value)
    {
        var full = Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.Equals(Path.GetFileName(full), ProductDirectoryName, StringComparison.OrdinalIgnoreCase))
            return Directory.GetParent(full)?.FullName ?? full;
        return full;
    }

    private static string ProductRootFromParent(string parent) => Path.Combine(NormalizeInstallParent(parent), ProductDirectoryName);

    /// <summary>把用户输入的路径解析为父目录 + 完整产品目录。输入本身以 livedotmap 结尾视为完整产品目录。</summary>
    internal static (string Parent, string ProductRoot) ParseProductRoot(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return (DefaultInstallParent, ProductRootFromParent(DefaultInstallParent));
        var full = Path.GetFullPath(input.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.Equals(Path.GetFileName(full), ProductDirectoryName, StringComparison.OrdinalIgnoreCase))
            return (Directory.GetParent(full)?.FullName ?? full, full);
        return (full, Path.Combine(full, ProductDirectoryName));
    }

    public LauncherForm()
    {
        Text = "活点地图";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(640, 360);
        Size = new Size(680, 420);
        Font = new Font("Microsoft YaHei UI", 9F);
        try
        {
            var iconPath = Path.Combine(SourcePayload, "app-icon.ico");
            if (!File.Exists(iconPath)) iconPath = Path.Combine(SourcePayload, "favicon.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        }
        catch { /* 图标缺失不影响安装 */ }

        _productRoot = ResolveInitialProductRoot();
        _installPath.Text = _productRoot;

        var title = new Label { Text = "活点地图", AutoSize = true, Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) };
        var subtitle = new Label { Text = "选择安装位置。打开画布后即可连接 Agent。", AutoSize = true, MaximumSize = new Size(620, 0), Margin = new Padding(0, 0, 0, 16) };
        var installLabel = new Label { Text = "软件安装位置", AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
        var pathRow = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 12) };
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        pathRow.Controls.Add(_installPath, 0, 0);
        pathRow.Controls.Add(_chooseInstallPath, 1, 0);

        var progressRow = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) };
        progressRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        progressRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _progress.Visible = false;
        var progressText = new Label { Text = "", AutoSize = true, Margin = new Padding(8, 0, 0, 0) };
        progressRow.Controls.Add(_progress, 0, 0);
        progressRow.Controls.Add(progressText, 1, 0);

        var actionRow = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 0, 0, 16) };
        actionRow.Controls.Add(_installAndOpen);

        var statusLabel = new Label { Text = "状态", AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 8 };
        for (var i = 0; i < 7; i++) root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(title, 0, 0);
        root.Controls.Add(subtitle, 0, 1);
        root.Controls.Add(installLabel, 0, 2);
        root.Controls.Add(pathRow, 0, 3);
        root.Controls.Add(progressRow, 0, 4);
        root.Controls.Add(actionRow, 0, 5);
        root.Controls.Add(statusLabel, 0, 6);
        root.Controls.Add(_status, 0, 7);
        Controls.Add(root);

        _chooseInstallPath.Click += (_, _) => ChooseInstallPath();
        _installAndOpen.Click += async (_, _) => await InstallAndOpenAsync();
        _installPath.Leave += (_, _) => ApplyTypedPath();
        Load += (_, _) => LoadState();
    }

    private string ResolveInitialProductRoot()
    {
        var source = SourceRoot;
        var sourceParent = Directory.GetParent(source)?.FullName;
        if (string.Equals(Path.GetFileName(source), "current", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(sourceParent))
            return NormalizeInstallParent(sourceParent) + Path.DirectorySeparatorChar + ProductDirectoryName;

        try
        {
            if (File.Exists(InstallLocationMarker))
            {
                var saved = File.ReadAllText(InstallLocationMarker, Encoding.UTF8).Trim();
                if (!string.IsNullOrWhiteSpace(saved) && Path.IsPathRooted(saved)) return ProductRootFromParent(saved);
            }
        }
        catch { /* 首屏仍可使用默认位置 */ }
        return ProductRootFromParent(DefaultInstallParent);
    }

    private void ApplyTypedPath()
    {
        var (_, productRoot) = ParseProductRoot(_installPath.Text);
        _productRoot = productRoot;
        _installPath.Text = productRoot;
    }

    private void LoadState()
    {
        var verify = PayloadVerifier.Verify(SourcePayload);
        if (!verify.Ok)
        {
            AppendStatus($"安装包自检失败，不能继续安装：{string.Join("；", verify.Errors)}");
            _installAndOpen.Enabled = false;
            return;
        }
        AppendStatus($"安装包已校验：版本 {verify.Version}。安装只写入当前 Windows 用户选择的位置，不请求管理员权限。");
        if (Directory.Exists(InstalledRoot))
        {
            if (!HasKeyInstallerFiles(InstalledRoot))
                AppendStatus("检测到已有安装不完整，点击“安装并打开画布”将重新安装。");
            else if (!InstalledPayloadMatchesSource())
                AppendStatus("检测到当前安装与安装包不同，点击“安装并打开画布”将执行更新（旧版本会自动备份）。");
        }
    }

    private void ChooseInstallPath()
    {
        using var dialog = new FolderBrowserDialog { Description = "选择活点地图的软件安装位置（将自动创建 livedotmap 文件夹）", UseDescriptionForTitle = true, ShowNewFolderButton = true };
        if (Directory.Exists(InstallParent)) dialog.InitialDirectory = InstallParent;
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            var (_, productRoot) = ParseProductRoot(dialog.SelectedPath);
            _productRoot = productRoot;
            _installPath.Text = productRoot;
        }
    }

    private async Task InstallAndOpenAsync()
    {
        SetBusy(true);
        try
        {
            ApplyTypedPath();
            var installed = await EnsureInstalledAsync();
            AppendStatus("安装完成。项目文件夹将在画布内选择，不会在安装阶段写入项目。");
            RememberInstallLocation();
            RegisterUninstallEntry(installed);
            OpenProduct(installed);
        }
        catch (Exception error)
        {
            AppendStatus($"安装未完成：{error.Message}");
            MessageBox.Show(this, error.Message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task<string> EnsureInstalledAsync()
    {
        var verification = PayloadVerifier.Verify(SourcePayload);
        if (!verification.Ok) throw new InvalidOperationException($"安装包校验失败：{string.Join("；", verification.Errors)}");
        await MigrateLegacyCurrentLayoutIfSafe();
        if (string.Equals(SourceRoot, InstalledRoot, StringComparison.OrdinalIgnoreCase))
        {
            var installed = PayloadVerifier.Verify(Path.Combine(InstalledRoot, "payload"));
            if (!installed.Ok) throw new InvalidOperationException($"当前安装无法校验：{string.Join("；", installed.Errors)}");
            return InstalledRoot;
        }
        if (Directory.Exists(InstalledRoot))
        {
            if (!HasKeyInstallerFiles(InstalledRoot)) return await RepairInstalledAsync(false); // 关键文件缺失：自动备份并重装
            if (InstalledPayloadMatchesSource()) return InstalledRoot; // 与安装包逐字节一致：同版本不重拷
            return await RepairInstalledAsync(true); // 安装包与当前安装不同：备份并更新
        }

        Directory.CreateDirectory(ProductRoot);
        var temporary = Path.Combine(ProductRoot, $".installing-{Guid.NewGuid():N}");
        try
        {
            AppendStatus("正在复制并校验本地程序文件…");
            await CopyDirectoryAsync(SourceRoot, temporary);
            var copied = PayloadVerifier.Verify(Path.Combine(temporary, "payload"));
            if (!copied.Ok) throw new InvalidOperationException($"复制后校验失败：{string.Join("；", copied.Errors)}");
            AppendStatus("文件校验通过，正在写入安装目录…");
            await MoveDirectoryWithRecoveryMessageAsync(temporary, InstalledRoot, "写入新的程序目录", false);
            await RemoveLegacyShortcutsAsync();
            await CreateProductShortcutsAsync(InstalledRoot);
            AppendStatus($"已安装到：{InstalledRoot}");
            return InstalledRoot;
        }
        catch
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            throw;
        }
    }

    /// <summary>逐字节比对源与已安装的 payload-manifest.json（内含版本号与每文件 SHA256），几 KB 即可代表全部文件是否一致。</summary>
    private bool InstalledPayloadMatchesSource()
    {
        try
        {
            var sourceManifest = Path.Combine(SourcePayload, "payload-manifest.json");
            var installedManifest = Path.Combine(InstalledRoot, "payload", "payload-manifest.json");
            if (!File.Exists(sourceManifest) || !File.Exists(installedManifest)) return false;
            var source = File.ReadAllBytes(sourceManifest);
            var installed = File.ReadAllBytes(installedManifest);
            if (source.Length != installed.Length) return false;
            for (var i = 0; i < source.Length; i++)
            {
                if (source[i] != installed[i]) return false;
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>已安装但与安装包不同（更新）或关键文件缺失（修复）：备份现有 current（含运行中的桥进程停止）后切换为新安装包内容。</summary>
    private async Task<string> RepairInstalledAsync(bool isUpdate)
    {
        var temporary = Path.Combine(ProductRoot, $".updating-{Guid.NewGuid():N}");
        var previous = Path.Combine(ProductRoot, $".previous-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}");
        Directory.CreateDirectory(ProductRoot);
        try
        {
            AppendStatus(isUpdate ? "检测到新版本，正在备份并更新…" : "检测到已有安装不完整，正在自动备份并修复…");
            await CopyDirectoryAsync(SourceRoot, temporary);
            var copied = PayloadVerifier.Verify(Path.Combine(temporary, "payload"));
            if (!copied.Ok) throw new InvalidOperationException($"复制后校验失败：{string.Join("；", copied.Errors)}");
            if (Directory.Exists(InstalledRoot)) await MoveDirectoryWithRecoveryMessageAsync(InstalledRoot, previous, "备份现有程序", true);
            try
            {
                await MoveDirectoryWithRecoveryMessageAsync(temporary, InstalledRoot, "写入修复后的程序", false);
            }
            catch
            {
                // A failed move can leave a third-party or partially-created
                // directory at current. Never delete it during recovery: it is
                // safer to preserve the user's files and let the next repair
                // attempt inspect it.
                if (Directory.Exists(previous)) Directory.Move(previous, InstalledRoot);
                throw;
            }
            await RemoveLegacyShortcutsAsync();
            await CreateProductShortcutsAsync(InstalledRoot);
            AppendStatus($"修复完成：{InstalledRoot}");
            return InstalledRoot;
        }
        catch
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            if (!Directory.Exists(InstalledRoot) && Directory.Exists(previous)) Directory.Move(previous, InstalledRoot);
            throw;
        }
    }

    /// <summary>后台线程复制目录并报告进度（文件序号/总数 + MB）。不阻塞 UI。</summary>
    private async Task CopyDirectoryAsync(string source, string destination)
    {
        var files = EnumerateFilesRecursive(source);
        var totalBytes = files.Sum(f => SafeLength(f));
        var copiedBytes = 0L;
        _progress.Maximum = Math.Max(1, (int)(totalBytes / (1024 * 1024)));
        _progress.Value = 0;
        _progress.Visible = true;
        var done = 0;
        await Task.Run(() =>
        {
            foreach (var file in files)
            {
                done++;
                var relative = Path.GetRelativePath(source, file);
                var target = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                var length = SafeLength(file);
                File.Copy(file, target, true);
                copiedBytes += length;
                var mb = (int)(copiedBytes / (1024 * 1024));
                SafeProgress(() =>
                {
                    _progress.Value = Math.Min(_progress.Maximum, mb);
                    _progress.Text = $"{mb} MB";
                });
                AppendStatus($"正在复制 {done}/{files.Length}：{Path.GetFileName(file)}（{FormatMb(length)}）");
            }
        });
        _progress.Visible = false;
    }

    private static string[] EnumerateFilesRecursive(string root)
    {
        var result = new List<string>();
        void Walk(string directory)
        {
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) result.Add(file);
            }
            foreach (var child in Directory.EnumerateDirectories(directory))
            {
                if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) Walk(child);
            }
        }
        Walk(root);
        return result.ToArray();
    }

    private static long SafeLength(string file)
    {
        try { return new FileInfo(file).Length; } catch { return 0; }
    }

    private static string FormatMb(long bytes) => $"{bytes / 1024.0 / 1024.0:F1} MB";

    private void SafeProgress(Action action)
    {
        if (IsDisposed) return;
        try
        {
            if (InvokeRequired) BeginInvoke(action);
            else action();
        }
        catch { /* 窗口已关闭时忽略 */ }
    }

    private void AppendStatus(string message)
    {
        SafeProgress(() => _status.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}"));
    }

    private async Task MigrateLegacyCurrentLayoutIfSafe()
    {
        var parent = InstallParent;
        var legacyCurrent = Path.Combine(parent, "current");
        if (string.Equals(legacyCurrent, InstalledRoot, StringComparison.OrdinalIgnoreCase) || Directory.Exists(InstalledRoot) || !Directory.Exists(legacyCurrent)) return;
        // Only move a confirmed prior product layout. A generic folder named
        // current must never be claimed by this installer.
        var oldLauncher = Path.Combine(legacyCurrent, "LiveDotMapSetup.exe");
        var oldPayload = Path.Combine(legacyCurrent, "payload");
        if (!File.Exists(oldLauncher) || !Directory.Exists(oldPayload)) return;
        Directory.CreateDirectory(ProductRoot);
        await MoveDirectoryWithRecoveryMessageAsync(legacyCurrent, InstalledRoot, "迁移旧版程序", true);
        foreach (var oldBackup in Directory.EnumerateDirectories(parent, ".previous-*"))
        {
            var destination = Path.Combine(ProductRoot, Path.GetFileName(oldBackup));
            if (!Directory.Exists(destination)) Directory.Move(oldBackup, destination);
        }
        AppendStatus("已安全迁移旧版 current 到 livedotmap；随后会自动校验并修复不兼容文件。");
    }

    /// <summary>
    /// An update must replace the fixed <c>current</c> directory. Windows
    /// refuses to rename a directory while the bundled bridge still owns an
    /// executable handle. Only stop processes whose executable is inside the
    /// confirmed product directory; never touch an unrelated process with a
    /// similar name.
    /// </summary>
    private async Task StopProductProcessesAsync(string productDirectory)
    {
        var normalizedRoot = Path.GetFullPath(productDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var stopped = 0;
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.Id == Environment.ProcessId) continue;
                var executable = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(executable) || !IsPathInside(executable, normalizedRoot)) continue;
                var fileName = Path.GetFileName(executable);
                if (!fileName.Equals("livedot-bridge-win-x64.exe", StringComparison.OrdinalIgnoreCase) &&
                    !fileName.Equals("LiveDotMapSetup.exe", StringComparison.OrdinalIgnoreCase)) continue;
                if (process.CloseMainWindow()) await Task.WhenAny(process.WaitForExitAsync(), Task.Delay(TimeSpan.FromSeconds(2)));
                if (!process.HasExited)
                {
                    process.Kill(true);
                    await Task.WhenAny(process.WaitForExitAsync(), Task.Delay(TimeSpan.FromSeconds(5)));
                }
                stopped++;
            }
            catch
            {
                // The final move below reports a clear, non-destructive error
                // if an OS handle remains locked or cannot be inspected.
            }
            finally { process.Dispose(); }
        }
        if (stopped > 0) AppendStatus($"已停止 {stopped} 个正在运行的活点地图后台进程，继续安全更新。");
    }

    private async Task MoveDirectoryWithRecoveryMessageAsync(string source, string destination, string action, bool stopProductProcesses)
    {
        if (stopProductProcesses) await StopProductProcessesAsync(source);
        try
        {
            Directory.Move(source, destination);
        }
        catch (UnauthorizedAccessException error)
        {
            throw InstallDirectoryUnavailable(action, error);
        }
        catch (IOException error) when (Path.GetFileName(source).Equals("current", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(destination).Equals("current", StringComparison.OrdinalIgnoreCase))
        {
            throw InstallDirectoryUnavailable(action, error);
        }
    }

    private InvalidOperationException InstallDirectoryUnavailable(string action, Exception error) => new(
        $"{action}未完成：无法访问现有程序目录 {InstalledRoot}。安装器没有删除任何现有文件或项目数据。" +
        "已尝试停止活点地图自身的后台服务；请关闭仍打开的活点地图后重试。" +
        "如果该目录由其他 Windows 帐户或安全软件保护，请选择其他软件安装位置。" +
        $"\n\n系统信息：{error.Message}", error);

    private static bool IsPathInside(string path, string root)
    {
        var fullPath = Path.GetFullPath(path);
        var prefix = root + Path.DirectorySeparatorChar;
        return fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    private void OpenProduct(string installedRoot)
    {
        var app = Path.Combine(installedRoot, "payload", "app.html");
        if (!File.Exists(app)) throw new InvalidOperationException("找不到正式画布，请先完成安装或修复。");
        if (EnvironmentFlag("LIVEDOT_SETUP_SKIP_PRODUCT"))
        {
            AppendStatus("已按隔离验证配置跳过打开浏览器画布。");
            return;
        }
        var launcher = Path.Combine(installedRoot, "LiveDotMapSetup.exe");
        if (!File.Exists(launcher)) throw new InvalidOperationException("找不到产品入口，请先完成修复。");
        var info = new ProcessStartInfo { FileName = launcher, UseShellExecute = false, WorkingDirectory = installedRoot };
        info.ArgumentList.Add("--open");
        Process.Start(info);
        AppendStatus("已打开活点地图，画布将在浏览器中打开（窗口已自动退出）。");
    }

    private async Task CreateProductShortcutsAsync(string installedRoot)
    {
        if (EnvironmentFlag("LIVEDOT_SETUP_SKIP_SHORTCUT"))
        {
            AppendStatus("已按隔离验证配置跳过创建快捷方式。");
            return;
        }
        var target = Path.Combine(installedRoot, Path.GetFileName(Environment.ProcessPath ?? "LiveDotMapSetup.exe"));
        var icon = Path.Combine(installedRoot, "payload", "app-icon.ico");
        if (!File.Exists(icon)) icon = Path.Combine(installedRoot, "payload", "favicon.ico");
        var startMenu = Path.Combine(StartMenuDirectory, "活点地图.lnk");
        var desktop = Path.Combine(DesktopDirectory, "活点地图.lnk");
        var errors = new List<string>();
        foreach (var shortcut in new[] { startMenu, desktop })
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(shortcut)!);
                var command = "$shell=New-Object -ComObject WScript.Shell;" +
                    "$shortcut=$shell.CreateShortcut('" + PowerShellQuote(shortcut) + "');" +
                    "$shortcut.TargetPath='" + PowerShellQuote(target) + "';" +
                    "$shortcut.Arguments='--open';" +
                    "$shortcut.WorkingDirectory='" + PowerShellQuote(installedRoot) + "';" +
                    "$shortcut.Description='活点地图';" +
                    "$shortcut.IconLocation='" + PowerShellQuote(icon) + "';" +
                    "$shortcut.Save()";
                var info = new ProcessStartInfo { FileName = "powershell.exe", UseShellExecute = false, CreateNoWindow = true };
                info.ArgumentList.Add("-NoProfile");
                info.ArgumentList.Add("-NonInteractive");
                info.ArgumentList.Add("-ExecutionPolicy");
                info.ArgumentList.Add("Bypass");
                info.ArgumentList.Add("-Command");
                info.ArgumentList.Add(command);
                using var process = Process.Start(info);
                if (process is null) throw new InvalidOperationException("无法启动快捷方式创建器");
                await process.WaitForExitAsync();
                if (process.ExitCode != 0) throw new InvalidOperationException($"快捷方式创建失败（exit {process.ExitCode}）");
            }
            catch (Exception error) { errors.Add($"{shortcut}: {error.Message}"); }
        }
        if (errors.Count == 0) AppendStatus("已创建“活点地图”桌面和开始菜单入口。");
        else AppendStatus("快捷方式未全部创建，安装仍可从当前安装包启动：" + string.Join("；", errors));
    }

    private async Task RemoveLegacyShortcutsAsync()
    {
        var legacy = new[]
        {
            Path.Combine(DesktopDirectory, "活点地图本地桥.lnk"),
            Path.Combine(DesktopDirectory, "活点地图本地桥.cmd"),
            Path.Combine(StartMenuDirectory, "活点地图本地桥.lnk"),
            Path.Combine(StartMenuDirectory, "活点地图本地桥.cmd"),
        };
        var removed = 0;
        foreach (var path in legacy)
        {
            if (!File.Exists(path)) continue;
            var evidence = await ShortcutEvidenceAsync(path);
            if (!IsInsideProductRoot(evidence)) continue;
            try { File.Delete(path); removed++; } catch { /* 老入口无法删除不阻断新安装 */ }
        }
        if (removed > 0) AppendStatus($"已移除 {removed} 个旧版入口；当前只保留“活点地图”。");
    }

    private async Task<string> ShortcutEvidenceAsync(string path)
    {
        try
        {
            if (!path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)) return await File.ReadAllTextAsync(path, Encoding.UTF8);
            var command = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + PowerShellQuote(path) + "');" +
                "Write-Output ($s.TargetPath + [Environment]::NewLine + $s.Arguments)";
            var info = new ProcessStartInfo { FileName = "powershell.exe", UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            info.ArgumentList.Add("-NoProfile");
            info.ArgumentList.Add("-NonInteractive");
            info.ArgumentList.Add("-ExecutionPolicy");
            info.ArgumentList.Add("Bypass");
            info.ArgumentList.Add("-Command");
            info.ArgumentList.Add(command);
            using var process = Process.Start(info);
            if (process is null) return string.Empty;
            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();
            return process.ExitCode == 0 ? output : string.Empty;
        }
        catch { return string.Empty; }
    }

    private bool IsInsideProductRoot(string evidence)
    {
        if (string.IsNullOrWhiteSpace(evidence)) return false;
        var root = Path.GetFullPath(ProductRoot).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var normalizedEvidence = evidence.Replace('/', Path.DirectorySeparatorChar);
        return normalizedEvidence.Contains(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
            normalizedEvidence.Contains(root + Path.AltDirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private void RememberInstallLocation()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(InstallLocationMarker)!);
            File.WriteAllText(InstallLocationMarker, InstallParent + Environment.NewLine, new UTF8Encoding(false));
        }
        catch (Exception error) { AppendStatus($"安装位置记忆未写入，但安装本身已完成：{error.Message}"); }
    }

    /// <summary>写 Windows 设置→应用 的卸载注册表项（HKCU，per-user 无需管理员）。</summary>
    internal static void RegisterUninstallEntry(string installedRoot)
    {
        try
        {
            var version = "2.0.0";
            try
            {
                using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(installedRoot, "payload", "payload-manifest.json"), Encoding.UTF8));
                version = manifest.RootElement.TryGetProperty("version", out var v) ? v.GetString() ?? version : version;
            }
            catch { /* 版本读不到就用默认 */ }
            using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\LiveDotMap");
            key.SetValue("DisplayName", "活点地图");
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", "活点地图");
            key.SetValue("DisplayIcon", $"\"{Path.Combine(installedRoot, "payload", "app-icon.ico")}\"");
            key.SetValue("InstallLocation", installedRoot);
            key.SetValue("UninstallString", $"\"{Path.Combine(installedRoot, "LiveDotMapSetup.exe")}\" --uninstall");
            key.SetValue("NoModify", 1, Microsoft.Win32.RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, Microsoft.Win32.RegistryValueKind.DWord);
            key.SetValue("EstimatedSize", 400000, Microsoft.Win32.RegistryValueKind.DWord);
        }
        catch { /* 注册表写入失败不阻断安装 */ }
    }

    internal static void RemoveUninstallEntry()
    {
        try
        {
            Microsoft.Win32.Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\LiveDotMap", false);
        }
        catch { /* 键不存在也视为成功 */ }
    }

    private void SetBusy(bool busy)
    {
        _installPath.Enabled = !busy;
        _chooseInstallPath.Enabled = !busy;
        _installAndOpen.Enabled = !busy;
        UseWaitCursor = busy;
    }

    private static bool EnvironmentFlag(string name) =>
        string.Equals(Environment.GetEnvironmentVariable(name), "1", StringComparison.Ordinal);

    private static string PowerShellQuote(string value) => value.Replace("'", "''", StringComparison.Ordinal);
}

/// <summary>更新页：--update &lt;新安装包exe&gt;。校验新包 → 复制到 .updating → 延迟脚本切换 current 并重开画布。</summary>
internal sealed class UpdateForm : Form
{
    private readonly TextBox _status = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };
    private readonly ProgressBar _progress = new() { Dock = DockStyle.Top, Height = 14, Visible = false };
    private readonly string _newInstallerPath;

    public UpdateForm(string newInstallerPath)
    {
        _newInstallerPath = newInstallerPath;
        Text = "活点地图更新";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(560, 240);
        Size = new Size(600, 280);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label { Text = "活点地图", AutoSize = true, Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) };
        var subtitle = new Label { Text = "正在更新本地程序，完成后会自动打开画布。", AutoSize = true, Margin = new Padding(0, 0, 0, 12) };
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 4 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(title, 0, 0);
        root.Controls.Add(subtitle, 0, 1);
        root.Controls.Add(_progress, 0, 2);
        root.Controls.Add(_status, 0, 3);
        Controls.Add(root);

        Shown += async (_, _) => await RunAsync();
    }

    private async Task RunAsync()
    {
        var newRoot = Path.GetDirectoryName(Path.GetFullPath(_newInstallerPath));
        var newPayload = newRoot is null ? null : Path.Combine(newRoot, "payload");
        if (newRoot is null || newPayload is null || !Directory.Exists(newPayload))
        {
            Fail("新版本文件不完整，更新已取消。请重新下载安装包后重试。");
            return;
        }
        var verification = PayloadVerifier.Verify(newPayload);
        if (!verification.Ok)
        {
            Fail($"新版本校验失败，更新已取消（现有版本不受影响）：{string.Join("；", verification.Errors)}");
            return;
        }
        var productRoot = Directory.GetParent(LauncherForm.SourceRoot)?.FullName ?? LauncherForm.SourceRoot;
        Directory.CreateDirectory(productRoot);
        var updating = Path.Combine(productRoot, $".updating-{Guid.NewGuid():N}");
        try
        {
            AppendStatus($"新版本 {verification.Version} 校验通过，正在复制…");
            _progress.Visible = true;
            await CopyDirectoryAsync(newRoot, updating);
            // 更新器本体运行在 current 内：把当前 exe 复制进暂存目录，使 .updating 成为完整安装目录。
            var ownExe = Path.Combine(LauncherForm.SourceRoot, "LiveDotMapSetup.exe");
            if (!File.Exists(Path.Combine(updating, "LiveDotMapSetup.exe")) && File.Exists(ownExe))
                File.Copy(ownExe, Path.Combine(updating, "LiveDotMapSetup.exe"), true);
            var copied = PayloadVerifier.Verify(Path.Combine(updating, "payload"));
            if (!copied.Ok) throw new InvalidOperationException($"复制后校验失败：{string.Join("；", copied.Errors)}");
            AppendStatus("准备切换…");
            await ScheduleSwitchAsync(updating, productRoot);
            AppendStatus("更新完成，画布即将重新打开。");
            Close();
        }
        catch (Exception error)
        {
            Fail($"更新未完成，现有版本保持不变：{TrimForDisplay(error.Message)}");
            try { if (Directory.Exists(updating)) Directory.Delete(updating, true); } catch { }
        }
    }

    /// <summary>复制新安装包目录（exe + payload）到 .updating，带进度。</summary>
    private async Task CopyDirectoryAsync(string source, string destination)
    {
        var files = new List<string>();
        void Walk(string directory)
        {
            foreach (var file in Directory.EnumerateFiles(directory))
            {
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) files.Add(file);
            }
            foreach (var child in Directory.EnumerateDirectories(directory))
            {
                if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) Walk(child);
            }
        }
        Walk(source);
        _progress.Maximum = Math.Max(1, files.Count);
        _progress.Value = 0;
        var done = 0;
        await Task.Run(() =>
        {
            foreach (var file in files)
            {
                done++;
                var relative = Path.GetRelativePath(source, file);
                var target = Path.Combine(destination, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.Copy(file, target, true);
                var current = done;
                SafeProgress(() =>
                {
                    _progress.Value = Math.Min(_progress.Maximum, current);
                });
                AppendStatus($"正在复制 {current}/{files.Count}：{Path.GetFileName(file)}");
            }
        });
        _progress.Visible = false;
    }

    private async Task ScheduleSwitchAsync(string updating, string productRoot)
    {
        // 更新器自身运行在 current 内，Windows 不允许移动被占用的目录，
        // 因此写延迟脚本：本进程退出后由 cmd 完成 备份 current → 切换 .updating → 打开画布 → 自删。
        var current = LauncherForm.SourceRoot;
        var previous = Path.Combine(productRoot, $".previous-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}");
        var script = Path.Combine(productRoot, $"switch-{Guid.NewGuid():N}.cmd");
        var launcher = Path.Combine(current, "LiveDotMapSetup.exe").Replace("%", "%%", StringComparison.Ordinal);
        var previousEscaped = previous.Replace("%", "%%", StringComparison.Ordinal);
        var updatingEscaped = updating.Replace("%", "%%", StringComparison.Ordinal);
        var currentEscaped = current.Replace("%", "%%", StringComparison.Ordinal);
        var productEscaped = productRoot.Replace("%", "%%", StringComparison.Ordinal);
        await File.WriteAllTextAsync(script, $"@echo off\r\n" +
            $"timeout /t 2 /nobreak >nul\r\n" +
            $"if exist \"{currentEscaped}\" rename \"{currentEscaped}\" \"{Path.GetFileName(previousEscaped)}\" >nul 2>&1\r\n" +
            $"if exist \"{updatingEscaped}\" rename \"{updatingEscaped}\" \"current\" >nul 2>&1\r\n" +
            $"for /d %%D in (\"{productEscaped}\\.previous-*\") do if not \"%%~D\"==\"{previousEscaped}\" rmdir /s /q \"%%~D\" >nul 2>&1\r\n" +
            $"start \"\" \"{launcher}\" --open\r\n" +
            $"del /f /q \"%~f0\" >nul 2>&1\r\n", Encoding.UTF8);
        var info = new ProcessStartInfo { FileName = "cmd.exe", UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = productRoot };
        info.ArgumentList.Add("/c");
        info.ArgumentList.Add(script);
        Process.Start(info);
        await Task.CompletedTask;
    }

    private void Fail(string message)
    {
        AppendStatus(message);
        MessageBox.Show(this, message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static string TrimForDisplay(string value) => value.Length <= 500 ? value : value[..500] + "…";

    private void SafeProgress(Action action)
    {
        if (IsDisposed) return;
        try
        {
            if (InvokeRequired) BeginInvoke(action);
            else action();
        }
        catch { }
    }

    private void AppendStatus(string message) => SafeProgress(() => _status.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}"));
}

/// <summary>卸载页：--uninstall（Windows 设置→应用入口）。确认后删除注册表项并调度清理脚本，项目地图保留。</summary>
internal sealed class UninstallForm : Form
{
    private readonly TextBox _status = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };

    public UninstallForm()
    {
        Text = "卸载活点地图";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(560, 240);
        Size = new Size(600, 280);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label { Text = "卸载活点地图", AutoSize = true, Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) };
        var subtitle = new Label { Text = "将删除本地程序与快捷方式，项目文件夹中的地图和 Markdown 会保留。", AutoSize = true, MaximumSize = new Size(540, 0), Margin = new Padding(0, 0, 0, 12) };
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 3 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(title, 0, 0);
        root.Controls.Add(subtitle, 0, 1);
        root.Controls.Add(_status, 0, 2);
        Controls.Add(root);

        Shown += async (_, _) => await RunAsync();
    }

    private async Task RunAsync()
    {
        var installedRoot = LauncherForm.CurrentInstalledRoot;
        if (!Directory.Exists(installedRoot))
        {
            AppendStatus("没有发现已安装程序。");
            return;
        }
        var answer = MessageBox.Show(this,
            "将删除活点地图程序、启动菜单入口和程序备份。项目文件夹里的 .live-dot-map、Markdown、历史和备份会保留，不会删除。继续卸载吗？",
            "卸载活点地图", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes)
        {
            AppendStatus("已取消卸载。");
            Close();
            return;
        }
        try
        {
            LauncherForm.RemoveUninstallEntry();
            await ScheduleProgramRemovalAsync(installedRoot);
            AppendStatus("卸载已安排。窗口关闭后程序目录会被删除，项目地图保留。");
            MessageBox.Show(this, "卸载已安排完成。项目地图和 Markdown 已保留。", "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception error)
        {
            AppendStatus($"卸载未完成：{error.Message}");
            MessageBox.Show(this, error.Message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task ScheduleProgramRemovalAsync(string installedRoot)
    {
        var productRoot = Directory.GetParent(installedRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))?.FullName ?? installedRoot;
        var script = Path.Combine(productRoot, $"remove-{Guid.NewGuid():N}.cmd");
        var current = installedRoot.Replace("%", "%%", StringComparison.Ordinal);
        var startMenu = Path.Combine(LauncherForm.StartMenuDirectory, "活点地图.lnk").Replace("%", "%%", StringComparison.Ordinal);
        var desktop = Path.Combine(LauncherForm.DesktopDirectory, "活点地图.lnk").Replace("%", "%%", StringComparison.Ordinal);
        var previousPattern = Path.Combine(productRoot, ".previous-*").Replace("%", "%%", StringComparison.Ordinal);
        var updatingPattern = Path.Combine(productRoot, ".updating-*").Replace("%", "%%", StringComparison.Ordinal);
        var installingPattern = Path.Combine(productRoot, ".installing-*").Replace("%", "%%", StringComparison.Ordinal);
        var marker = Path.Combine(productRoot, "install-location.txt").Replace("%", "%%", StringComparison.Ordinal);
        await File.WriteAllTextAsync(script, $"@echo off\r\n:wait\r\ntimeout /t 2 /nobreak >nul\r\nrmdir /s /q \"{current}\" >nul 2>&1\r\nfor /d %%D in (\"{previousPattern}\") do rmdir /s /q \"%%~D\" >nul 2>&1\r\nfor /d %%D in (\"{updatingPattern}\") do rmdir /s /q \"%%~D\" >nul 2>&1\r\nfor /d %%D in (\"{installingPattern}\") do rmdir /s /q \"%%~D\" >nul 2>&1\r\ndel /f /q \"{startMenu}\" >nul 2>&1\r\ndel /f /q \"{desktop}\" >nul 2>&1\r\ndel /f /q \"{marker}\" >nul 2>&1\r\ndel /f /q \"%~f0\" >nul 2>&1\r\n", Encoding.UTF8);
        var info = new ProcessStartInfo { FileName = "cmd.exe", UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = productRoot };
        info.ArgumentList.Add("/c");
        info.ArgumentList.Add(script);
        Process.Start(info);
        await Task.CompletedTask;
    }

    private void AppendStatus(string message) => _status.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
}
