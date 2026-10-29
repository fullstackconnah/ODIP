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

namespace Odip.Tests.Imports;

/// <summary>
/// Two imports at a time per organisation, preview and commit together (audit I6): a third start is refused with a 429, never queued. The same resource-filter pattern as
/// the data export's limit.
/// </summary>
public class ImportConcurrencyTests
{
    private static ResourceExecutingContext Context() =>
        new(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>(), new List<IValueProviderFactory>());

    private static ImportConcurrencyFilter FilterFor(PlanQuoteConcurrencyLimiter limiter, Guid? tenant, bool superAdmin = false)
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(tenant);
        current.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new ImportConcurrencyFilter(limiter, current.Object);
    }

    /// <summary>Starts an import that runs until <paramref name="release"/> finishes (or throws, if it faults); Running completes at once for a refusal.</summary>
    private static (ResourceExecutingContext Context, Task Running) Start(ImportConcurrencyFilter filter, Task release)
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
    public async Task A_third_import_of_one_organisation_is_refused_at_once_with_a_429_while_another_organisation_still_imports()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation);
        var (tenant, otherTenant) = (Guid.NewGuid(), Guid.NewGuid());
        var release = new TaskCompletionSource();

        var first = Start(FilterFor(limiter, tenant), release.Task);
        var second = Start(FilterFor(limiter, tenant), release.Task);
        var third = Start(FilterFor(limiter, tenant), release.Task);
        var other = Start(FilterFor(limiter, otherTenant), release.Task);

        Assert.Equal(2, ImportConcurrencyFilter.PermitsPerOrganisation);
        Assert.False(first.Running.IsCompleted);
        Assert.False(second.Running.IsCompleted);
        Assert.False(other.Running.IsCompleted); // another organisation is not held up
        Assert.True(third.Running.IsCompletedSuccessfully); // refused at once, not queued
        var refused = Assert.IsType<ObjectResult>(third.Context.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, refused.StatusCode);
        Assert.Equal("Another import for this organisation is still running. Try again in a moment.", Assert.Single(Assert.IsType<ApiResponse<bool>>(refused.Value).Errors!));

        release.SetResult();
        await Task.WhenAll(first.Running, second.Running, other.Running);
    }

    [Fact]
    public async Task A_preview_and_a_commit_share_the_two_permits_because_both_run_through_one_limiter()
    {
        // Preview and Commit each get a filter over the one keyed limiter the container hands out, so two held imports of either kind refuse a third of the other.
        var services = new ServiceCollection();
        services.AddKeyedSingleton(ImportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation));
        using var provider = services.BuildServiceProvider();
        var limiter = provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(ImportConcurrencyFilter.LimiterKey);
        var tenant = Guid.NewGuid();
        var release = new TaskCompletionSource();

        var preview = Start(FilterFor(limiter, tenant), release.Task);
        var commit = Start(FilterFor(limiter, tenant), release.Task);
        var anotherPreview = Start(FilterFor(limiter, tenant), release.Task);

        Assert.Equal(StatusCodes.Status429TooManyRequests, Assert.IsType<ObjectResult>(anotherPreview.Context.Result).StatusCode);

        release.SetResult();
        await Task.WhenAll(preview.Running, commit.Running);
    }

    [Fact]
    public async Task The_permit_is_free_again_when_an_import_finishes_and_when_one_fails_or_is_aborted()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation);
        var tenant = Guid.NewGuid();
        var release = new TaskCompletionSource();
        var held = Start(FilterFor(limiter, tenant), release.Task); // one permit stays taken, so the other is the only one cycled

        await Start(FilterFor(limiter, tenant), Task.CompletedTask).Running;
        var failed = Start(FilterFor(limiter, tenant), Task.FromException(new OperationCanceledException("the client went away")));
        await Assert.ThrowsAsync<OperationCanceledException>(() => failed.Running);
        var afterFailure = Start(FilterFor(limiter, tenant), Task.CompletedTask);
        await afterFailure.Running;
        Assert.Null(afterFailure.Context.Result);

        release.SetResult();
        await held.Running;
    }

    [Fact]
    public async Task A_super_admin_or_a_request_with_no_organisation_steps_aside_so_the_action_gives_its_own_answer()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation);
        var claimTenant = Guid.NewGuid();
        var release = new TaskCompletionSource();
        var a = Start(FilterFor(limiter, claimTenant), release.Task);
        var b = Start(FilterFor(limiter, claimTenant), release.Task);

        var superAdmin = Start(FilterFor(limiter, claimTenant, superAdmin: true), Task.CompletedTask);
        var noTenant = Start(FilterFor(limiter, null), Task.CompletedTask);
        await Task.WhenAll(superAdmin.Running, noTenant.Running);

        Assert.Null(superAdmin.Context.Result);
        Assert.Null(noTenant.Context.Result);
        release.SetResult();
        await Task.WhenAll(a.Running, b.Running);
    }

    [Fact]
    public void Only_preview_and_commit_run_through_the_filter_so_history_template_and_undo_are_never_refused()
    {
        foreach (var name in new[] { nameof(ImportsController.Preview), nameof(ImportsController.Commit) })
            Assert.Equal(typeof(ImportConcurrencyFilter), typeof(ImportsController).GetMethod(name)!.GetCustomAttribute<ServiceFilterAttribute>()?.ServiceType);
        foreach (var name in new[] { nameof(ImportsController.History), nameof(ImportsController.Template), nameof(ImportsController.Undo) })
            Assert.Null(typeof(ImportsController).GetMethod(name)!.GetCustomAttribute<ServiceFilterAttribute>());
        Assert.Null(typeof(ImportsController).GetCustomAttribute<ServiceFilterAttribute>());
    }

    [Fact]
    public void The_imports_get_their_own_two_permit_limiter_and_the_export_keeps_its_one()
    {
        var services = new ServiceCollection();
        services.AddKeyedSingleton(ImportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(ImportConcurrencyFilter.PermitsPerOrganisation));
        services.AddKeyedSingleton(DataExportConcurrencyFilter.LimiterKey, (_, _) => new PlanQuoteConcurrencyLimiter(DataExportConcurrencyFilter.PermitsPerOrganisation));
        services.AddScoped<ImportConcurrencyFilter>();
        services.AddScoped(_ => Mock.Of<ICurrentTenant>());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        using var scope = provider.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService<ImportConcurrencyFilter>());
        Assert.NotSame(provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(ImportConcurrencyFilter.LimiterKey), provider.GetRequiredKeyedService<PlanQuoteConcurrencyLimiter>(DataExportConcurrencyFilter.LimiterKey));

        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));
        Assert.Contains("AddKeyedSingleton(Odip.Api.RateLimiting.ImportConcurrencyFilter.LimiterKey, (_, _) => new Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter(Odip.Api.RateLimiting.ImportConcurrencyFilter.PermitsPerOrganisation))", program);
        Assert.Contains("AddScoped<Odip.Api.RateLimiting.ImportConcurrencyFilter>()", program);
    }

    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException("Could not locate Odip.sln");
    }
}
