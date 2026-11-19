using System.Text.Json.Nodes;
using Xunit;

namespace SharpLadder.CodeCheck.Tests;

public sealed class ReferenceSetTests
{
    private const string Reinstall = "; run node tools/install-tools.mjs";

    private static readonly string PinVersion = Locations.FromRepository(Checker.RepositoryRoot).RuntimeVersion;

    [Fact]
    public void StaleStampExitsTwo()
    {
        using var install = StandIn();
        install.Write(".tools/dotnet-ref.stamp.json", $"{{\"version\":\"{PinVersion}\",\"sha512\":\"{new string('0', 128)}\"}}\n");

        AssertRefused(install, $".tools/dotnet-ref.stamp.json does not record the dotnet-ref pin ({PinVersion} and its sha512){Reinstall}");
    }

    [Fact]
    public void MissingInstallExitsTwo()
    {
        using var install = StandIn();
        Directory.Delete(Path.Combine(install.Path, ".tools", "ref-net10"), recursive: true);

        AssertRefused(install, $".tools/ref-net10 is missing{Reinstall}");
    }

    [Fact]
    public void MissingListedDllExitsTwo()
    {
        using var install = StandIn();
        File.Delete(Path.Combine(install.Path, ".tools", "ref-net10", "System.Runtime.dll"));

        AssertRefused(install, $".tools/ref-net10 differs from tools/reference-dlls.json (missing: System.Runtime.dll; not listed: none){Reinstall}");
    }

    [Fact]
    public void UnlistedEntryExitsTwo()
    {
        using var install = StandIn();
        install.Write(".tools/ref-net10/Extra.dll", "an entry the list does not name\n");

        AssertRefused(install, $".tools/ref-net10 differs from tools/reference-dlls.json (missing: none; not listed: Extra.dll){Reinstall}");
    }

    [Fact]
    public void ListedDllThatIsNotMetadataExitsTwo()
    {
        using var install = StandIn();
        install.Write(".tools/ref-net10/System.Runtime.dll", "not an assembly\n");

        AssertRefused(install, $".tools/ref-net10/System.Runtime.dll is not valid metadata{Reinstall}");
    }

    [Fact]
    public void ListForAnotherVersionThanThePinExitsTwo()
    {
        using var install = StandIn();
        var listPath = Path.Combine(install.Path, "tools", "reference-dlls.json");
        var list = JsonNode.Parse(File.ReadAllText(listPath))!.AsObject();
        list["version"] = "0.0.1";
        File.WriteAllText(listPath, list.ToJsonString() + "\n");

        AssertRefused(install, $"tools/reference-dlls.json is for 0.0.1, the pin is {PinVersion}");
    }

    private static void AssertRefused(TempFolder install, string expected)
    {
        using var root = Checker.EmptyRoot();

        var (code, lines) = Checker.Check(install.Path, root.Path);

        Assert.Equal(2, code);
        Assert.Equal(["  " + expected, "FAIL code check"], lines);
    }

    // A copy of the live pins, list, stamp and reference folder in the test's own folder.
    private static TempFolder StandIn()
    {
        var install = new TempFolder();
        foreach (var relative in new[] { "tools/tool-pins.json", "tools/reference-dlls.json", ".tools/dotnet-ref.stamp.json" })
        {
            var target = Path.Combine(install.Path, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(Path.Combine(Checker.RepositoryRoot, relative), target);
        }

        var folder = Directory.CreateDirectory(Path.Combine(install.Path, ".tools", "ref-net10"));
        foreach (var dll in Directory.EnumerateFiles(Path.Combine(Checker.RepositoryRoot, ".tools", "ref-net10")))
        {
            File.Copy(dll, Path.Combine(folder.FullName, Path.GetFileName(dll)));
        }

        return install;
    }
}
