namespace SharpLadder.Api;

/// <summary>The health endpoint's response body.</summary>
/// <param name="Status">Always <c>ok</c> when the app answers.</param>
/// <param name="Version">The commit the running build was made from.</param>
internal sealed record Health(string Status, string Version);
