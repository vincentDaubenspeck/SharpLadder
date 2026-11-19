namespace SharpLadder.CodeCheck;

// The child side of the wire contract, compiled into every group. Every name is written from the
// global namespace down, so only content that declares a type or namespace there can reach it.
internal static class HarnessSource
{
    public const string FileName = "SharpLadderHarness.cs";

    private const string CallSlot = "/* descendant call */";
    private const string MembersSlot = "/* descendant members */";
    private const string SleepMode = "sharpladder-sleep";
    private const string OrphanMode = "sharpladder-orphan";

    private const string DescendantCall = $$"""
                if (global::System.Environment.GetCommandLineArgs() is [_, var mode, var folder] && mode is "{{SleepMode}}" or "{{OrphanMode}}")
                {
                    Descend(mode, folder);
                }

        """;

    // Relaunch keeps the explicit runtime configuration and roll-forward control of the first launch.
    private const string DescendantMembers = $$"""

            public static global::System.Diagnostics.Process Relaunch(string mode, string folder)
            {
                var assembly = typeof({{GeneratedNames.Harness}}).Assembly.Location;
                var start = new global::System.Diagnostics.ProcessStartInfo(global::System.Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
                foreach (var argument in new[] { "exec", "--roll-forward", "Disable", "--runtimeconfig", global::System.IO.Path.ChangeExtension(assembly, ".runtimeconfig.json"), assembly, mode, folder })
                {
                    start.ArgumentList.Add(argument);
                }

                return global::System.Diagnostics.Process.Start(start)!;
            }

            public static void Ready(string folder, string role)
            {
                using var self = global::System.Diagnostics.Process.GetCurrentProcess();
                var invariant = global::System.Globalization.CultureInfo.InvariantCulture;
                var path = global::System.IO.Path.Combine(folder, role + "-" + self.Id.ToString(invariant) + ".ready");
                var start = global::System.OperatingSystem.IsLinux() ? StartOnLinux() : self.StartTime.ToUniversalTime().Ticks;
                global::System.IO.File.WriteAllText(path + ".part", self.Id.ToString(invariant) + " " + start.ToString(invariant));
                global::System.IO.File.Move(path + ".part", path);
            }

            // The kernel's own start in clock ticks after boot. StartTime adds each reader's own
            // estimate of the boot time, so only this field compares exactly across processes.
            private static long StartOnLinux()
            {
                var stat = global::System.IO.File.ReadAllText("/proc/self/stat");
                return long.Parse(stat[(stat.LastIndexOf(')') + 2)..].Split(' ')[19], global::System.Globalization.CultureInfo.InvariantCulture);
            }

            public static void AwaitReady(string folder, int count)
            {
                while (global::System.IO.Directory.GetFiles(folder, "*.ready").Length < count)
                {
                    global::System.Threading.Thread.Sleep(10);
                }
            }

            private static void Descend(string mode, string folder)
            {
                if (mode == "{{OrphanMode}}")
                {
                    using var sleeper = Relaunch("{{SleepMode}}", folder);
                    while (!global::System.IO.File.Exists(global::System.IO.Path.Combine(folder, "sleep-" + sleeper.Id.ToString(global::System.Globalization.CultureInfo.InvariantCulture) + ".ready")))
                    {
                        global::System.Threading.Thread.Sleep(10);
                    }

                    Ready(folder, "orphan");
                    global::System.Environment.Exit(0);
                }

                Ready(folder, "sleep");
                global::System.Threading.Thread.Sleep(global::System.Threading.Timeout.Infinite);
            }

        """;

