using System.Text.Json;
using Microsoft.Build.Locator;

namespace SharpLadder.Policy;

// Projects load with the SDK that global.json pins, taken from the dotnet host running this
// tool, so the scan sees the same compilation as the build.
internal static class PinnedSdk
{
    internal static IReadOnlyList<string> Register(string solution)
    {
        var host = Environment.ProcessPath;
        if (host is null || !string.Equals(Path.GetFileNameWithoutExtension(host), "dotnet", StringComparison.OrdinalIgnoreCase))
        {
            return ["run the tool with the pinned host: dotnet SharpLadder.Policy.dll"];
        }

        var globalJson = FindUp(Path.GetDirectoryName(solution), "global.json");
        if (globalJson is null)
        {
            return ["no global.json above " + solution + "; the SDK is not pinned"];
        }

        string? version;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(globalJson));
            var v = default(JsonElement);
            var pinned = doc.RootElement.TryGetProperty("sdk", out var sdk) && sdk.TryGetProperty("version", out v);
            version = pinned && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }
        catch (JsonException e)
        {
            return [globalJson + ": " + e.Message];
        }

        var root = Path.GetDirectoryName(host)!;
        var sdkPath = Path.Combine(root, "sdk", version ?? string.Empty);
        if (version is null || !File.Exists(Path.Combine(sdkPath, "MSBuild.dll")))
        {
            return [globalJson + " pins SDK " + (version ?? "(none)") + ", which " + host + " does not have"];
        }

        MSBuildLocator.RegisterMSBuildPath(sdkPath);

        // The out-of-process build host resolves dotnet from these, so it uses the same SDK.
        Environment.SetEnvironmentVariable("DOTNET_HOST_PATH", host);
        Environment.SetEnvironmentVariable("DOTNET_ROOT", root);
        Environment.SetEnvironmentVariable("DOTNET_MULTILEVEL_LOOKUP", "0");
        Environment.SetEnvironmentVariable("PATH", root + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH"));
        return [];
    }

    private static string? FindUp(string? directory, string name)
    {
        for (var dir = directory; dir is not null; dir = Path.GetDirectoryName(dir))
        {
            var path = Path.Combine(dir, name);
            if (File.Exists(path))
            {
                return path;
            }
        }

        return null;
    }
}
