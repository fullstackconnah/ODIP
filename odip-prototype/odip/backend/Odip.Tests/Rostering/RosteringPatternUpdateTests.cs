using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Editing the pattern an approved agreement made (plan builder, phase D). The patterns of one block are held to a unique key (revision, block, weekday, worker): moving one to a weekday
/// the block already has meets that key, which PostgreSQL refuses with SQLSTATE 23505. The screen has to hear that in words (409), not as a 500. The in-memory provider enforces no unique
/// index, so these tests make the save fail the way PostgreSQL does; the real violation is in <see cref="PlanApprovalPostgresTests"/>.
/// </summary>
public class RosteringPatternUpdateTests
{
    private sealed class KeyViolation(string constraint) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<ShiftPattern>().Any(entry => entry.State == EntityState.Modified))
                throw new DbUpdateException("duplicate key value violates unique constraint", new Npgsql.PostgresException(
                    messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                    sqlState: Npgsql.PostgresErrorCodes.UniqueViolation, tableName: "ShiftPatterns", constraintName: constraint));
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private static UpdateShiftPatternDto Move(ShiftPattern pattern, DayOfWeek day) => new()
    {
        ParticipantId = pattern.ParticipantId, DayOfWeek = day, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay, Ratio = pattern.Ratio,
        NightType = pattern.NightType, EffectiveFrom = pattern.EffectiveFrom, EffectiveTo = pattern.EffectiveTo, IsActive = pattern.IsActive, Notes = pattern.Notes,
    };

    private static async Task<(Fixture F, ShiftPattern Monday)> ApprovedAsync()
    {
        var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);
        return (f, await f.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.SourceDraftId == draft.Id && p.DayOfWeek == DayOfWeek.Monday));
    }

    [Fact]
    public async Task Moving_an_agreement_pattern_to_a_day_its_block_already_has_is_a_409_that_says_so_not_a_500()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName, false, new KeyViolation("IX_ShiftPatterns_SourceDraft_Block_Day_Slot"));
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdatePattern(monday.Id, Move(monday, DayOfWeek.Tuesday), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.False(body.Success);
        Assert.Contains("This agreement already has a pattern for that block, day and worker", Assert.Single(body.Errors!));
    }

    [Fact]
    public async Task A_unique_violation_of_any_other_key_is_not_passed_off_as_that_one()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName, false, new KeyViolation("IX_Something_Else"));
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        await Assert.ThrowsAsync<DbUpdateException>(() => controller.UpdatePattern(monday.Id, Move(monday, DayOfWeek.Tuesday), CancellationToken.None));
    }

    [Fact]
    public async Task An_edit_that_meets_no_key_still_saves_and_answers_with_the_pattern()
    {
        var (f, monday) = await ApprovedAsync();
        await using var _ = f;
        await using var db = NewDb(f.DbName);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdatePattern(monday.Id, Move(monday, DayOfWeek.Saturday) with { Notes = "Moved to the weekend" }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal((DayOfWeek.Saturday, "Moved to the weekend", monday.SourceDraftId), (body.Data!.DayOfWeek, body.Data.Notes, body.Data.SourceDraftId));
    }
}
