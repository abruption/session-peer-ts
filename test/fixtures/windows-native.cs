// Test-only native process: real LockFileEx owner, queue stand-in and SSH stand-in.
// Never ships in the npm package and never contacts a real agent or SSH server.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class Fixture {
  [StructLayout(LayoutKind.Sequential)] struct Overlapped {
    public IntPtr Internal, InternalHigh; public uint Offset, OffsetHigh; public IntPtr Event;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
    uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool LockFileEx(SafeFileHandle handle, uint flags, uint reserved, uint low, uint high, ref Overlapped state);
  static SafeFileHandle Open(string path, bool held) {
    var handle = CreateFile(path, 0xc0000000, 7, IntPtr.Zero, 4, 128, IntPtr.Zero);
    if (handle.IsInvalid) throw new Exception("open_failed:" + Marshal.GetLastWin32Error());
    var state = new Overlapped();
    if (held && !LockFileEx(handle, 3, 0, uint.MaxValue, uint.MaxValue, ref state)) {
      handle.Dispose(); throw new Exception("lock_failed:" + Marshal.GetLastWin32Error());
    }
    return handle;
  }
  static void Record(string key, object value) {
    File.AppendAllText(Environment.GetEnvironmentVariable(key), new JavaScriptSerializer().Serialize(value) + "\n");
  }
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    Console.InputEncoding = new UTF8Encoding(false, true);
    try {
      if (args.Length > 0 && (args[0] == "hold" || args[0] == "open")) {
        using (var handle = Open(args[1], args[0] == "hold")) {
          Console.WriteLine("ready"); Console.Out.Flush();
          // Input acknowledgement, not sleep-based readiness. Parent always owns cleanup.
          Console.ReadLine();
        }
        return 0;
      }
      if (args.Length > 0 && args[0] == "queue") {
        Record("FIXTURE_QUEUE_LOG", new { args = args, home = Environment.GetEnvironmentVariable("CODEX_HOME") });
        string mode = Environment.GetEnvironmentVariable("FIXTURE_QUEUE_MODE");
        if (mode == "timeout") Thread.Sleep(60000);
        if (mode == "fail") { Console.Error.WriteLine("SECRET-SENTINEL"); return 1; }
        Console.WriteLine("Queued message fixture-17 for thread " + args[2] + "."); return 0;
      }
      // `ssh -G` user metadata lookup: answered without a log entry or connection.
      if (Array.IndexOf(args, "-G") >= 0) { Console.WriteLine("user fixture-user"); return 0; }
      string command = args[args.Length - 1];
      string modeSsh = Environment.GetEnvironmentVariable("FIXTURE_SSH_MODE");
      bool preflight = command.EndsWith("--version'") || command.EndsWith("--version");
      if (command.StartsWith("powershell.exe ")) {
        string encoded = command.Substring(command.LastIndexOf(' ') + 1);
        preflight = Encoding.Unicode.GetString(Convert.FromBase64String(encoded)).EndsWith("--version");
      }
      string input = Console.In.ReadToEnd();
      Record("FIXTURE_SSH_LOG", new { args = args, input = input });
      if (preflight && modeSsh == "mismatch") { Console.WriteLine("session-peer 1.0.2"); return 0; }
      if (preflight && modeSsh == "auth") { Console.Error.WriteLine("Permission denied (publickey). SECRET-SENTINEL"); return 255; }
      if (!preflight && modeSsh == "loss") return 255;
      if (!command.StartsWith("powershell.exe ")) throw new Exception("expected_windows_remote_command");
      var start = new ProcessStartInfo("powershell.exe", command.Substring("powershell.exe ".Length));
      // A distinct simulated destination environment for discovery tests. These
      // are fixture controls, not SSH SendEnv/AcceptEnv or application options.
      string remoteProfile = Environment.GetEnvironmentVariable("FIXTURE_REMOTE_PROFILE");
      if (!String.IsNullOrEmpty(remoteProfile)) {
        start.EnvironmentVariables["HOME"] = remoteProfile;
        start.EnvironmentVariables["USERPROFILE"] = remoteProfile;
        start.EnvironmentVariables["CODEX_HOME"] = Path.Combine(remoteProfile, ".codex");
        start.EnvironmentVariables["CLAUDE_CONFIG_DIR"] = Path.Combine(remoteProfile, ".claude");
        start.EnvironmentVariables["ANTHROPIC_CONFIG_DIR"] = "";
        start.EnvironmentVariables["SESSION_PEER_CODEX_HOMES"] = Environment.GetEnvironmentVariable("FIXTURE_REMOTE_HOMES") ?? "[]";
      }
      start.UseShellExecute = false; start.CreateNoWindow = true;
      start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
      start.StandardOutputEncoding = new UTF8Encoding(false); start.StandardErrorEncoding = new UTF8Encoding(false);
      using (var child = Process.Start(start)) {
        var stdout = child.StandardOutput.ReadToEndAsync(); var stderr = child.StandardError.ReadToEndAsync();
        byte[] inputBytes = Encoding.UTF8.GetBytes(input);
        child.StandardInput.BaseStream.Write(inputBytes, 0, inputBytes.Length);
        child.StandardInput.Close();
        if (!child.WaitForExit(60000)) { child.Kill(); return 254; }
        Console.Write(stdout.Result); Console.Error.Write(stderr.Result); return child.ExitCode;
      }
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 2; }
  }
}
