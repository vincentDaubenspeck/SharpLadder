using System.Diagnostics;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace SharpLadder.Api.Tests;

public sealed class HealthzTests
{
    [Fact]
    public async Task HealthzReportsOkAndTheCommitOfThisCheckout()
    {
        var token = TestContext.Current.CancellationToken;
        await using var factory = new WebApplicationFactory<Program>();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(new Uri("/healthz", UriKind.Relative), token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        Assert.Equal("ok", body.RootElement.GetProperty("status").GetString());
        var version = body.RootElement.GetProperty("version").GetString();
        Assert.Matches("^[0-9a-f]{40}$", version);
        Assert.Equal(await HeadCommitAsync(token), version);
    }

    // The build stamps the commit checked out at build time, which is HEAD of this checkout.
    private static async Task<string> HeadCommitAsync(CancellationToken token)
    {
        var start = new ProcessStartInfo("git", "rev-parse HEAD")
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        using var git = Process.Start(start) ?? throw new InvalidOperationException("git did not start.");
        var output = await git.StandardOutput.ReadToEndAsync(token).ConfigureAwait(false);
        await git.WaitForExitAsync(token).ConfigureAwait(false);
        Assert.Equal(0, git.ExitCode);
        return output.Trim();
    }
}
