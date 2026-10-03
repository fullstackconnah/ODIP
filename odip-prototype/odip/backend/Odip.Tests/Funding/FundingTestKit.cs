using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// What every budget test needs: an InMemory database with the REAL audit interceptor, a fixed clock (4 Oct 2026, 03:00 UTC, which is 13:00 in Sydney, so the
/// provider's date and the UTC date agree), a controller scoped to one tenant and one role, and builders for plan bodies. Two kits made with the same
/// <c>database</c> name see the same rows through their own tenant filter, which is how the tenant tests show one organisation cannot reach another's.
/// </summary>
internal sealed class FundingTestKit : IDisposable
{
    public static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    public static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    public static readonly Guid UserId = Guid.Parse("dddddddd-0000-0000-0000-0000000000ad");

    /// <summary>The fixed instant of every kit's clock.</summary>
    public static readonly DateTimeOffset Now = new(2026, 10, 4, 3, 0, 0, TimeSpan.Zero);

    public OdipDbContext Db { get; }
    public ParticipantFundingController Controller { get; }
    public FundingPlanService Service { get; }
    public FakeClock Clock { get; }
    public Guid? TenantId { get; }

    private FundingTestKit(OdipDbContext db, ParticipantFundingController controller, FundingPlanService service, FakeClock clock, Guid? tenantId)
    {
        Db = db;
        Controller = controller;
        Service = service;
        Clock = clock;
        TenantId = tenantId;
    }

    public static FundingTestKit Create(Guid? tenantId = null, bool isSuperAdmin = false, string role = "Admin", string? database = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? (isSuperAdmin ? null : TenantA));
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);

        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, UserId.ToString()), new Claim("fullName", "Ada Admin"), new Claim(ClaimTypes.Role, role) }, "Test"));
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(database ?? Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        var clock = new FakeClock(Now);
        var service = new FundingPlanService(db, clock);
        var controller = new ParticipantFundingController(tenant.Object, service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } },
        };
        return new FundingTestKit(db, controller, service, clock, tenant.Object.TenantId);
    }

    public void Dispose() => Db.Dispose();

    /// <summary>A participant of <paramref name="tenantId"/> (this kit's tenant by default), saved with an empty audit trail so a test sees only its own rows.</summary>
    public Participant SeedParticipant(Guid? tenantId = null, DateOnly? planStart = null, DateOnly? planEnd = null, bool isDraft = false)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId ?? TenantA, FirstName = "Sophie", LastName = "Brown", IsActive = true, IsDraft = isDraft,
            PlanStartDate = planStart, PlanEndDate = planEnd,
        };
        Db.Participants.Add(participant);
        Db.SaveChanges();
        ClearAudit();
        return participant;
    }

    public void ClearAudit()
    {
        Db.AuditLogs.RemoveRange(Db.AuditLogs.ToList());
        Db.SaveChanges();
    }

    // ── Bodies ──────────────────────────────────────────────────────────────

    public static DateOnly D(int y, int m, int d) => new(y, m, d);

    public static SaveFundingPeriodDto Period(DateOnly start, DateOnly end, decimal amount, decimal? setAside = null) =>
        new() { PeriodStart = start, PeriodEnd = end, PlanAmount = amount, SetAside = setAside };

    /// <summary>The four 3-month periods of a plan that runs 1 Jul 2026 to 30 Jun 2027.</summary>
    public static List<SaveFundingPeriodDto> Quarters(decimal each = 2000m, decimal? setAside = null) => new()
    {
        Period(D(2026, 7, 1), D(2026, 9, 30), each, setAside),
        Period(D(2026, 10, 1), D(2026, 12, 31), each, setAside),
        Period(D(2027, 1, 1), D(2027, 3, 31), each, setAside),
        Period(D(2027, 4, 1), D(2027, 6, 30), each, setAside),
    };

    public static SaveFundingPoolDto Core(PlanType management = PlanType.PlanManaged, List<SaveFundingPeriodDto>? periods = null, string? name = null) => new()
    {
        Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = management, Name = name, Periods = periods ?? Quarters(),
    };

    public static SaveFundingPoolDto Stated(int category, PlanType management = PlanType.AgencyManaged, List<SaveFundingPeriodDto>? periods = null) => new()
    {
        Kind = FundingPoolKind.Stated, PaceCategory = category, ManagementType = management, Periods = periods ?? Quarters(500m),
    };

    /// <summary>A valid 3-monthly plan for 1 Jul 2026 to 30 Jun 2027 with a Core pool and a stated pool (category 15).</summary>
    public static SaveFundingPlanDto Plan(params SaveFundingPoolDto[] pools) => new()
    {
        PlanStart = D(2026, 7, 1), PlanEnd = D(2027, 6, 30), PeriodLengthMonths = 3, Evidence = BudgetEvidenceSource.PlanCopy,
        ReassessmentDate = D(2027, 5, 1), ConfirmedOn = D(2026, 9, 20), ConfirmedByName = "Priya Coordinator", Notes = "From the plan Sophie's mother shared.",
        Pools = pools.Length == 0 ? new List<SaveFundingPoolDto> { Core(), Stated(15) } : pools.ToList(),
    };

    /// <summary>The next plan: 1 Jul 2027 to 30 Jun 2028, with its own four quarters.</summary>
    public static SaveFundingPlanDto NextYearsPlan() => new()
    {
        PlanStart = D(2027, 7, 1), PlanEnd = D(2028, 6, 30), PeriodLengthMonths = 3, Evidence = BudgetEvidenceSource.PlanManager,
        Pools = new List<SaveFundingPoolDto>
        {
            Core(periods: new()
            {
                Period(D(2027, 7, 1), D(2027, 9, 30), 3000m), Period(D(2027, 10, 1), D(2027, 12, 31), 3000m),
                Period(D(2028, 1, 1), D(2028, 3, 31), 3000m), Period(D(2028, 4, 1), D(2028, 6, 30), 3000m),
            }),
        },
    };

    // ── Reading a response ──────────────────────────────────────────────────

    public static T Body<T>(ActionResult<Odip.Application.Common.ApiResponse<T>> result, int? expectedStatus = null)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        if (expectedStatus is { } status) Assert.Equal(status, objectResult.StatusCode ?? 200);
        var response = Assert.IsType<Odip.Application.Common.ApiResponse<T>>(objectResult.Value);
        Assert.True(response.Success, string.Join("; ", response.Errors ?? new List<string>()));
        return response.Data!;
    }

    public async Task<FundingPlanDto> CreatePlanAsync(Guid participantId, SaveFundingPlanDto? plan = null)
    {
        var result = await Controller.CreatePlan(participantId, plan ?? Plan(), CancellationToken.None);
        return Body(result, StatusCodes.Status201Created);
    }
}
