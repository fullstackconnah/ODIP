using System.Net;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Interfaces;
using Xunit;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// The concurrency limit on the plan quote (verification N1 of fix round 1): about two quotes in flight per organisation, never queued, and a 429 that says to try
/// again shortly. The worst legal request is about 90,000 lines and a second or two of CPU, and the "api" policy (100 a minute a client) says nothing about how many run
/// at once. The limiter is a resource filter (after authentication, where the tenant is known) rather than a rate limiter policy (before it, where only the address is).
/// </summary>
public class PlanQuoteConcurrencyTests
{
    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException("Could not locate Odip.sln");
    }

    private static ResourceExecutingContext ContextFor(string? user, IPAddress? client = null)
    {
        var http = new DefaultHttpContext();
        if (user is not null)
            http.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, user) }, "Test"));
        http.Connection.RemoteIpAddress = client;
        return new ResourceExecutingContext(new ActionContext(http, new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>(), new List<IValueProviderFactory>());
    }

    private static PlanQuoteConcurrencyFilter FilterFor(PlanQuoteConcurrencyLimiter limiter, Guid? tenant)
    {
        var current = new Mock<ICurrentTenant>();
        current.Setup(t => t.TenantId).Returns(tenant);
        return new PlanQuoteConcurrencyFilter(limiter, current.Object);
    }

    /// <summary>Starts a quote and leaves it in flight until <paramref name="release"/> finishes; Running is complete when the filter has, at once for a refusal.</summary>
    private static (ResourceExecutingContext Context, Task Running) Start(PlanQuoteConcurrencyFilter filter, ResourceExecutingContext context, Task release)
    {
        ResourceExecutionDelegate next = async () =>
        {
            await release;
            return new ResourceExecutedContext(context, new List<IFilterMetadata>());
        };
        return (context, filter.OnResourceExecutionAsync(context, next));
    }

    // ── The limit ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Two_quotes_for_an_organisation_run_at_once_and_a_third_is_refused_with_a_429_that_says_to_try_again_shortly()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter();
        var tenant = Guid.NewGuid();
        var release = new TaskCompletionSource();

        var first = Start(FilterFor(limiter, tenant), ContextFor("coordinator-1"), release.Task);
        var second = Start(FilterFor(limiter, tenant), ContextFor("coordinator-2"), release.Task);   // another user of the same organisation
        var third = Start(FilterFor(limiter, tenant), ContextFor("coordinator-3"), release.Task);

        Assert.Equal(2, PlanQuoteConcurrencyLimiter.PermitsPerOrganisation);
        Assert.False(first.Running.IsCompleted);   // admitted, and still working
        Assert.False(second.Running.IsCompleted);
        Assert.Null(first.Context.Result);
        Assert.True(third.Running.IsCompletedSuccessfully);   // refused at once, not queued
        var refused = Assert.IsType<ObjectResult>(third.Context.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, refused.StatusCode);
        var body = Assert.IsType<ApiResponse<PlanQuote>>(refused.Value);
        Assert.False(body.Success);
        Assert.Contains("try again shortly", Assert.Single(body.Errors!), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("1", third.Context.HttpContext.Response.Headers.RetryAfter.ToString());

        release.SetResult();
        await Task.WhenAll(first.Running, second.Running);
    }

    [Fact]
    public async Task A_permit_is_free_again_when_a_quote_finishes_and_when_one_throws()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter();
        var tenant = Guid.NewGuid();
        var firstGate = new TaskCompletionSource();
        var secondGate = new TaskCompletionSource();
        var rest = new TaskCompletionSource();
        var first = Start(FilterFor(limiter, tenant), ContextFor("a"), firstGate.Task);
        var second = Start(FilterFor(limiter, tenant), ContextFor("b"), secondGate.Task);
        Assert.IsType<ObjectResult>(Start(FilterFor(limiter, tenant), ContextFor("c"), rest.Task).Context.Result);   // full

        firstGate.SetResult();
        await first.Running;
        var afterFinish = Start(FilterFor(limiter, tenant), ContextFor("d"), rest.Task);
        Assert.Null(afterFinish.Context.Result);   // the finished quote's permit is free

        secondGate.SetException(new InvalidOperationException("the pricing failed"));
        await Assert.ThrowsAsync<InvalidOperationException>(() => second.Running);
        var afterThrow = Start(FilterFor(limiter, tenant), ContextFor("e"), rest.Task);
        Assert.Null(afterThrow.Context.Result);    // and so is the one that threw

        rest.SetResult();
        await Task.WhenAll(afterFinish.Running, afterThrow.Running);
    }

    [Fact]
    public async Task One_organisation_at_its_limit_does_not_slow_another()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter();
        var release = new TaskCompletionSource();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var running = new[] { Start(FilterFor(limiter, a), ContextFor("a1"), release.Task), Start(FilterFor(limiter, a), ContextFor("a2"), release.Task) };
        Assert.IsType<ObjectResult>(Start(FilterFor(limiter, a), ContextFor("a3"), release.Task).Context.Result);

        var other = Start(FilterFor(limiter, b), ContextFor("b1"), release.Task);

        Assert.Null(other.Context.Result);
        release.SetResult();
        await Task.WhenAll(running.Select(r => r.Running).Append(other.Running));
    }

    [Fact]
    public async Task With_no_organisation_the_limit_is_per_user_and_with_no_user_per_client()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter();
        var release = new TaskCompletionSource();
        var all = new List<Task>();

        // A SuperAdmin who has not chosen an organisation: two quotes each, a third refused, another user unaffected.
        foreach (var user in new[] { "super-1", "super-1" }) all.Add(Start(FilterFor(limiter, null), ContextFor(user), release.Task).Running);
        Assert.IsType<ObjectResult>(Start(FilterFor(limiter, null), ContextFor("super-1"), release.Task).Context.Result);
        var otherUser = Start(FilterFor(limiter, null), ContextFor("super-2"), release.Task);
        Assert.Null(otherUser.Context.Result);
        all.Add(otherUser.Running);

        // Nobody known at all: the client address is the key.
        var home = IPAddress.Parse("203.0.113.7");
        all.Add(Start(FilterFor(limiter, null), ContextFor(null, home), release.Task).Running);
        all.Add(Start(FilterFor(limiter, null), ContextFor(null, home), release.Task).Running);
        Assert.IsType<ObjectResult>(Start(FilterFor(limiter, null), ContextFor(null, home), release.Task).Context.Result);
        var elsewhere = Start(FilterFor(limiter, null), ContextFor(null, IPAddress.Parse("203.0.113.8")), release.Task);
        Assert.Null(elsewhere.Context.Result);
        all.Add(elsewhere.Running);

        release.SetResult();
        await Task.WhenAll(all);
    }

    // ── It is on the quote, and registered ───────────────────────────────────────

    [Fact]
    public void The_quote_action_runs_through_the_concurrency_filter_and_keeps_the_api_rate_limit()
    {
        var quote = typeof(PlanPricingController).GetMethod(nameof(PlanPricingController.Quote))!;

        Assert.Equal(typeof(PlanQuoteConcurrencyFilter), quote.GetCustomAttribute<ServiceFilterAttribute>()?.ServiceType);
        Assert.Equal("api", quote.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        // The routes that are light stay as they were.
        Assert.Null(typeof(PlanPricingController).GetMethod(nameof(PlanPricingController.GetSettings))!.GetCustomAttribute<ServiceFilterAttribute>());
        Assert.Null(typeof(PlanPricingController).GetMethod(nameof(PlanPricingController.PutSettings))!.GetCustomAttribute<ServiceFilterAttribute>());
    }

    [Fact]
    public void The_limiter_the_filter_and_the_pricing_service_are_registered_in_Program_cs()
    {
        // A ServiceFilter whose type is not registered fails at the first request, not at start-up, so no other test would notice (the same guard as ShiftPackageRegistrationTests).
        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));

        Assert.Contains("AddSingleton<Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter>()", program);
        Assert.Contains("AddScoped<Odip.Api.RateLimiting.PlanQuoteConcurrencyFilter>()", program);
        Assert.Contains("AddScoped<Odip.Infrastructure.Services.PlanPricingService>()", program);
    }
}
