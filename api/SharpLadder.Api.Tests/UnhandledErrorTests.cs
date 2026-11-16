using System.Diagnostics.CodeAnalysis;
using System.Net;
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace SharpLadder.Api.Tests;

public sealed class UnhandledErrorTests
{
    private const string FaultPath = "/test-only/unhandled-error";

    [Fact]
    public async Task ProductionAnswersAnUnhandledErrorWithoutItsDetail()
    {
        var outcome = await RequestTheInjectedFaultAsync(Environments.Production);

        Assert.True(outcome.Reached);
        Assert.Equal(HttpStatusCode.InternalServerError, outcome.Status);
        Assert.DoesNotContain(outcome.Marker, outcome.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(nameof(InvalidOperationException), outcome.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(nameof(ThrowInjectedFault), outcome.Body, StringComparison.Ordinal);
    }

    // The control: the same injection must leak here, or the Production pass could be vacuous.
    [Fact]
    public async Task DevelopmentShowsTheInjectedFaultToProveTheHarnessCanSeeALeak()
    {
        var outcome = await RequestTheInjectedFaultAsync(Environments.Development);

        Assert.True(outcome.Reached);
        Assert.Contains(outcome.Marker, outcome.Body, StringComparison.Ordinal);
    }

    private static async Task<Outcome> RequestTheInjectedFaultAsync(string environment)
    {
        var token = TestContext.Current.CancellationToken;
        var marker = $"injected-fault-{Guid.NewGuid():N}";
        var probe = new FaultProbe();
        var factory = new FaultInjectingFactory(environment, marker, probe);
        await using (factory.ConfigureAwait(false))
        {
            factory.UseKestrel(0);

            // A fresh options object would aim the client at port 80 instead of the server's dynamic port.
            factory.ClientOptions.AllowAutoRedirect = false;
            using var client = factory.CreateClient();

            using var response = await client.GetAsync(new Uri(FaultPath, UriKind.Relative), token).ConfigureAwait(false);
            var body = await response.Content.ReadAsStringAsync(token).ConfigureAwait(false);
            return new Outcome(probe.Reached, response.StatusCode, marker, body);
        }
    }

    // Out of line so that any leaked stack trace must name this frame.
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void ThrowInjectedFault(string marker) => throw new InvalidOperationException(marker);

    private sealed record Outcome(bool Reached, HttpStatusCode Status, string Marker, string Body);

    // Proves the throwing branch ran, so an unrelated 500 cannot satisfy a Fact.
    private sealed class FaultProbe
    {
        private int _reached;

        public bool Reached => Volatile.Read(ref _reached) == 1;

        public void MarkReached() => Volatile.Write(ref _reached, 1);
    }

    private sealed class FaultInjectingFactory(string environment, string marker, FaultProbe probe) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment(environment);
            builder.ConfigureServices(services => services.AddSingleton<IStartupFilter>(new FaultInjectingStartupFilter(marker, probe)));
        }
    }

    // Appended after the application's pipeline, so the application's own error handling is what answers.
    private sealed class FaultInjectingStartupFilter(string marker, FaultProbe probe) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.Use((context, downstream) =>
            {
                if (!context.Request.Path.Equals(new PathString(FaultPath), StringComparison.Ordinal))
                {
                    return downstream(context);
                }

                probe.MarkReached();
                ThrowInjectedFault(marker);
                return Task.CompletedTask;
            });
        };
    }
}
