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
[assembly: AssemblyDescription("Local desktop tracker and chapter reader for manga, manhwa, and manhua")]
[assembly: AssemblyProduct("Manga Hub")]
[assembly: AssemblyCompany("Manga Hub")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

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

            if (!IsServerAlive(url))
            {
                string startErr;
                if (!EnsureBackendRunning(appDir, dataDir, port, url, 15000, out startErr))
                {
                    MessageBox.Show(
                        startErr,
                        "Manga Hub — Startup Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    KillBackend();
                    return;
                }
            }

            // Background watchdog: automatically restarts the local backend if it stops while the window is open
            var watchdog = new Thread(() =>
            {
                while (!shuttingDown)
                {
                    Thread.Sleep(2000);
                    if (shuttingDown) break;
                    if (!IsServerAlive(url))
                    {
                        string ignored;
                        EnsureBackendRunning(appDir, dataDir, port, url, 8000, out ignored);
                    }
                }
            })
            {
                IsBackground = true,
                Name = "MangaHubBackendWatchdog"
            };
            watchdog.Start();

            Process uiProc = LaunchAppWindow(url, dataDir);
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

        static bool EnsureBackendRunning(string appDir, string dataDir, int port, string url, int timeoutMs, out string errorMsg)
        {
            errorMsg = "";
            lock (procLock)
            {
                if (IsServerAlive(url)) return true;
                KillBackend();

                string nodeExe = FindNodeExe();
                if (nodeExe == null)
                {
                    errorMsg =
                        "Node.js (v22.13 or newer) was not found on this PC.\n\n" +
                        "Please install the LTS version from https://nodejs.org/ and launch MangaHub.exe again.";
                    return false;
                }

                string bundlePath = Path.Combine(appDir, "dist", "server.mjs");
                string rootBundlePath = Path.Combine(appDir, "server.mjs");
                string tsxCli = Path.Combine(appDir, "node_modules", "tsx", "dist", "cli.mjs");
                string tsEntry = Path.Combine(appDir, "server", "index.ts");

                string serverArgs;
                if (File.Exists(bundlePath))
                {
                    serverArgs = "\"" + bundlePath + "\"";
                }
                else if (File.Exists(rootBundlePath))
                {
                    serverArgs = "\"" + rootBundlePath + "\"";
                }
                else if (File.Exists(tsxCli) && File.Exists(tsEntry))
                {
                    serverArgs = "\"" + tsxCli + "\" \"" + tsEntry + "\"";
                }
                else
                {
                    errorMsg =
                        "Manga Hub application files were not found next to MangaHub.exe.\n\n" +
                        "Make sure you extracted the entire MangaHub release .zip folder (including dist\\ and client\\) before running MangaHub.exe.";
                    return false;
                }

                string clientDist = Path.Combine(appDir, "client", "dist", "index.html");
                if (!File.Exists(clientDist))
                {
                    errorMsg =
                        "Web interface files (client\\dist) are missing next to MangaHub.exe.\n\n" +
                        "Please re-extract the full MangaHub release .zip folder.";
                    return false;
                }

                serverProc = StartBackend(nodeExe, serverArgs, appDir, dataDir, port);
                if (WaitForServer(url, timeoutMs)) return true;

                string tail = ReadLastLogLines(Path.Combine(dataDir, "server.log"), 8);
                errorMsg = "Manga Hub backend did not respond on " + url + "." +
                    (string.IsNullOrEmpty(tail) ? "" : "\n\nRecent log (data\\server.log):\n" + tail);
                return false;
            }
        }

        static string FindNodeExe()
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            string[] common = {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("NVM_SYMLINK") ?? "", "node.exe"),
                Path.Combine(Environment.GetEnvironmentVariable("VOLTA_HOME") ?? "", @"bin\node.exe"),
            };
            foreach (string c in common)
            {
                if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
            }
            return null;
        }

        static string ReadLastLogLines(string logFile, int count)
        {
            try
            {
                if (!File.Exists(logFile)) return "";
                string[] lines = File.ReadAllLines(logFile);
                int start = Math.Max(0, lines.Length - count);
                return string.Join("\n", lines, start, lines.Length - start);
            }
            catch { return ""; }
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
                Thread.Sleep(200);
            }
            return false;
        }

        static Process StartBackend(string nodeExe, string serverArgs, string appDir, string dataDir, int port)
        {
            string logFile = Path.Combine(dataDir, "server.log");
            var psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = serverArgs,
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

        static Process LaunchAppWindow(string url, string dataDir)
        {
            string browser = FindChromiumBrowser();
            if (browser == null) return null;
            string profileDir = Path.Combine(dataDir, "desktop-profile");
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
