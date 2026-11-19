namespace SharpLadder.CodeCheck;

// The muxer runs the group through exec with roll-forward disabled on the command line as well as
// in the runtime configuration, so neither the environment nor a default can widen the choice.
internal static class LaunchLine
{
    public static IReadOnlyList<string> Arguments(string runtimeConfig, string assembly) =>
        ["exec", "--roll-forward", "Disable", "--runtimeconfig", runtimeConfig, assembly];
}