    private static readonly string Shape = $$"""
        internal static class {{GeneratedNames.Harness}}
        {
            private static readonly global::System.Threading.Lock Gate = new();
            private static global::System.IO.FileStream? s_results;
            private static string s_token = "";
            private static Executing? s_executing;

            // The module's only initializer, so start-up precedes all content, a static constructor
            // on the entry type included.
            [global::System.Runtime.CompilerServices.ModuleInitializer]
            internal static void SharpLadderStart()
            {
        {{CallSlot}}
                try
                {
                    Start();
                }
                catch (global::System.Exception)
                {
                    global::System.Environment.Exit({{WireContract.HarnessFailureExit}});
                }
            }

            public static void {{GeneratedNames.Enter}}(string block) =>
                global::System.Threading.Volatile.Write(ref s_executing, new Executing(block, null));

            public static void {{GeneratedNames.Enter}}(string block, global::System.Type expected) =>
                global::System.Threading.Volatile.Write(ref s_executing, new Executing(block, expected));

            public static void {{GeneratedNames.CheckPassed}}(string block) =>
                Record("{{WireContract.CheckKind}}", json => json.WriteString("{{WireContract.BlockIdField}}", block));

            public static void {{GeneratedNames.CheckFailed}}(string block)
            {
                Record("{{WireContract.CheckFailedKind}}", json => json.WriteString("{{WireContract.BlockIdField}}", block));
                global::System.Environment.Exit({{WireContract.ContentFailureExit}});
            }

            public static void {{GeneratedNames.End}}() => Record("{{WireContract.EndKind}}", null);

            private static void Start()
            {
                var token = global::System.Environment.GetEnvironmentVariable("{{WireContract.TokenVariable}}");
                var path = global::System.Environment.GetEnvironmentVariable("{{WireContract.ResultsVariable}}");
                if (token is null || token.Length != {{WireContract.TokenLength}} || !IsLowerHex(token) || string.IsNullOrEmpty(path))
                {
                    throw new global::System.InvalidOperationException("the start-up channels are missing");
                }

                s_token = token;
                s_results = new global::System.IO.FileStream(path, global::System.IO.FileMode.CreateNew, global::System.IO.FileAccess.Write, global::System.IO.FileShare.Read, 0);
                var core = global::System.IO.Path.GetDirectoryName(typeof(object).Assembly.Location);
                var linux = global::System.OperatingSystem.IsLinux();
                var pgid = linux ? GetProcessGroup(0) : 0;
                var sid = linux ? GetSession(0) : 0;
                if (string.IsNullOrEmpty(core) || (linux && (pgid <= 0 || sid <= 0)))
                {
                    throw new global::System.InvalidOperationException("the process identity cannot be read");
                }

                Record("{{WireContract.StartKind}}", json =>
                {
                    json.WriteNumber("{{WireContract.PidField}}", global::System.Environment.ProcessId);
                    json.WriteString("{{WireContract.CoreLibraryDirectoryField}}", core);
                    if (linux)
                    {
                        json.WriteNumber("{{WireContract.PgidField}}", pgid);
                        json.WriteNumber("{{WireContract.SidField}}", sid);
                    }
                });

                // Byte by byte up to the line feed, so nothing past the release line is consumed.
                var input = global::System.Console.OpenStandardInput();
                foreach (var expected in token + "\n")
                {
                    if (input.ReadByte() != expected)
                    {
                        throw new global::System.InvalidOperationException("the release line does not match");
                    }
                }

                var invariant = global::System.Globalization.CultureInfo.InvariantCulture;
                global::System.Globalization.CultureInfo.CurrentCulture = invariant;
                global::System.Globalization.CultureInfo.CurrentUICulture = invariant;
                global::System.Globalization.CultureInfo.DefaultThreadCurrentCulture = invariant;
                global::System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = invariant;
                global::System.AppDomain.CurrentDomain.UnhandledException += OnUnhandled;
            }

            // The exception counts against the block that was executing, whatever frame threw it.
            private static void OnUnhandled(object? sender, global::System.UnhandledExceptionEventArgs e)
            {
                var executing = global::System.Threading.Volatile.Read(ref s_executing);
                var actual = e.ExceptionObject.GetType();
                var match = executing?.Expected is { } expected && actual == expected;
                var name = actual.FullName ?? actual.Name;
                if (name.Length > {{WireContract.ActualTypeLength}})
                {
                    name = name[..(char.IsHighSurrogate(name[{{WireContract.ActualTypeLength - 1}}]) ? {{WireContract.ActualTypeLength - 1}} : {{WireContract.ActualTypeLength}})];
                }

                Record("{{WireContract.ExceptionKind}}", json =>
                {
                    if (executing is null)
                    {
                        json.WriteNull("{{WireContract.BlockIdField}}");
                    }
                    else
                    {
                        json.WriteString("{{WireContract.BlockIdField}}", executing.Block);
                    }

                    json.WriteBoolean("{{WireContract.ExactTypeMatchField}}", match);
                    json.WriteString("{{WireContract.ActualTypeField}}", name);
                });
                global::System.Environment.Exit({{WireContract.ContentFailureExit}});
            }

            // A record that cannot be written ends the run without its terminal record, which fails.
            private static void Record(string kind, global::System.Action<global::System.Text.Json.Utf8JsonWriter>? payload)
            {
                try
                {
                    var line = new global::System.Buffers.ArrayBufferWriter<byte>();
                    using (var json = new global::System.Text.Json.Utf8JsonWriter(line))
                    {
                        json.WriteStartObject();
                        json.WriteString("{{WireContract.TokenField}}", s_token);
                        json.WriteString("{{WireContract.KindField}}", kind);
                        payload?.Invoke(json);
                        json.WriteEndObject();
                    }

                    line.GetSpan(1)[0] = (byte)'\n';
                    line.Advance(1);
                    lock (Gate)
                    {
                        var results = s_results ?? throw new global::System.InvalidOperationException("no results file is open");
                        results.Write(line.WrittenSpan);
                        results.Flush();
                    }
                }
                catch (global::System.Exception)
                {
                    global::System.Environment.Exit({{WireContract.HarnessFailureExit}});
                }
            }

            private static bool IsLowerHex(string text)
            {
                foreach (var c in text)
                {
                    if (c is not ((>= '0' and <= '9') or (>= 'a' and <= 'f')))
                    {
                        return false;
                    }
                }

                return true;
            }

            [global::System.Runtime.InteropServices.DllImport("libc", EntryPoint = "getpgid")]
            private static extern int GetProcessGroup(int pid);

            [global::System.Runtime.InteropServices.DllImport("libc", EntryPoint = "getsid")]
            private static extern int GetSession(int pid);

            private sealed record Executing(string Block, global::System.Type? Expected);
        {{MembersSlot}}
        }

        """;

    public static string Text { get; } = Fill(string.Empty, string.Empty);

    // Test-only, chosen through GroupCompiler's internal seam: a process relaunched with a mode
    // and a folder writes its readiness and persists before any start-up, so tree-kill fixtures get
    // descendants. The production text has no such mode and nothing that skips start-up.
    public static string WithDescendants { get; } = Fill(DescendantCall, DescendantMembers);

    private static string Fill(string call, string members) =>
        Shape.Replace(CallSlot, call, StringComparison.Ordinal).Replace(MembersSlot, members, StringComparison.Ordinal);
}
