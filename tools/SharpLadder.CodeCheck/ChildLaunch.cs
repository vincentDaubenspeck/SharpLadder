namespace SharpLadder.CodeCheck;

// Everything a backend needs to start a group's child. Environment is the child's whole
// environment: the backend passes it as given and lets nothing else be inherited.
internal sealed record ChildLaunch(
    string Muxer,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    IReadOnlyList<KeyValuePair<string, string>> Environment);
