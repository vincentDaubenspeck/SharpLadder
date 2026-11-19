namespace SharpLadder.CodeCheck;

// Every path the checker uses comes from one repository root, so no other checkout and no ambient
// install is consulted. The runtime version is the reference pin's, the only place it is written.
internal sealed class Locations
{
    public const string ToolPinsShown = "tools/tool-pins.json";
    public const string ReferenceListShown = "tools/reference-dlls.json";
    public const string ReferenceFolderShown = ".tools/ref-net10";
    public const string ReferenceStampShown = ".tools/dotnet-ref.stamp.json";

    private Locations(string root, ReferencePin pin)
    {
        RepositoryRoot = root;
        Pin = pin;
        ToolPins = Path.Combine(root, "tools", "tool-pins.json");
        ReferenceList = Path.Combine(root, "tools", "reference-dlls.json");
        ReferenceFolder = Path.Combine(root, ".tools", "ref-net10");
        ReferenceStamp = Path.Combine(root, ".tools", "dotnet-ref.stamp.json");
        Muxer = Path.Combine(root, ".tools", "dotnet", OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet");
        RuntimeDirectory = Path.Combine(root, ".tools", "dotnet", "shared", "Microsoft.NETCore.App", pin.Version);
    }

    public string RepositoryRoot { get; }

    public ReferencePin Pin { get; }

    public string RuntimeVersion => Pin.Version;

    public string ToolPins { get; }

    public string ReferenceList { get; }

    public string ReferenceFolder { get; }

    public string ReferenceStamp { get; }

    public string Muxer { get; }

    public string RuntimeDirectory { get; }

    public static Locations FromRepository(string repositoryRoot)
    {
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(repositoryRoot));
        var pins = JsonFile.Read(Path.Combine(root, "tools", "tool-pins.json"), ToolPinsShown);
        var entry = pins["dotnet-ref"] as System.Text.Json.Nodes.JsonObject;
        var version = entry is null ? null : JsonFile.Text(entry, "version");
        var sha512 = entry is null ? null : JsonFile.Text(entry, "sha512");
        if (string.IsNullOrEmpty(version) || string.IsNullOrEmpty(sha512))
        {
            throw new ToolProblem($"{ToolPinsShown}: no dotnet-ref pin with a version and a sha512");
        }

        return new Locations(root, new ReferencePin(version, sha512));
    }
}
