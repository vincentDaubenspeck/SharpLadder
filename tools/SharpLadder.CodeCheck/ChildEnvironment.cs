namespace SharpLadder.CodeCheck;

// The checker's environment reaches the child only through the allowlist, so no DOTNET_ or COMPlus_
// setting can steer the runtime. The OS lookup is case-insensitive on Windows, as names are there.
internal static class ChildEnvironment
{
    public static IReadOnlyList<KeyValuePair<string, string>> Build(string token, string resultsPath)
    {
        var inherited = OperatingSystem.IsWindows() ? WireContract.WindowsInherited : WireContract.LinuxInherited;
        var environment = new List<KeyValuePair<string, string>>(inherited.Count + 2);
        foreach (var name in inherited)
        {
            if (Environment.GetEnvironmentVariable(name) is { } value)
            {
                environment.Add(new(name, value));
            }
        }

        environment.Add(new(WireContract.TokenVariable, token));
        environment.Add(new(WireContract.ResultsVariable, resultsPath));
        return environment;
    }
}
