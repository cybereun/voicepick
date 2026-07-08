using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class VoicePickSetup
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string setupDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string payload = Path.Combine(setupDir, "VoicePick-win-full");
            if (!Directory.Exists(payload))
            {
                DirectoryInfo parent = Directory.GetParent(setupDir);
                if (parent != null) payload = Path.Combine(parent.FullName, "VoicePick-win-full");
            }
            if (!Directory.Exists(payload)) throw new DirectoryNotFoundException("VoicePick-win-full 배포 폴더를 찾을 수 없습니다. 설치 파일 옆에 VoicePick-win-full 폴더가 있어야 합니다.");
            string target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoicePick");
            Directory.CreateDirectory(target);
            CopyDirectory(payload, target);
            CreateShortcut(Path.Combine(target, "VoicePick.exe"));
            MessageBox.Show("설치 완료\n\n" + target, "VoicePick", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Process.Start(new ProcessStartInfo { FileName = Path.Combine(target, "VoicePick.exe"), UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "VoicePick 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void CopyDirectory(string source, string target)
    {
        foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(target, MakeRelative(source, dir)));
        }
        foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            string dest = Path.Combine(target, MakeRelative(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.Copy(file, dest, true);
        }
    }

    private static string MakeRelative(string root, string path)
    {
        Uri rootUri = new Uri(AppendSlash(root));
        Uri pathUri = new Uri(path);
        return Uri.UnescapeDataString(rootUri.MakeRelativeUri(pathUri).ToString()).Replace('/', Path.DirectorySeparatorChar);
    }

    private static string AppendSlash(string path)
    {
        return path.EndsWith(Path.DirectorySeparatorChar.ToString()) ? path : path + Path.DirectorySeparatorChar;
    }

    private static void CreateShortcut(string exePath)
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string shortcut = Path.Combine(desktop, "VoicePick.lnk");
        string ps = "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + shortcut.Replace("'", "''") + "');" +
                    "$s.TargetPath='" + exePath.Replace("'", "''") + "';" +
                    "$s.WorkingDirectory='" + Path.GetDirectoryName(exePath).Replace("'", "''") + "';" +
                    "$s.IconLocation='" + exePath.Replace("'", "''") + "';" +
                    "$s.Save()";
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + ps.Replace("\"", "`\"") + "\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        Process p = Process.Start(psi);
        if (p != null) p.WaitForExit(10000);
    }
}
