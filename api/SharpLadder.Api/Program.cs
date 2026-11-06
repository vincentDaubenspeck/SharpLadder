using System.Reflection;
using SharpLadder.Api;

var builder = WebApplication.CreateBuilder(args);

// Scope and graph errors surface at startup in every environment, not on first request.
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.RespectNullableAnnotations = true);

var app = builder.Build();

var version = SourceRevision(typeof(Program).Assembly);
app.MapGet("/healthz", () => TypedResults.Ok(new Health("ok", version)));

await app.RunAsync().ConfigureAwait(false);

// The SDK appends the source control commit to the informational version after a plus sign.
static string SourceRevision(Assembly assembly)
{
    var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? string.Empty;
    var plus = informational.IndexOf('+', StringComparison.Ordinal);
    return plus < 0 ? string.Empty : informational[(plus + 1)..];
}
