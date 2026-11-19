namespace SharpLadder.CodeCheck;

// The child side of the wire contract for a suite: the start record, the identity and the release
// line only. A suite reports on standard output, so no check or terminal record is written, no
// culture is set and no helper is offered to content. Every name is written from the global
// namespace down, so only content that declares a type or namespace there can reach it.
internal static class SuiteStartSource
{
    public const string FileName = "SharpLadderSuiteStart.cs";

    public static string Text { get; } = $$"""
        internal static class {{GeneratedNames.Harness}}
        {
            private static readonly global::System.Threading.Lock Gate = new();
            private static global::System.IO.FileStream? s_results;
            private static string s_token = "";

            // The module's only initializer, so start-up precedes all content, a static constructor
            // on the entry type included.
            [global::System.Runtime.CompilerServices.ModuleInitializer]
            internal static void SharpLadderStart()
            {
                try
                {
                    Start();
                }
                catch (global::System.Exception)
                {
                    global::System.Environment.Exit({{WireContract.HarnessFailureExit}});
                }
            }

            private static void Start()
            {
                var token = global::System.Environment.GetEnvironmentVariable("{{WireContract.TokenVariable}}");
                var path = global::System.Environment.GetEnvironmentVariable("{{WireContract.ResultsVariable}}");
                if (token is null || token.Length != {{WireContract.TokenLength}} || !IsLowerHex(token) || string.IsNullOrEmpty(path))
                {
                    throw new global::System.InvalidOperationException("the start-up channels are missing");
                }

                // The same bytes on both OS, with no console API: the console's own code page is not UTF-8.
                global::System.Console.SetOut(new global::System.IO.StreamWriter(global::System.Console.OpenStandardOutput(), new global::System.Text.UTF8Encoding(false)) { AutoFlush = true });

                // An escaping exception ends the run at once as a completed failure, never through the
                // runtime's abort, which can outlast the deadline.
                global::System.AppDomain.CurrentDomain.UnhandledException += OnUnhandled;

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

                Record(json =>
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
            }

            private static void OnUnhandled(object? sender, global::System.UnhandledExceptionEventArgs e) =>
                global::System.Environment.Exit({{WireContract.ContentFailureExit}});

            // The start record; one that cannot be written ends the run before its release.
            private static void Record(global::System.Action<global::System.Text.Json.Utf8JsonWriter> payload)
            {
                try
                {
                    var line = new global::System.Buffers.ArrayBufferWriter<byte>();
                    using (var json = new global::System.Text.Json.Utf8JsonWriter(line))
                    {
                        json.WriteStartObject();
                        json.WriteString("{{WireContract.TokenField}}", s_token);
                        json.WriteString("{{WireContract.KindField}}", "{{WireContract.StartKind}}");
                        payload(json);
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
        }

        """;
}
