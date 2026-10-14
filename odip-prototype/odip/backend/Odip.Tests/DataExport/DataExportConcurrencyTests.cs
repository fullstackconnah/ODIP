using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Domain.Interfaces;
using Xunit;

namespace Odip.Tests.DataExport;

/// <summary>
/// One data export at a time per organisation (REVIEW-004 S2): each holds a database connection and a repeatable-read transaction for as long as the client takes to
/// download, so a second start while one runs is refused with a 429, never queued. The same resource-filter pattern as the plan quote's limit.
/// </summary>
public class DataExportConcurrencyTests
{
    private static ResourceExecutingContext Context() =>
        new(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>(), new List<IValueProviderFactory>());

    private static DataExportConcurrencyFilter FilterFor(PlanQuoteConcurrencyLimiter limiter, Guid? tenant, bool superAdmin = false)
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(tenant);
        current.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new DataExportConcurrencyFilter(limiter, current.Object);
    }

    /// <summary>Starts an export that runs until <paramref name="release"/> finishes (or throws, if it faults); Running completes at once for a refusal.</summary>
    private static (ResourceExecutingContext Context, Task Running) Start(DataExportConcurrencyFilter filter, Task release)
    {
        var context = Context();
        ResourceExecutionDelegate next = async () =>
        {
            await release;
            return new ResourceExecutedContext(context, new List<IFilterMetadata>());
        };
        return (context, filter.OnResourceExecutionAsync(context, next));
    }

    [Fact]
    public async Task A_second_export_of_one_organisation_is_refused_at_once_with_a_429_while_another_organisation_still_exports()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation);
        var (tenant, otherTenant) = (Guid.NewGuid(), Guid.NewGuid());
        var release = new TaskCompletionSource();

        var first = Start(FilterFor(limiter, tenant), release.Task);
        var second = Start(FilterFor(limiter, tenant), release.Task);
        var other = Start(FilterFor(limiter, otherTenant), release.Task);

        Assert.Equal(1, DataExportConcurrencyFilter.PermitsPerOrganisation);
        Assert.False(first.Running.IsCompleted);
        Assert.False(other.Running.IsCompleted); // another organisation is not held up
        Assert.True(second.Running.IsCompletedSuccessfully); // refused at once, not queued
        var refused = Assert.IsType<ObjectResult>(second.Context.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, refused.StatusCode);
        Assert.Equal("An export for this organisation is already running. Try again when it finishes.", Assert.Single(Assert.IsType<ApiResponse<bool>>(refused.Value).Errors!));

        release.SetResult();
        await Task.WhenAll(first.Running, other.Running);
    }

    [Fact]
    public async Task The_slot_is_free_again_when_an_export_finishes_and_when_one_fails_or_is_aborted()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation);
        var tenant = Guid.NewGuid();

        await Start(FilterFor(limiter, tenant), Task.CompletedTask).Running;
        var afterSuccess = Start(FilterFor(limiter, tenant), Task.CompletedTask);
        await afterSuccess.Running;
        Assert.Null(afterSuccess.Context.Result);

        var failed = Start(FilterFor(limiter, tenant), Task.FromException(new OperationCanceledException("the client went away")));
        await Assert.ThrowsAsync<OperationCanceledException>(() => failed.Running);
        var afterFailure = Start(FilterFor(limiter, tenant), Task.CompletedTask);
        await afterFailure.Running;
        Assert.Null(afterFailure.Context.Result);
    }

    [Fact]
    public async Task With_no_organisation_the_filter_steps_aside_so_the_action_gives_its_own_400_or_403()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation);
        var claimTenant = Guid.NewGuid();
        var release = new TaskCompletionSource();
        var running = Start(FilterFor(limiter, claimTenant), release.Task);

        // A SuperAdmin with no organisation chosen, whose token names the tenant that is exporting: no 429, the action answers.
        var superAdmin = Start(FilterFor(limiter, claimTenant, superAdmin: true), Task.CompletedTask);
        await superAdmin.Running;

        Assert.Null(superAdmin.Context.Result);
        release.SetResult();
        await running.Running;
    }

    [Fact]
    public void Only_the_download_runs_through_the_filter_so_the_last_export_line_is_never_refused()
    {
        Assert.Equal(typeof(DataExportConcurrencyFilter),
            typeof(DataExportController).GetMethod(nameof(DataExportController.Download))!.GetCustomAttribute<ServiceFilterAttribute>()?.ServiceType);
        Assert.Null(typeof(DataExportController).GetMethod(nameof(DataExportController.Last))!.GetCustomAttribute<ServiceFilterAttribute>());
        Assert.Null(typeof(DataExportController).GetCustomAttribute<ServiceFilterAttribute>());
    }

    [Fact]
    public void The_export_gets_its_own_one_permit_limiter_and_the_quote_keeps_its_two()
    {
        // The registrations Program.cs makes, with the quote's beside them: a second unkeyed limiter would silently take the quote down to one permit.
        var services = new ServiceCollection();
        services.AddSingleton<PlanQuoteConcurrencyLimiter>();
        services.AddKeyedSingleton(DataExportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation));
        services.AddScoped<DataExportConcurrencyFilter>();
        services.AddScoped(_ => Mock.Of<ICurrentTenant>());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        using var scope = provider.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService<DataExportConcurrencyFilter>());
        Assert.NotSame(provider.GetRequiredService<PlanQuoteConcurrencyLimiter>(), provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(DataExportConcurrencyFilter.LimiterKey));
        // And by behaviour: the quote's limiter still admits two at once, the export's one.
        using (var first = provider.GetRequiredService<PlanQuoteConcurrencyLimiter>().TryEnter("tenant:a"))
        using (var second = provider.GetRequiredService<PlanQuoteConcurrencyLimiter>().TryEnter("tenant:a"))
            Assert.True(first.IsAcquired && second.IsAcquired);
        using (var first = provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(DataExportConcurrencyFilter.LimiterKey).TryEnter("tenant:a"))
        using (var second = provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(DataExportConcurrencyFilter.LimiterKey).TryEnter("tenant:a"))
            Assert.True(first.IsAcquired && !second.IsAcquired);

        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));
        Assert.Contains("AddKeyedSingleton(Odip.Api.RateLimiting.DataExportConcurrencyFilter.LimiterKey, (_, _) => new Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter(Odip.Api.RateLimiting.DataExportConcurrencyFilter.PermitsPerOrganisation))", program);
        Assert.Contains("AddScoped<Odip.Api.RateLimiting.DataExportConcurrencyFilter>()", program);
    }

    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException("Could not locate Odip.sln");
    }
}
