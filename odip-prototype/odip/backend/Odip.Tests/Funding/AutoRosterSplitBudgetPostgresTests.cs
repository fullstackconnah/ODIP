using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// Auto-roster apply (R7 PR3) against a real PostgreSQL (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset): a split whose second half the budget refuses writes nothing for that shift
/// (the cut is put back, no second shift is left), while another kept row in the same apply is still saved. The budget check needs the ledger, so EF InMemory cannot show it.
/// </summary>
public class AutoRosterSplitBudgetPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private static readonly DateOnly Wed14Oct = new(2026, 10, 14);

    private readonly PostgresFixture _pg;
    public AutoRosterSplitBudgetPostgresTests(PostgresFixture pg) => _pg = pg;

    private static User Worker(OdipDbContext db, Guid tenantId, string name) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    [SkippableFact] // [D]
    public async Task ASplitWhoseSecondHalfIsOverBudget_WritesNothingForThatShift_WhileAnotherRowIsSaved()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync(Ct);
        var (db, tenantId) = await _pg.NewTenantContextAsync(cs);
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        // October's budget is $300 and an hour costs $60: the 4 h first half fits ($240), the 4 h second half does not.
        var tight = kit.SeedParticipant();
        kit.SeedPlan(tight, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 300.00m)));
        var split = kit.SeedShift(tight, Wed14Oct);                    // 09:00 to 17:00, Published, nobody on it
        var roomy = kit.SeedParticipant(first: "Rae", last: "Green");
        kit.SeedPlan(roomy, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 10000.00m)));
        var other = kit.SeedShift(roomy, Wed14Oct, startHour: 9, endHour: 13);
        kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = tenantId, Mode = BudgetLimitMode.HardLimit });
        var pat = Worker(kit.Db, tenantId, "Pat");
        var quinn = Worker(kit.Db, tenantId, "Quinn");
        var sam = Worker(kit.Db, tenantId, "Sam");
        await kit.Db.SaveChangesAsync(Ct);
        foreach (var s in new[] { split, other }) { s.UserId = null; }
        await kit.Db.SaveChangesAsync(Ct);

        var controller = new RosteringController(kit.Db, new StaffCompatibilityLinkService(kit.Db), new StaffUnavailabilityQuery(kit.Db), clock: kit.Clock, tenant: tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "Coordinator") }, "test")) } },
        };
        var dto = new AutoRosterApplyDto
        {
            Rows = [new() { ShiftId = other.Id, StaffId = sam.Id }],
            Splits = [new() { ShiftId = split.Id, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), CutAt = new TimeOnly(13, 0), FirstStaffId = pat.Id, SecondStaffId = quinn.Id }],
        };

        var applied = Assert.IsType<ApiResponse<AutoRosterApplyResultDto>>(Assert.IsType<OkObjectResult>((await controller.AutoRosterApply(Mon12Oct, dto, Ct)).Result).Value).Data!;

        Assert.Equal(new[] { other.Id }, applied.Applied);
        Assert.Equal(split.Id, Assert.Single(applied.Skipped).ShiftId);
        kit.Db.ChangeTracker.Clear();
        var mine = await kit.Db.Shifts.AsNoTracking().Where(s => s.ParticipantId == tight.Id).ToListAsync(Ct);
        var whole = Assert.Single(mine);                                // no second half was left behind
        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(17, 0), (Guid?)null), (whole.StartTime, whole.EndTime, whole.UserId));
        Assert.Equal(sam.Id, (await kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == other.Id, Ct)).UserId);
    }
}
