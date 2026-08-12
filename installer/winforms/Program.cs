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
        Application.Run(new LauncherForm());
        return 0;
    }
}

internal sealed record VerificationResult(bool Ok, string Version, IReadOnlyList<string> Errors);

internal static class PayloadVerifier
{
    public static VerificationResult Verify(string payloadRoot)
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
            foreach (var property in files.EnumerateObject())
            {
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
            foreach (var required in new[] { "app.html", "livedot-bridge-win-x64.exe" })
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

internal sealed class LauncherForm : Form
{
    private readonly TextBox _projectPath = new() { Dock = DockStyle.Fill, ReadOnly = true };
    private readonly TextBox _status = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };
    private readonly Button _chooseProject = new() { Text = "选择项目文件夹", AutoSize = true };
    private readonly Button _installAndStart = new() { Text = "安装并开始使用", AutoSize = true, Enabled = false };
    private readonly Button _start = new() { Text = "打开已选项目", AutoSize = true, Enabled = false };
    private readonly Button _repairUpdate = new() { Text = "修复 / 更新", AutoSize = true, Enabled = false };
    private readonly Button _uninstall = new() { Text = "卸载（保留地图）", AutoSize = true, Enabled = false };
    private readonly Button _openInstallFolder = new() { Text = "打开安装位置", AutoSize = true };
    private Process? _bridge;

    private static string ProductRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LiveDotMap");
    private static string InstalledRoot => Path.Combine(ProductRoot, "current");
    private static string RecentProjectPath => Path.Combine(ProductRoot, "recent-project.txt");
    private static string SourceRoot => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    private static string SourcePayload => Path.Combine(SourceRoot, "payload");

    public LauncherForm()
    {
        Text = "活点地图";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(720, 430);
        Size = new Size(780, 500);
        Font = new Font("Microsoft YaHei UI", 9F);

        var title = new Label { Text = "活点地图 · 本地协作", AutoSize = true, Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold), Margin = new Padding(0, 0, 0, 4) };
        var subtitle = new Label { Text = "选择一个项目文件夹。地图和 Agent 配置只写入该项目，不会上传项目内容。", AutoSize = true, MaximumSize = new Size(680, 0), Margin = new Padding(0, 0, 0, 16) };
        var projectLabel = new Label { Text = "项目文件夹", AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
        var pathRow = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 12) };
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        pathRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        pathRow.Controls.Add(_projectPath, 0, 0);
        pathRow.Controls.Add(_chooseProject, 1, 0);

