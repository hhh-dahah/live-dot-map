using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.VisualBasic.FileIO;

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

        if (args.Length == 1 && string.Equals(args[0], "--self-check", StringComparison.Ordinal))
        {
            // CI/验收用：按真实逻辑解析 SourceRoot（单文件模式会触发内嵌解压），自检后输出 JSON。
            var result = PayloadVerifier.Verify(LauncherForm.SourcePayload);
            Console.Out.WriteLine(JsonSerializer.Serialize(new { sourceRoot = LauncherForm.SourceRoot, result.Ok, result.Version, result.Errors }));
            return result.Ok ? 0 : 1;
        }

        ApplicationConfiguration.Initialize();

        if (args.Length == 2 && string.Equals(args[0], "--recycle-staging", StringComparison.Ordinal))
            return NativeHelperActions.RecycleStaging(args[1]);

        if (args.Length == 1 && string.Equals(args[0], "--pick-editor", StringComparison.Ordinal))
            return NativeHelperActions.PickEditor();

        if (args.Length == 2 && string.Equals(args[0], "--save-as", StringComparison.Ordinal))
            return NativeHelperActions.SaveAs(args[1]);

        if (args.Length == 2 && string.Equals(args[0], "--open-default", StringComparison.Ordinal))
            return NativeHelperActions.OpenDefault(args[1]);

        if (args.Length == 2 && string.Equals(args[0], "--open-folder", StringComparison.Ordinal))
            return NativeHelperActions.OpenFolder(args[1]);

        if (args.Length == 3 && string.Equals(args[0], "--open-manual", StringComparison.Ordinal))
            return NativeHelperActions.OpenManual(args[1], args[2]);

        if (args.Length >= 1 && string.Equals(args[0], "--open", StringComparison.Ordinal))
        {
            // --open [project]: 产品入口，直接打开画布（快捷方式与更新器调用）。
            // 无窗口启动：起桥 → 浏览器打开画布 → 本进程退出，桥 detached 后台运行。
            Application.Run(new SilentOpenContext(args.Length >= 2 ? args[1] : null));
            return 0;
        }

        if (args.Length >= 2 && string.Equals(args[0], "--update", StringComparison.Ordinal))
        {
            // --update <新安装包exe路径> [已安装current目录]: 产品内更新链路调用，替换 current 后重开画布。
            // 第二个参数省略时按 install-location.txt 记忆位置解析（兼容旧版桥的调用）。
            Application.Run(new UpdateForm(args[1], args.Length >= 3 ? args[2] : null));
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

/// <summary>
/// Bridge 只能通过这些固定模式请求少数需要 Windows UI/API 的动作。所有结果
/// 都是单行 JSON；不接受 shell 命令，也不解释额外参数。
/// </summary>
internal static class NativeHelperActions
{
    private static readonly Regex PurgeTransaction = new(
        @"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static void Write(object value) => Console.Out.WriteLine(JsonSerializer.Serialize(value));

    private static bool IsControlledPurgePath(string value, out string fullPath, out string error)
    {
        fullPath = string.Empty;
        error = "";
        try
        {
            fullPath = Path.GetFullPath(value);
            var leaf = new DirectoryInfo(fullPath);
            var purge = leaf.Parent;
            var bridge = purge?.Parent;
            var map = bridge?.Parent;
            var maps = map?.Parent;
            var data = maps?.Parent;
            if (!leaf.Exists || !PurgeTransaction.IsMatch(leaf.Name)
                || !string.Equals(purge?.Name, "purge-staging", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(bridge?.Name, ".bridge", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(maps?.Name, "maps", StringComparison.OrdinalIgnoreCase)
                || !string.Equals(data?.Name, ".live-dot-map", StringComparison.OrdinalIgnoreCase))
            {
                error = "回收站暂存路径不符合产品目录约束";
                return false;
            }
            for (DirectoryInfo? current = leaf; current is not null; current = current.Parent)
            {
                if ((current.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "回收站暂存路径不能经过符号链接或联接";
                    return false;
                }
                if (string.Equals(current.FullName, data!.FullName, StringComparison.OrdinalIgnoreCase)) break;
            }
            return true;
        }
        catch (Exception exception)
        {
            error = exception.Message;
            return false;
        }
    }

    public static int RecycleStaging(string value)
    {
        if (!IsControlledPurgePath(value, out var fullPath, out var validationError))
        {
            Write(new { ok = false, code = "PURGE_STAGING_PATH_INVALID", message = validationError });
            return 2;
        }
        try
        {
            FileSystem.DeleteDirectory(fullPath, UIOption.OnlyErrorDialogs, RecycleOption.SendToRecycleBin, UICancelOption.ThrowException);
            Write(new { ok = true, recycled = true });
            return 0;
        }
        catch (Exception exception)
        {
            Write(new { ok = false, code = "RECYCLE_BIN_FAILED", message = exception.Message });
            return 1;
        }
    }

    public static int PickEditor()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "选择 Markdown 编辑程序",
            Filter = "Windows 程序 (*.exe)|*.exe",
            CheckFileExists = true,
            Multiselect = false,
            RestoreDirectory = true,
        };
        if (dialog.ShowDialog() != DialogResult.OK)
        {
            Write(new { ok = false, cancelled = true });
            return 0;
        }
        var selected = Path.GetFullPath(dialog.FileName);
        if (!string.Equals(Path.GetExtension(selected), ".exe", StringComparison.OrdinalIgnoreCase))
        {
            Write(new { ok = false, code = "EDITOR_EXECUTABLE_INVALID", message = "只能选择 .exe 程序" });
            return 2;
        }
        Write(new { ok = true, path = selected });
        return 0;
    }

    public static int SaveAs(string sourceValue)
    {
        try
        {
            var source = Path.GetFullPath(sourceValue);
            var metadata = new FileInfo(source);
            if (!metadata.Exists || (metadata.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("源文件不存在或不是普通文件");
            using var dialog = new SaveFileDialog
            {
                Title = "另存 Markdown 副本",
                FileName = metadata.Name,
                DefaultExt = metadata.Extension.TrimStart('.'),
                Filter = "Markdown 文件 (*.md)|*.md|所有文件 (*.*)|*.*",
                AddExtension = true,
                OverwritePrompt = true,
                RestoreDirectory = true,
            };
            if (dialog.ShowDialog() != DialogResult.OK)
            {
                Write(new { ok = false, cancelled = true });
                return 0;
            }
            var target = Path.GetFullPath(dialog.FileName);
            if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("另存目标不能覆盖原资料包文件");
            File.Copy(source, target, overwrite: false);
            Write(new { ok = true, path = target });
            return 0;
        }
        catch (Exception exception)
        {
            Write(new { ok = false, code = "SAVE_AS_FAILED", message = exception.Message });
            return 1;
        }
    }

    private static string RequireOrdinaryFile(string value)
    {
        var path = Path.GetFullPath(value);
        var metadata = new FileInfo(path);
        if (!metadata.Exists || (metadata.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("目标不存在或不是普通文件");
        return path;
    }

    public static int OpenDefault(string targetValue)
    {
        try
        {
            var target = RequireOrdinaryFile(targetValue);
            Process.Start(new ProcessStartInfo { FileName = target, UseShellExecute = true });
            Write(new { ok = true, launched = true });
            return 0;
        }
        catch (Exception exception)
        {
            Write(new { ok = false, code = "OPEN_DEFAULT_FAILED", message = exception.Message });
            return 1;
        }
    }

    public static int OpenFolder(string targetValue)
    {
        try
        {
            var target = Path.GetFullPath(targetValue);
            var info = new ProcessStartInfo { FileName = "explorer.exe", UseShellExecute = false, CreateNoWindow = true };
            if (File.Exists(target))
            {
                // 文件目标直达：打开所在文件夹并选中该文件。
                // /select 需要 "/select,\"<path>\"" 的固定参数形式，不能用 ArgumentList 逐段拼接。
                if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("目标不是普通文件");
                info.Arguments = "/select,\"" + target + "\"";
            }
            else
            {
                var metadata = new DirectoryInfo(target);
                if (!metadata.Exists || (metadata.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("目标文件夹不存在或不是普通目录");
                info.ArgumentList.Add(target);
            }
            Process.Start(info);
            Write(new { ok = true, launched = true });
            return 0;
        }
        catch (Exception exception)
        {
            Write(new { ok = false, code = "OPEN_FOLDER_FAILED", message = exception.Message });
            return 1;
        }
    }

    public static int OpenManual(string executableValue, string targetValue)
    {
        try
        {
            var executable = RequireOrdinaryFile(executableValue);
            if (!string.Equals(Path.GetExtension(executable), ".exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("手动编辑器必须是 .exe 程序");
            var target = RequireOrdinaryFile(targetValue);
            var info = new ProcessStartInfo { FileName = executable, UseShellExecute = false };
            info.ArgumentList.Add(target);
            Process.Start(info);
            Write(new { ok = true, launched = true });
            return 0;
        }
        catch (Exception exception)
        {
            Write(new { ok = false, code = "OPEN_MANUAL_FAILED", message = exception.Message });
            return 1;
        }
    }
}

internal sealed record VerificationResult(bool Ok, string Version, IReadOnlyList<string> Errors);

/// <summary>
/// 单文件分发时的内嵌 payload 来源：exe 旁边没有 payload/ 目录时，
/// 把构建期嵌入的 payload.zip 解压到 %TEMP%\livedotmap-setup\&lt;哈希&gt;\ 并复用（按内容哈希缓存，
/// 同一个安装包重复运行只解压一次；旧版本目录尽力清理，占用中则跳过）。
/// </summary>
internal static class EmbeddedPayloadSource
{
    public static string EnsureExtracted()
    {
        var assembly = typeof(EmbeddedPayloadSource).Assembly;
        var resourceName = assembly.GetManifestResourceNames()
            .FirstOrDefault(name => name.EndsWith("payload.zip", StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("安装包缺少内嵌 payload，请重新下载完整安装包。");

        byte[] bytes;
        using (var resourceStream = assembly.GetManifestResourceStream(resourceName)!)
        using (var memory = new MemoryStream((int)Math.Min(resourceStream.Length, int.MaxValue)))
        {
            resourceStream.CopyTo(memory);
            bytes = memory.ToArray();
        }
        var hash = Convert.ToHexString(SHA256.HashData(bytes))[..12].ToLowerInvariant();

        var parent = Path.Combine(Path.GetTempPath(), "livedotmap-setup");
        var targetRoot = Path.Combine(parent, hash);
        var marker = Path.Combine(targetRoot, ".complete");
        if (!File.Exists(marker))
        {
            var staging = $"{targetRoot}.staging-{Environment.ProcessId}";
            try
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
                Directory.CreateDirectory(staging);
                using (var archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read))
                    archive.ExtractToDirectory(staging);
                if (Directory.Exists(targetRoot)) Directory.Delete(targetRoot, recursive: true);
                Directory.Move(staging, targetRoot);
                File.WriteAllText(marker, DateTimeOffset.UtcNow.ToString("O"));
            }
            catch (IOException) when (File.Exists(marker))
            {
                // 并发解压时另一个进程已完成，直接复用。
            }
            finally
            {
                try { if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true); } catch { /* 占用中则跳过 */ }
            }
        }

        try
        {
            foreach (var dir in Directory.GetDirectories(parent))
            {
                if (!string.Equals(dir, targetRoot, StringComparison.OrdinalIgnoreCase)) Directory.Delete(dir, recursive: true);
            }
        }
        catch { /* 旧版本目录占用中则下次再清 */ }

        return targetRoot;
    }
}

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
        // serve 现在是“首个常驻、后续复用”的用户级单例协调入口。
        // Process 句柄不代表 Bridge 所有权；再次打开项目时只释放本地句柄，绝不能杀掉常驻桥。
        _session?.Dispose();
        _session = null;
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
        if (string.Equals(Environment.GetEnvironmentVariable("LIVEDOT_SETUP_SKIP_BROWSER"), "1", StringComparison.Ordinal)) _status("已通过稳定本机 Bridge 建立一次性画布会话（隔离验证跳过浏览器）。");
        else Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        _status(successMessage + " 画布在浏览器中运行，本进程已退出。");
        WriteLastProject(project);
    }

    public void StopSession()
    {
        // 只释放 launcher 持有的进程句柄；全局 Bridge 的退出/更新必须走受认证控制通道。
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

    private static string? _sourceRoot;

    /// <summary>
    /// 安装包源目录。优先用 exe 所在目录（开发输出与已安装目录旁边都带 payload/）；
    /// 单文件分发（用户只下载了一个 exe）时，把内嵌的 payload.zip 解压到临时目录后用那份。
    /// </summary>
    public static string SourceRoot => _sourceRoot ??= ResolveSourceRoot();

    private static string ResolveSourceRoot()
    {
        var baseDirectory = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (Directory.Exists(Path.Combine(baseDirectory, "payload"))) return baseDirectory;
        return EmbeddedPayloadSource.EnsureExtracted();
    }

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
    private readonly string? _installedRootOverride;

    public UpdateForm(string newInstallerPath, string? installedRootOverride = null)
    {
        _newInstallerPath = newInstallerPath;
        _installedRootOverride = string.IsNullOrWhiteSpace(installedRootOverride) ? null : installedRootOverride;
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

    /// <summary>要替换的已安装 current 目录：优先用桥传来的显式路径，否则按 install-location.txt 记忆位置解析。
    /// 不能用 SourceRoot——产品内更新时更新器运行在 TEMP 下载目录里，SourceRoot 会指向那里。</summary>
    private string CurrentRoot => _installedRootOverride is null ? LauncherForm.CurrentInstalledRoot : Path.GetFullPath(_installedRootOverride);

    private async Task RunAsync()
    {
        var newRoot = Path.GetDirectoryName(Path.GetFullPath(_newInstallerPath));
        var newPayload = newRoot is null ? null : Path.Combine(newRoot, "payload");
        if (newRoot is null || newPayload is null || !Directory.Exists(newPayload))
        {
            Fail("新版本文件不完整，更新已取消。请重新下载安装包后重试。");
            return;
        }
        if (!Directory.Exists(CurrentRoot))
        {
            Fail("找不到现有安装目录，更新已取消。请重新安装活点地图。");
            return;
        }
        var verification = PayloadVerifier.Verify(newPayload);
        if (!verification.Ok)
        {
            Fail($"新版本校验失败，更新已取消（现有版本不受影响）：{string.Join("；", verification.Errors)}");
            return;
        }
        var productRoot = Directory.GetParent(CurrentRoot)?.FullName ?? CurrentRoot;
        Directory.CreateDirectory(productRoot);
        var updating = Path.Combine(productRoot, $".updating-{Guid.NewGuid():N}");
        try
        {
            AppendStatus($"新版本 {verification.Version} 校验通过，正在复制…");
            _progress.Visible = true;
            await CopyDirectoryAsync(newRoot, updating);
            // 更新器本体运行在 TEMP 下载目录：把已安装目录的 exe 复制进暂存目录，使 .updating 成为完整安装目录。
            var ownExe = Path.Combine(CurrentRoot, "LiveDotMapSetup.exe");
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
        // 更新器自身运行在 TEMP 下载目录，而旧桥进程运行在 current/payload 内，
        // Windows 不允许移动被占用的目录，因此写延迟 PowerShell 脚本：本进程退出后完成 备份 current → 切换 .updating → 打开画布 → 健康检查。
        // 新桥起不来时自动回滚到 .previous 并弹窗告知，绝不留下打不开的安装（A6 更新安全契约）。
        var current = CurrentRoot;
        var previous = Path.Combine(productRoot, $".previous-{DateTime.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}");
        var script = Path.Combine(productRoot, $"switch-{Guid.NewGuid():N}.ps1");
        var launcher = Path.Combine(current, "LiveDotMapSetup.exe");
        static string Q(string value) => $"'{value.Replace("'", "''", StringComparison.Ordinal)}'";
        var lines = new[]
        {
            "$ErrorActionPreference = 'Stop'",
            $"$current = {Q(current)}",
            $"$updating = {Q(updating)}",
            $"$previous = {Q(previous)}",
            $"$productRoot = {Q(productRoot)}",
            $"$launcher = {Q(launcher)}",
            "$runDir = Join-Path $env:LOCALAPPDATA 'live-dot-map\\run'",
            "function Popup([string]$text, [int]$icon) {",
            "  try { (New-Object -ComObject WScript.Shell).Popup($text, 120, '活点地图', $icon) | Out-Null } catch { }",
            "}",
            "Start-Sleep -Seconds 2",
            "# 1. 切换目录：备份 current，再让 .updating 上位。",
            "# 刚退出的更新器、杀毒软件或索引服务可能短暂持有目录句柄，重试最多 10 次（约 30 秒）再认输；",
            "# 彻底失败时 current 保持完整，必须重启旧版本画布——绝不把用户留在打不开的状态（A6 更新安全契约）。",
            "$switched = $false",
            "$lastError = $null",
            "for ($i = 0; $i -lt 10 -and -not $switched; $i++) {",
            "  try {",
            "    if (Test-Path -LiteralPath $current) { Rename-Item -LiteralPath $current -NewName (Split-Path $previous -Leaf) -ErrorAction Stop }",
            "    Rename-Item -LiteralPath $updating -NewName 'current' -ErrorAction Stop",
            "    $switched = $true",
            "  } catch {",
            "    $lastError = $_.Exception.Message",
            "    # 第一步成功而第二步失败时先还原，再整体重试",
            "    try { if ((Test-Path -LiteralPath $previous) -and !(Test-Path -LiteralPath $current)) { Rename-Item -LiteralPath $previous -NewName 'current' } } catch { }",
            "    Start-Sleep -Seconds 3",
            "  }",
            "}",
            "if (-not $switched) {",
            "  try { if (Test-Path -LiteralPath $current) { Start-Process -FilePath $launcher -ArgumentList '--open' -WorkingDirectory $productRoot -WindowStyle Hidden } } catch { }",
            "  try { Remove-Item -LiteralPath $updating -Recurse -Force -ErrorAction SilentlyContinue } catch { }",
            "  Popup ('更新切换失败：' + $lastError + '。已恢复原版本并重新打开画布；如画布无法打开，请重新安装。') 16",
            "  Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
            "  exit 1",
            "}",
            "# 2. 启动新版本画布",
            "Start-Process -FilePath $launcher -ArgumentList '--open' -WorkingDirectory $productRoot -WindowStyle Hidden",
            "# 3. 健康检查：bridge.json 的 startedAt 必须在最近 180 秒内且 /health 返回 200，上限 60 秒",
            "$healthy = $false",
            "$deadline = (Get-Date).AddSeconds(60)",
            "$bridgeFile = Join-Path $runDir 'bridge.json'",
            "while ((Get-Date) -lt $deadline) {",
            "  try {",
            "    $info = Get-Content -LiteralPath $bridgeFile -Raw -ErrorAction Stop | ConvertFrom-Json",
            "    $startedAt = [DateTimeOffset]::Parse($info.startedAt)",
            "    if ((([DateTimeOffset]::UtcNow) - $startedAt.ToUniversalTime()).TotalSeconds -lt 180) {",
            "      $response = Invoke-WebRequest -Uri ('http://127.0.0.1:' + $info.port + '/health') -UseBasicParsing -TimeoutSec 3",
            "      if ($response.StatusCode -eq 200) { $healthy = $true; break }",
            "    }",
            "  } catch { }",
            "  Start-Sleep -Seconds 2",
            "}",
            "if ($healthy) {",
            "  # 4a. 健康：清理历史 .previous-* 备份（保留本次那一份供诊断）",
            "  Get-ChildItem -LiteralPath $productRoot -Directory -Filter '.previous-*' |",
            "    Where-Object { $_.FullName -ne $previous } |",
            "    ForEach-Object { try { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop } catch { } }",
            "} else {",
            "  # 4b. 不健康：请新桥退出（控制通道失败则按 pid 强杀），回滚目录并重启旧版本",
            "  $bridge = $null",
            "  try {",
            "    $bridge = Get-Content -LiteralPath $bridgeFile -Raw -ErrorAction Stop | ConvertFrom-Json",
            "    $token = (Get-Content -LiteralPath (Join-Path $runDir 'control.token') -Raw -ErrorAction Stop).Trim()",
            "    Invoke-WebRequest -Method Post -Uri ('http://127.0.0.1:' + $bridge.port + '/api/v1/control/shutdown') -Headers @{ 'X-LiveDot-Control' = $token } -UseBasicParsing -TimeoutSec 5 | Out-Null",
            "  } catch { }",
            "  Start-Sleep -Seconds 3",
            "  try {",
            "    if ($bridge -and $bridge.pid) {",
            "      $proc = Get-Process -Id $bridge.pid -ErrorAction SilentlyContinue",
            "      if ($proc) { Stop-Process -Id $bridge.pid -Force -ErrorAction SilentlyContinue }",
            "    }",
            "  } catch { }",
            "  try {",
            "    $failed = Join-Path $productRoot ('.failed-' + (Get-Date -Format 'yyyyMMddHHmmss'))",
            "    if (Test-Path -LiteralPath $current) { Rename-Item -LiteralPath $current -NewName (Split-Path $failed -Leaf) }",
            "    if (Test-Path -LiteralPath $previous) { Rename-Item -LiteralPath $previous -NewName 'current' }",
            "    if (Test-Path -LiteralPath $current) {",
            "      Start-Process -FilePath $launcher -ArgumentList '--open' -WorkingDirectory $productRoot -WindowStyle Hidden",
            "      Popup '更新后新版本未能正常启动，已自动恢复到之前的版本。你的地图数据没有受影响。' 48",
            "    } else {",
            "      Popup '更新失败且自动恢复未完成。请重新安装活点地图；你的地图数据没有受影响。' 16",
            "    }",
            "  } catch {",
            "    Popup ('更新失败且自动恢复出错：' + $_.Exception.Message + '。请重新安装活点地图；你的地图数据没有受影响。') 16",
            "  }",
            "}",
            "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
        };
        // PowerShell 5.1 把无 BOM 的 UTF-8 当 ANSI 读，中文提示会乱码，必须带 BOM 写入。
        await File.WriteAllTextAsync(script, string.Join("\r\n", lines), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        var info = new ProcessStartInfo { FileName = "powershell.exe", UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = productRoot };
        info.ArgumentList.Add("-NoProfile");
        info.ArgumentList.Add("-ExecutionPolicy");
        info.ArgumentList.Add("Bypass");
        info.ArgumentList.Add("-WindowStyle");
        info.ArgumentList.Add("Hidden");
        info.ArgumentList.Add("-File");
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
