using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Decision-bulk deep M2 on a real PostgreSQL: the clean-only approve reads the queue's flags through the same joins the queue does (the shift's
/// active incidents, the completion's breaks, the participant's dose slots), in a tenant. A shift whose incident was filed after the dashboard read
/// the queue is skipped as SHIFT_NEEDS_REVIEW; its clean sibling is approved. Skipped, never failed, without POSTGRES_CONNECTION_STRING.
/// </summary>
public class CompletionCleanOnlyPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day = new(2026, 9, 8);
    private readonly PostgresFixture _pg;
    public CompletionCleanOnlyPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static RosteringController As(OdipDbContext db, Guid callerId) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, callerId.ToString())], "Test")) },
        },
    };

    [SkippableFact(DisplayName = "Postgres: a clean-only batch skips a shift whose incident was linked after Finish and approves its clean sibling")]
    public async Task CleanOnlyBatch_SkipsTheShiftWithANewIncident_ApprovesTheCleanOne()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class

        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.AddRange(staff, participant);
        Shift NewShift() => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = Day,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        ShiftCompletion NewCompletion(Guid shiftId) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shiftId, ActualStart = DateTime.UtcNow.AddHours(-8), ActualEnd = DateTime.UtcNow,
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = staff.Id, StartedAt = DateTime.UtcNow.AddHours(-8), SubmittedAt = DateTime.UtcNow, IsActive = true,
        };
        var flagged = NewShift();
        var clean = NewShift();
        db.AddRange(flagged, clean, NewCompletion(flagged.Id), NewCompletion(clean.Id));
        await db.SaveChangesAsync(Ct);
        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = flagged.Id, ReportedByUserId = staff.Id, Title = "Fall during transfer", Description = "Details.",
            IncidentDateTime = new DateTime(2026, 9, 8, 10, 0, 0, DateTimeKind.Utc), Severity = IncidentSeverity.High, Status = IncidentStatus.Submitted, IsActive = true,
        });
        await db.SaveChangesAsync(Ct);

        var result = await As(db, Guid.NewGuid()).ApproveBatch(new ApproveBatchDto([flagged.Id, clean.Id], CleanOnly: true), Ct);

        var items = Assert.IsType<ApiResponse<List<ApproveBatchResultDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(ShiftErrorCodes.ShiftNeedsReview, items.Single(r => r.ShiftId == flagged.Id).Code);
        Assert.True(items.Single(r => r.ShiftId == clean.Id).Approved);
        db.ChangeTracker.Clear();
        Assert.Equal(ShiftStatus.PendingReview, (await db.Shifts.SingleAsync(s => s.Id == flagged.Id, Ct)).Status);
        Assert.Equal(ShiftStatus.Completed, (await db.Shifts.SingleAsync(s => s.Id == clean.Id, Ct)).Status);
    }
}
