using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace VoicePickSetup;

internal static class Program
{
    [STAThread]
    private static async Task Main()
    {
        ApplicationConfiguration.Initialize();
        try
        {
            var setupDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, '/');
            var payload = Path.Combine(setupDir, "VoicePick-win-full");
            if (!Directory.Exists(payload))
            {
                payload = Path.Combine(Directory.GetParent(setupDir)?.FullName ?? setupDir, "VoicePick-win-full");
            }
            if (!Directory.Exists(payload)) throw new DirectoryNotFoundException("VoicePick-win-full 배포 폴더를 찾을 수 없습니다. 설치 파일 옆에 VoicePick-win-full 폴더가 있어야 합니다.");

            var target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoicePick");
            Directory.CreateDirectory(target);
            await CopyDirectory(payload, target);
            CreateShortcut(Path.Combine(target, "VoicePick.exe"));
            MessageBox.Show($"설치 완료\n\n{target}", "VoicePick", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Process.Start(new ProcessStartInfo { FileName = Path.Combine(target, "VoicePick.exe"), UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "VoicePick 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static async Task CopyDirectory(string source, string target)
    {
        foreach (var dir in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, dir)));
        }
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(source, file);
            var dest = Path.Combine(target, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            await using var input = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            await using var output = File.Open(dest, FileMode.Create, FileAccess.Write, FileShare.None);
            await input.CopyToAsync(output);
        }
    }

    private static void CreateShortcut(string exePath)
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var shortcut = Path.Combine(desktop, "VoicePick.lnk");
        var ps = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + shortcut.Replace("'", "''") + "');" +
                 "$s.TargetPath='" + exePath.Replace("'", "''") + "';" +
                 "$s.WorkingDirectory='" + Path.GetDirectoryName(exePath)!.Replace("'", "''") + "';" +
                 "$s.IconLocation='" + exePath.Replace("'", "''") + "';" +
                 "$s.Save()";
        Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + ps.Replace("\"", "`\"") + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        })?.WaitForExit(10000);
    }
}
