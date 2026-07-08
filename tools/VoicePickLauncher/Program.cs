using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace VoicePickLauncher;

internal static class Program
{
    private const int Port = 5299;
    private static readonly string Url = $"http://127.0.0.1:{Port}/";

    [STAThread]
    private static async Task Main()
    {
        ApplicationConfiguration.Initialize();
        try
        {
            var baseDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var appDir = Directory.Exists(Path.Combine(baseDir, "app")) ? Path.Combine(baseDir, "app") : baseDir;
            if (!await IsServerReady())
            {
                StartServer(baseDir, appDir);
                await WaitForServer();
            }
            OpenBrowser();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "VoicePick 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string ResolveNode(string baseDir)
    {
        var bundled = Path.Combine(baseDir, "runtime", "node.exe");
        if (File.Exists(bundled)) return bundled;
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var installed = Path.Combine(programFiles, "nodejs", "node.exe");
        if (File.Exists(installed)) return installed;
        return "node.exe";
    }

    private static void StartServer(string baseDir, string appDir)
    {
        var server = Path.Combine(appDir, "src", "server.mjs");
        if (!File.Exists(server)) throw new FileNotFoundException("VoicePick server.mjs를 찾을 수 없습니다.", server);
        var logs = Path.Combine(appDir, "logs");
        Directory.CreateDirectory(logs);
        var psi = new ProcessStartInfo
        {
            FileName = ResolveNode(baseDir),
            Arguments = $"--no-warnings \"{server}\"",
            WorkingDirectory = appDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment["VOICEPICK_PORT"] = Port.ToString();
        psi.Environment["VOICEPICK_ALT_RESOURCES"] = Path.Combine(baseDir, "current", "resources");
        psi.Environment["VOICEPICK_WHISPER_MODEL"] = Path.Combine(baseDir, "models", "whisper", "ggml-large-v3-turbo-q5_0.bin");
        psi.Environment["VOICEPICK_PREVIEW_MODEL"] = Path.Combine(baseDir, "models", "whisper", "ggml-base.bin");
        var process = Process.Start(psi) ?? throw new InvalidOperationException("VoicePick 서버를 시작하지 못했습니다.");
        process.OutputDataReceived += (_, e) => AppendLog(Path.Combine(logs, "server.out.log"), e.Data);
        process.ErrorDataReceived += (_, e) => AppendLog(Path.Combine(logs, "server.err.log"), e.Data);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
    }

    private static void AppendLog(string path, string? line)
    {
        if (line == null) return;
        try { File.AppendAllText(path, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}"); } catch { }
    }

    private static async Task<bool> IsServerReady()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) };
            using var response = await client.GetAsync($"{Url}api/status");
            return response.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    private static async Task WaitForServer()
    {
        for (var i = 0; i < 80; i++)
        {
            if (await IsServerReady()) return;
            await Task.Delay(250);
        }
        throw new TimeoutException("VoicePick 서버가 시작되지 않았습니다. app\\logs\\server.err.log를 확인하세요.");
    }

    private static void OpenBrowser()
    {
        Process.Start(new ProcessStartInfo { FileName = Url, UseShellExecute = true });
    }
}
