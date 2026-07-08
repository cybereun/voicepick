using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class VoicePickLauncher
{
    private const int Port = 5299;
    private const string Url = "http://127.0.0.1:5299/";

    [STAThread]
    private static void Main()
    {
        try
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, '/');
            string appDir = Directory.Exists(Path.Combine(baseDir, "app")) ? Path.Combine(baseDir, "app") : baseDir;
            if (!IsServerReady())
            {
                StartServer(baseDir, appDir);
                WaitForServer();
            }
            Process.Start(new ProcessStartInfo { FileName = Url, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "VoicePick 실행 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string ResolveNode(string baseDir)
    {
        string bundled = Path.Combine(baseDir, "runtime", "node.exe");
        if (File.Exists(bundled)) return bundled;
        string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        if (File.Exists(installed)) return installed;
        return "node.exe";
    }

    private static void StartServer(string baseDir, string appDir)
    {
        string server = Path.Combine(appDir, "src", "server.mjs");
        if (!File.Exists(server)) throw new FileNotFoundException("VoicePick server.mjs를 찾을 수 없습니다.", server);
        string logs = Path.Combine(appDir, "logs");
        Directory.CreateDirectory(logs);
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = ResolveNode(baseDir);
        psi.Arguments = "--no-warnings \"" + server + "\"";
        psi.WorkingDirectory = appDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;
        psi.EnvironmentVariables["VOICEPICK_PORT"] = Port.ToString();
        psi.EnvironmentVariables["VOICEPICK_RESOURCE_ROOT"] = Path.Combine(baseDir, "current", "resources");
        psi.EnvironmentVariables["VOICEPICK_WHISPER_MODEL"] = Path.Combine(baseDir, "models", "whisper", "ggml-large-v3-turbo-q5_0.bin");
        psi.EnvironmentVariables["VOICEPICK_PREVIEW_MODEL"] = Path.Combine(baseDir, "models", "whisper", "ggml-base.bin");
        Process process = Process.Start(psi);
        if (process == null) throw new InvalidOperationException("VoicePick 서버를 시작하지 못했습니다.");
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { AppendLog(Path.Combine(logs, "server.out.log"), e.Data); };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { AppendLog(Path.Combine(logs, "server.err.log"), e.Data); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
    }

    private static void AppendLog(string path, string line)
    {
        if (line == null) return;
        try { File.AppendAllText(path, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine); } catch { }
    }

    private static bool IsServerReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url + "api/status");
            request.Timeout = 700;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode >= 200 && (int)response.StatusCode < 300;
            }
        }
        catch { return false; }
    }

    private static void WaitForServer()
    {
        for (int i = 0; i < 80; i++)
        {
            if (IsServerReady()) return;
            Thread.Sleep(250);
        }
        throw new TimeoutException("VoicePick 서버가 시작되지 않았습니다. app\\logs\\server.err.log를 확인하세요.");
    }
}
