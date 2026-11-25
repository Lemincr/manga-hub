using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Manga Hub")]
[assembly: AssemblyProduct("Manga Hub Desktop")]
[assembly: AssemblyVersion("1.1.0.0")]

namespace MangaHubDesktop
{
    static class Program
    {
        private static Process serverProc;
        private static volatile bool shuttingDown = false;
        private static readonly object procLock = new object();

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string dataDir = Path.Combine(appDir, "data");
            Directory.CreateDirectory(dataDir);

            int port = 3001;
            string url = "http://127.0.0.1:" + port;

            if (!EnsureBackendRunning(appDir, dataDir, port, url, 15000))
            {
                MessageBox.Show(
                    "Manga Hub backend did not respond on " + url + ".\nEnsure dependencies are installed (npm install) and client is built (npm run build).\nSee data\\server.log for details.",
                    "Manga Hub — Startup Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                KillBackend();
                return;
            }

            // Background watchdog: if the Node backend ever exits or is killed while the app window is open, restart it automatically
            var watchdog = new Thread(() =>
            {
                while (!shuttingDown)
                {
                    Thread.Sleep(2000);
                    if (shuttingDown) break;
                    if (!IsServerAlive(url))
                    {
                        EnsureBackendRunning(appDir, dataDir, port, url, 8000);
                    }
                }
            })
            {
                IsBackground = true,
                Name = "MangaHubBackendWatchdog"
            };
            watchdog.Start();

            Process uiProc = LaunchAppWindow(url);
            if (uiProc != null)
            {
                try { uiProc.WaitForExit(); } catch { }
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                RunTrayLoop(url, dataDir);
            }

            shuttingDown = true;
            KillBackend();
        }

        static bool EnsureBackendRunning(string appDir, string dataDir, int port, string url, int timeoutMs)
        {
            lock (procLock)
            {
                if (IsServerAlive(url)) return true;
                KillBackend();
                serverProc = StartBackend(appDir, dataDir, port);
                return WaitForServer(url, timeoutMs);
            }
        }

        static bool IsServerAlive(string url)
        {
            try
            {
                using (var client = new HttpClient() { Timeout = TimeSpan.FromMilliseconds(900) })
                {
                    var res = client.GetAsync(url + "/api/settings").GetAwaiter().GetResult();
                    return res.IsSuccessStatusCode;
                }
            }
            catch { return false; }
        }

        static bool WaitForServer(string url, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                if (IsServerAlive(url)) return true;
                if (serverProc != null && serverProc.HasExited) return false;
                Thread.Sleep(250);
            }
            return false;
        }

        static Process StartBackend(string appDir, string dataDir, int port)
        {
            string tsxCli = Path.Combine(appDir, "node_modules", "tsx", "dist", "cli.mjs");
            string entry = Path.Combine(appDir, "server", "index.ts");
            string logFile = Path.Combine(dataDir, "server.log");
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + tsxCli + "\" \"" + entry + "\"",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.EnvironmentVariables["DATA_DIR"] = dataDir;
            psi.EnvironmentVariables["PORT"] = port.ToString();
            var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            DataReceivedEventHandler writeLog = (s, e) =>
            {
                if (string.IsNullOrEmpty(e.Data)) return;
                try
                {
                    File.AppendAllText(logFile, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + e.Data + Environment.NewLine);
                }
                catch { }
            };
            proc.OutputDataReceived += writeLog;
            proc.ErrorDataReceived += writeLog;
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            return proc;
        }

        static string FindChromiumBrowser()
        {
            string[] regNames = { "msedge.exe", "brave.exe", "chrome.exe" };
            foreach (var name in regNames)
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name))
                {
                    var p = key != null ? key.GetValue(null) as string : null;
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                }
            }
            string[] candidates = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"BraveSoftware\Brave-Browser\Application\brave.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
            };
            foreach (var c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        static Process LaunchAppWindow(string url)
        {
            string browser = FindChromiumBrowser();
            if (browser == null) return null;
            string profileDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data", "desktop-profile");
            Directory.CreateDirectory(profileDir);
            var psi = new ProcessStartInfo
            {
                FileName = browser,
                Arguments = "--app=" + url + " --user-data-dir=\"" + profileDir + "\" --window-size=1360,880 --no-first-run --no-default-browser-check",
                UseShellExecute = false,
            };
            return Process.Start(psi);
        }

        static void RunTrayLoop(string url, string dataDir)
        {
            using (var tray = new NotifyIcon())
            {
                try
                {
                    tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? System.Drawing.SystemIcons.Application;
                }
                catch
                {
                    tray.Icon = System.Drawing.SystemIcons.Application;
                }
                tray.Text = "Manga Hub (" + url + ")";
                tray.Visible = true;
                var menu = new ContextMenuStrip();
                menu.Items.Add("Open Manga Hub", null, (s, e) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }));
                menu.Items.Add("Open Data Folder", null, (s, e) => Process.Start(new ProcessStartInfo(dataDir) { UseShellExecute = true }));
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("Quit Manga Hub", null, (s, e) => Application.Exit());
                tray.ContextMenuStrip = menu;
                Application.Run();
            }
        }

        static void KillBackend()
        {
            try
            {
                if (serverProc != null && !serverProc.HasExited)
                {
                    serverProc.Kill();
                    serverProc.WaitForExit(2000);
                }
            }
            catch { }
        }
    }
}
