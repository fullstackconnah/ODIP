using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.AgreementBulkServiceTests;
using static Odip.Tests.Rostering.AgreementListTests;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements PR B: POST service-agreements/bulk, the request checks, the one save permit, the organisation scope and the roles.</summary>
public class AgreementBulkControllerTests
{
    private static ServiceAgreementsController Bulk(Fixture f, OdipDbContext? db = null, string role = "Admin", Guid? tenantId = null, bool superAdmin = false, bool noTenant = false, PlanQuoteConcurrencyLimiter? limiter = null)
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, role),
        }, "Test");
        db ??= f.Db;
        return new ServiceAgreementsController(db, Tenant(noTenant ? null : tenantId ?? TenantA, superAdmin), f.Clock, f.Service, saveLimiter: limiter)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static async Task<(int Status, List<BulkItem>? Data, ObjectResult? Raw)> PostAsync(ServiceAgreementsController c, AgreementBulkRequestDto dto)
    {
        var result = (await c.Bulk(dto, CancellationToken.None)).Result;
        return result switch
        {
            OkObjectResult ok => (200, ((ApiResponse<List<BulkItem>>)ok.Value!).Data, ok),
            ObjectResult other => (other.StatusCode ?? 0, null, other),
            _ => (0, null, null),
        };
    }

    private static AgreementBulkRequestDto Request(string action, IEnumerable<Guid> ids, DateOnly? end = null, string? priceList = null) =>
        new() { Action = action, ParticipantIds = ids.ToList(), EndDate = end, PriceList = priceList };

    private static Task<int> RevisionsAsync(Fixture f) => f.Db.ServiceAgreementDrafts.CountAsync();

    [Fact]
    public void The_cap_is_the_one_the_page_chunks_by() => Assert.Equal(25, ServiceAgreementsController.MaxItems);

    [Fact]
    public async Task Bulk_validates_the_request()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, new DateOnly(2026, 11, 22));
        var before = await RevisionsAsync(f);
        var many = Enumerable.Range(0, ServiceAgreementsController.MaxItems + 1).Select(_ => Guid.NewGuid());

        Assert.Equal(400, (await PostAsync(Bulk(f), Request("renew", []))).Status);
        var tooMany = await PostAsync(Bulk(f), Request("renew", many));
        Assert.Equal(400, tooMany.Status);
        Assert.Equal($"Select between 1 and {ServiceAgreementsController.MaxItems} agreements.", ((ApiResponse<List<BulkItem>>)tooMany.Raw!.Value!).Errors.Single());
        Assert.Equal(400, (await PostAsync(Bulk(f), Request("approve", [a.Id]))).Status);
        Assert.Equal(400, (await PostAsync(Bulk(f), Request("extend", [a.Id]))).Status);
        Assert.Equal(400, (await PostAsync(Bulk(f), Request("reprice", [a.Id], priceList: "nope"))).Status);
        Assert.Equal(before, await RevisionsAsync(f));                                          // every 400 wrote nothing

        var exactly = Enumerable.Range(0, ServiceAgreementsController.MaxItems).Select(_ => Guid.NewGuid()).ToList();
        var (status, data, _) = await PostAsync(Bulk(f), Request("renew", exactly));
        Assert.Equal(200, status);
        Assert.Equal(exactly, data!.Select(i => i.ParticipantId));                               // in the order sent

        var (_, once, _) = await PostAsync(Bulk(f), Request("renew", [a.Id, a.Id]));
        Assert.Equal("Created", Assert.Single(once!).Outcome);
    }

    private sealed class Probe(PlanQuoteConcurrencyLimiter limiter, string key) : SaveChangesInterceptor
    {
        public List<(bool First, bool Second)> Seen { get; } = [];

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Added))
            {
                using var first = limiter.TryEnter(key);
                using var second = limiter.TryEnter(key);
                Seen.Add((first.IsAcquired, second.IsAcquired));
            }
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    [Fact]
    public async Task Bulk_holds_one_save_permit_for_the_whole_request()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, new DateOnly(2026, 11, 22));
        var key = "save:tenant:" + TenantA.ToString("N");
        using var limiter = new PlanQuoteConcurrencyLimiter(2);
        var before = await RevisionsAsync(f);

        using (var l1 = limiter.TryEnter(key))
        using (var l2 = limiter.TryEnter(key))
        {
            var controller = Bulk(f, limiter: limiter);
            var busy = await PostAsync(controller, Request("renew", [a.Id]));
            Assert.Equal(429, busy.Status);
            Assert.Equal("1", controller.Response.Headers.RetryAfter.ToString());
            Assert.Equal(before, await RevisionsAsync(f));
        }

        Assert.Equal(200, (await PostAsync(Bulk(f, limiter: limiter), Request("renew", [a.Id]))).Status);
        using var again1 = limiter.TryEnter(key);
        using var again2 = limiter.TryEnter(key);
        Assert.True(again1.IsAcquired && again2.IsAcquired);                                    // released after the request
    }

    [Fact]
    public async Task Bulk_takes_one_permit_while_it_runs_so_a_probe_sees_one_left()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, new DateOnly(2026, 11, 22));
        var key = "save:tenant:" + TenantA.ToString("N");
        using var limiter = new PlanQuoteConcurrencyLimiter(2);
        var probe = new Probe(limiter, key);
        await using var db = NewDb(f.DbName, false, probe);

        Assert.Equal(200, (await PostAsync(Bulk(f, db, limiter: limiter), Request("renew", [a.Id]))).Status);

        Assert.Equal((true, false), Assert.Single(probe.Seen));
    }

    [Fact]
    public async Task Bulk_is_tenant_scoped()
    {
        await using var f = await NewAsync();
        var other = await ParticipantAsync(f, "Zed", TenantB);
        await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, tenantId: TenantB, participantId: other);
        var before = await RevisionsAsync(f);

        var (status, data, _) = await PostAsync(Bulk(f, superAdmin: true), Request("renew", [other]));

        Assert.Equal(200, status);
        Assert.Equal(("Failed", "Not found"), (data![0].Outcome, data[0].Reason));
        Assert.Equal(before, await RevisionsAsync(f));
        Assert.Equal(400, (await PostAsync(Bulk(f, noTenant: true, superAdmin: true), Request("renew", [other]))).Status);
        var roles = typeof(ServiceAgreementsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles;
        Assert.Equal("Admin,Coordinator,SuperAdmin", roles);
        Assert.Null(typeof(ServiceAgreementsController).GetMethod(nameof(ServiceAgreementsController.Bulk))!.GetCustomAttribute<AuthorizeAttribute>());
    }

    [Fact]
    public async Task Bulk_renew_needs_an_approver_extend_does_not()
    {
        await using var f = await NewAsync();
        var a = await AgreementAsync(f, null, Start, new DateOnly(2026, 11, 22));
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        await f.Db.SaveChangesAsync();
        var before = await RevisionsAsync(f);

        Assert.Equal(403, (await PostAsync(Bulk(f, role: "Coordinator"), Request("renew", [a.Id]))).Status);
        Assert.Equal(before, await RevisionsAsync(f));

        var (status, data, _) = await PostAsync(Bulk(f, role: "Coordinator"), Request("extend", [a.Id], end: new DateOnly(2026, 11, 29)));
        Assert.Equal(200, status);
        Assert.Equal("Created", Assert.Single(data!).Outcome);
    }
}