        var actionRow = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 0, 0, 16) };
        actionRow.Controls.Add(_installAndStart);
        actionRow.Controls.Add(_start);
        actionRow.Controls.Add(_repairUpdate);
        actionRow.Controls.Add(_uninstall);
        actionRow.Controls.Add(_openInstallFolder);

        var statusLabel = new Label { Text = "状态", AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 7 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(title, 0, 0);
        root.Controls.Add(subtitle, 0, 1);
        root.Controls.Add(projectLabel, 0, 2);
        root.Controls.Add(pathRow, 0, 3);
        root.Controls.Add(actionRow, 0, 4);
        root.Controls.Add(statusLabel, 0, 5);
        root.Controls.Add(_status, 0, 6);
        Controls.Add(root);

        _chooseProject.Click += (_, _) => ChooseProject();
        _installAndStart.Click += async (_, _) => await InstallAndStartAsync();
        _start.Click += async (_, _) => await StartAsync(false);
        _repairUpdate.Click += async (_, _) => await RepairOrUpdateAsync();
        _uninstall.Click += async (_, _) => await UninstallAsync();
        _openInstallFolder.Click += (_, _) => OpenInstallFolder();
        Load += (_, _) => LoadRecentProject();
        FormClosed += (_, _) => _bridge?.Dispose();
    }

    private void LoadRecentProject()
    {
        if (File.Exists(RecentProjectPath))
        {
            var path = File.ReadAllText(RecentProjectPath, Encoding.UTF8).Trim();
            if (Directory.Exists(path)) SetProject(path);
        }
        var verify = PayloadVerifier.Verify(SourcePayload);
        AppendStatus(verify.Ok
            ? $"安装包已校验：版本 {verify.Version}。安装将只写入当前 Windows 用户目录，不请求管理员权限。"
            : $"安装包自检失败，不能继续安装：{string.Join("；", verify.Errors)}");
    }

    private void ChooseProject()
    {
        using var dialog = new FolderBrowserDialog { Description = "选择要使用活点地图的项目文件夹", UseDescriptionForTitle = true, ShowNewFolderButton = false };
        if (!string.IsNullOrWhiteSpace(_projectPath.Text) && Directory.Exists(_projectPath.Text)) dialog.InitialDirectory = _projectPath.Text;
        if (dialog.ShowDialog(this) == DialogResult.OK) SetProject(dialog.SelectedPath);
    }

    private void SetProject(string path)
    {
        _projectPath.Text = Path.GetFullPath(path);
        Directory.CreateDirectory(ProductRoot);
        File.WriteAllText(RecentProjectPath, _projectPath.Text + Environment.NewLine, new UTF8Encoding(false));
        _installAndStart.Enabled = true;
        _start.Enabled = Directory.Exists(InstalledRoot);
        _repairUpdate.Enabled = Directory.Exists(InstalledRoot) && !string.Equals(SourceRoot, InstalledRoot, StringComparison.OrdinalIgnoreCase);
        _uninstall.Enabled = Directory.Exists(InstalledRoot);
        AppendStatus($"已选择项目：{_projectPath.Text}");
    }

    private async Task InstallAndStartAsync()
    {
        SetBusy(true);
        try
        {
            var installed = await EnsureInstalledAsync();
            await ConfigureProjectAsync(installed);
            await StartBridgeAsync(installed);
        }
        catch (Exception error)
        {
            AppendStatus($"未完成：{error.Message}");
            MessageBox.Show(this, error.Message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task StartAsync(bool configure)
    {
        SetBusy(true);
        try
        {
            if (!Directory.Exists(InstalledRoot)) throw new InvalidOperationException("尚未安装。请先点击“安装并开始使用”。");
            if (configure) await ConfigureProjectAsync(InstalledRoot);
            await StartBridgeAsync(InstalledRoot);
        }
        catch (Exception error)
        {
            AppendStatus($"未完成：{error.Message}");
            MessageBox.Show(this, error.Message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task RepairOrUpdateAsync()
    {
        SetBusy(true);
        try
        {
            var installed = await UpdateInstalledAsync();
            AppendStatus($"已完成修复/更新：{installed}");
            _start.Enabled = true;
            MessageBox.Show(this, "本地程序已更新。再次点击“打开已选项目”即可继续使用。", "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            AppendStatus($"修复/更新失败，旧版本保持不变：{error.Message}");
            MessageBox.Show(this, $"修复/更新失败，旧版本仍可使用。\n\n{error.Message}", "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task<string> UpdateInstalledAsync()
    {
        if (string.Equals(SourceRoot, InstalledRoot, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("当前已从安装目录启动。请下载并双击新版本 Setup 后再更新。");
        var verification = PayloadVerifier.Verify(SourcePayload);
        if (!verification.Ok) throw new InvalidOperationException($"新安装包校验失败：{string.Join("；", verification.Errors)}");
        if (!Directory.Exists(InstalledRoot)) return await EnsureInstalledAsync();

        var temporary = Path.Combine(ProductRoot, $".updating-{Guid.NewGuid():N}");
        var previous = Path.Combine(ProductRoot, $".previous-{Guid.NewGuid():N}");
        Directory.CreateDirectory(ProductRoot);
        try
        {
            AppendStatus("正在复制并校验新版本；原版本暂不覆盖…");
            CopyDirectory(SourceRoot, temporary);
            var copied = PayloadVerifier.Verify(Path.Combine(temporary, "payload"));
            if (!copied.Ok) throw new InvalidOperationException($"新版本复制后校验失败：{string.Join("；", copied.Errors)}");
            Directory.Move(InstalledRoot, previous);
            try
            {
                Directory.Move(temporary, InstalledRoot);
            }
            catch
            {
                if (Directory.Exists(InstalledRoot)) Directory.Delete(InstalledRoot, true);
                Directory.Move(previous, InstalledRoot);
                throw;
            }
            try { Directory.Delete(previous, true); } catch { AppendStatus("旧版本暂存目录删除失败，已保留以便人工恢复：" + previous); }
            return InstalledRoot;
        }
        catch
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            if (!Directory.Exists(InstalledRoot) && Directory.Exists(previous)) Directory.Move(previous, InstalledRoot);
            throw;
        }
    }

    private async Task UninstallAsync()
    {
        if (!Directory.Exists(InstalledRoot))
        {
            AppendStatus("没有发现已安装程序。");
            return;
        }
        var answer = MessageBox.Show(this,
            "将删除活点地图程序、启动菜单入口和它自己写入的 Agent 配置。\n\n项目里的 .live-dot-map/map.json、Markdown、历史和备份会保留，不会删除。继续卸载吗？",
            "卸载活点地图", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes) return;
        SetBusy(true);
        try
        {
            _bridge?.Kill(true);
            _bridge?.Dispose();
            _bridge = null;
            var project = string.IsNullOrWhiteSpace(_projectPath.Text) ? null : _projectPath.Text;
            if (!string.IsNullOrWhiteSpace(project) && Directory.Exists(project))
            {
                var bridge = PayloadBridge(InstalledRoot);
                var result = await RunToExitAsync(bridge, new[] { "uninstall", "--project", project });
                if (result.ExitCode != 0) throw new InvalidOperationException($"项目配置未完全恢复：{TrimForDisplay(result.Error)}");
                AppendStatus("Agent 原配置已按安装备份恢复；项目地图保留。");
            }
            await ScheduleProgramRemovalAsync();
            AppendStatus("卸载已安排。窗口关闭后程序目录会被删除，项目地图保留。");
            MessageBox.Show(this, "卸载已安排完成。项目地图和 Markdown 已保留。", "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Close();
        }
        catch (Exception error)
        {
            AppendStatus($"卸载未完成：{error.Message}");
            MessageBox.Show(this, error.Message, "活点地图", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task ScheduleProgramRemovalAsync()
    {
        var script = Path.Combine(ProductRoot, $"remove-{Guid.NewGuid():N}.cmd");
        var current = InstalledRoot.Replace("%", "%%", StringComparison.Ordinal);
        var product = ProductRoot.Replace("%", "%%", StringComparison.Ordinal);
        var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "活点地图.lnk").Replace("%", "%%", StringComparison.Ordinal);
        await File.WriteAllTextAsync(script, $"@echo off\r\n:wait\r\ntimeout /t 2 /nobreak >nul\r\nrmdir /s /q \"{current}\" >nul 2>&1\r\ndel /f /q \"{startMenu}\" >nul 2>&1\r\ndel /f /q \"%~f0\" >nul 2>&1\r\n", Encoding.UTF8);
        var info = new ProcessStartInfo { FileName = "cmd.exe", UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = product };
        info.ArgumentList.Add("/c");
        info.ArgumentList.Add(script);
        Process.Start(info);
    }

    private async Task<string> EnsureInstalledAsync()
    {
        var verification = PayloadVerifier.Verify(SourcePayload);
        if (!verification.Ok) throw new InvalidOperationException($"安装包校验失败：{string.Join("；", verification.Errors)}");
        if (string.Equals(SourceRoot, InstalledRoot, StringComparison.OrdinalIgnoreCase)) return InstalledRoot;
        if (Directory.Exists(InstalledRoot))
        {
            var installedVerification = PayloadVerifier.Verify(Path.Combine(InstalledRoot, "payload"));
            if (!installedVerification.Ok) throw new InvalidOperationException("已有安装损坏，请先在“打开安装位置”中移除 current 文件夹后重新运行安装包。");
            AppendStatus($"已安装版本 {installedVerification.Version}，未覆盖现有程序。");
            return InstalledRoot;
        }

        Directory.CreateDirectory(ProductRoot);
        var temporary = Path.Combine(ProductRoot, $".installing-{Guid.NewGuid():N}");
        try
        {
            AppendStatus("正在复制并校验本地程序文件…");
            CopyDirectory(SourceRoot, temporary);
            var copiedVerification = PayloadVerifier.Verify(Path.Combine(temporary, "payload"));
            if (!copiedVerification.Ok) throw new InvalidOperationException($"复制后校验失败：{string.Join("；", copiedVerification.Errors)}");
            Directory.Move(temporary, InstalledRoot);
            await CreateStartMenuShortcutAsync(Path.Combine(InstalledRoot, Path.GetFileName(Environment.ProcessPath ?? "LiveDotMapSetup.exe")));
            AppendStatus($"已安装到：{InstalledRoot}");
            return InstalledRoot;
        }
        catch
        {
            if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            throw;
        }
    }

    private async Task ConfigureProjectAsync(string installedRoot)
    {
        var project = RequireProject();
        var bridge = PayloadBridge(installedRoot);
        var app = Path.Combine(installedRoot, "payload", "app.html");
        AppendStatus("正在准备本项目的地图和已发现 Agent 配置…");
        var result = await RunToExitAsync(bridge, new[] { "install", "--project", project, "--app", app });
        if (result.ExitCode != 0) throw new InvalidOperationException($"项目准备失败：{TrimForDisplay(result.Error)}");
        AppendStatus("项目已准备。若 Agent 要求信任 hooks 或插件，请在对应 Agent 的图形确认中同意。" );
    }

    private async Task StartBridgeAsync(string installedRoot)
    {
        if (_bridge is { HasExited: false })
        {
            AppendStatus("本次运行的本地桥已经启动，浏览器画布仍可继续使用。");
            return;
        }
        var project = RequireProject();
        var bridge = PayloadBridge(installedRoot);
        var app = Path.Combine(installedRoot, "payload", "app.html");
        var process = StartHidden(bridge, new[] { "serve", "--project", project, "--app", app });
        var lineTask = process.StandardOutput.ReadLineAsync();
        var completed = await Task.WhenAny(lineTask, Task.Delay(TimeSpan.FromSeconds(15)));
        if (completed != lineTask)
        {
            process.Kill(true);
            throw new TimeoutException("本地桥启动超时。请确认项目路径可读写后重试。");
        }
        var line = await lineTask;
        if (string.IsNullOrWhiteSpace(line))
        {
            var error = await process.StandardError.ReadToEndAsync();
            process.Dispose();
            throw new InvalidOperationException($"本地桥未返回启动信息：{TrimForDisplay(error)}");
        }
        using var response = JsonDocument.Parse(line);
        var url = response.RootElement.GetProperty("url").GetString();
        if (string.IsNullOrWhiteSpace(url) || !url.StartsWith("http://127.0.0.1:", StringComparison.Ordinal)) throw new InvalidOperationException("本地桥返回了无效地址。");
        _bridge = process;
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        AppendStatus("已打开画布。关闭此窗口不会删除项目地图；再次从开始菜单打开即可继续。" );
    }

    private static Process StartHidden(string executable, IEnumerable<string> arguments)
    {
        var info = new ProcessStartInfo { FileName = executable, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Path.GetDirectoryName(executable)! };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        return Process.Start(info) ?? throw new InvalidOperationException("无法启动本地桥。");
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunToExitAsync(string executable, IEnumerable<string> arguments)
    {
        using var process = StartHidden(executable, arguments);
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode, await stdout, await stderr);
    }

    private static string PayloadBridge(string root)
    {
        var path = Path.Combine(root, "payload", "livedot-bridge-win-x64.exe");
        if (!File.Exists(path)) throw new FileNotFoundException("找不到本地桥程序，请重新安装。", path);
        return path;
    }

    private string RequireProject()
    {
        if (string.IsNullOrWhiteSpace(_projectPath.Text) || !Directory.Exists(_projectPath.Text)) throw new InvalidOperationException("请先选择一个存在的项目文件夹。");
        return _projectPath.Text;
    }

    private async Task CreateStartMenuShortcutAsync(string target)
    {
        var menu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
        Directory.CreateDirectory(menu);
        var shortcut = Path.Combine(menu, "活点地图.lnk");
        var command = "$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut('" + PowerShellQuote(shortcut) + "');$shortcut.TargetPath='" + PowerShellQuote(target) + "';$shortcut.WorkingDirectory='" + PowerShellQuote(Path.GetDirectoryName(target)!) + "';$shortcut.Save()";
        var info = new ProcessStartInfo { FileName = "powershell.exe", UseShellExecute = false, CreateNoWindow = true };
        info.ArgumentList.Add("-NoProfile");
        info.ArgumentList.Add("-NonInteractive");
        info.ArgumentList.Add("-ExecutionPolicy");
        info.ArgumentList.Add("Bypass");
        info.ArgumentList.Add("-Command");
        info.ArgumentList.Add(command);
        using var process = Process.Start(info);
        if (process is null) throw new InvalidOperationException("无法创建开始菜单入口。");
        await process.WaitForExitAsync();
        if (process.ExitCode == 0) AppendStatus("已创建开始菜单入口“活点地图”。");
        else AppendStatus("未能创建开始菜单入口；安装仍可从当前安装包启动。" );
    }

    private static string PowerShellQuote(string value) => value.Replace("'", "''", StringComparison.Ordinal);

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var directory in Directory.EnumerateDirectories(source)) CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
    }

    private static string TrimForDisplay(string value)
    {
        var text = value.Trim();
        return text.Length <= 500 ? text : text[..500] + "…";
    }

    private void SetBusy(bool busy)
    {
        _chooseProject.Enabled = !busy;
        _installAndStart.Enabled = !busy && !string.IsNullOrWhiteSpace(_projectPath.Text);
        _start.Enabled = !busy && Directory.Exists(InstalledRoot) && !string.IsNullOrWhiteSpace(_projectPath.Text);
        _repairUpdate.Enabled = !busy && Directory.Exists(InstalledRoot) && !string.Equals(SourceRoot, InstalledRoot, StringComparison.OrdinalIgnoreCase);
        _uninstall.Enabled = !busy && Directory.Exists(InstalledRoot);
        UseWaitCursor = busy;
    }

    private void OpenInstallFolder()
    {
        Directory.CreateDirectory(ProductRoot);
        Process.Start(new ProcessStartInfo { FileName = ProductRoot, UseShellExecute = true });
    }

    private void AppendStatus(string message)
    {
        _status.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
    }
}
