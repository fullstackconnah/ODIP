using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// What the roster's own endpoints say about the patterns an approval made and the shifts generated from them: where a pattern came from (so PatternsPage can badge it and warn on a change), what it
/// asks of a worker (so a pattern, and a shift on the board, can show it as chips), and that editing such a pattern is allowed and keeps its provenance. Nothing is locked.
/// </summary>
public class PlanApprovalRosterDtoTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly Monday = new(2026, 10, 5);
    private const string Female = """{"workerGender":"Female","driver":true,"skills":["FirstAid","ManualHandling"]}""";

    private static OdipDbContext NewDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static RosteringController Controller(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private sealed record Seed(OdipDbContext Db, Participant Participant, ServiceAgreementDraft Draft, ShiftPattern FromAgreement, ShiftPattern HandMade);

    private static async Task<Seed> SeedAsync(string? skippedBlock = null, DateOnly? skippedDay = null)
    {
        var db = NewDb();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var quote = new PlanQuote
        {
            HolidayOccurrences = skippedBlock is null ? Array.Empty<HolidayOccurrence>() : new[] { new HolidayOccurrence(skippedBlock, skippedDay!.Value, "Labour Day", "NSW", HolidayDecision.Skip, true, null, null, null) },
        };
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, Version = 2, State = "NSW", ParticipantNameSnapshot = "Amy Ng", PricingJson = DraftJson.Write(quote),
            AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2026, 12, 31), PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        };
        var fromAgreement = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            EffectiveFrom = draft.AgreementStartDate, EffectiveTo = draft.AgreementEndDate, IsActive = true, Notes = "From agreement v2: Community access, community",
            SourceDraftId = draft.Id, SourceBlockKey = "mornings", WorkerSlot = 1, RequirementsJson = Female,
        };
        var handMade = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            EffectiveFrom = draft.AgreementStartDate, IsActive = true,
        };
        db.Participants.Add(participant);
        db.ServiceAgreementDrafts.Add(draft);
        db.ShiftPatterns.AddRange(fromAgreement, handMade);
        await db.SaveChangesAsync();
        return new Seed(db, participant, draft, fromAgreement, handMade);
    }

    private static JsonSerializerOptions ApiOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    [Fact]
    public async Task The_patterns_list_says_where_an_agreement_pattern_came_from_and_what_it_asks_of_a_worker_and_says_nothing_for_a_hand_made_one()
    {
        var s = await SeedAsync();
        await using var _ = s.Db;

        var result = await Controller(s.Db).GetPatterns(s.Participant.Id, CancellationToken.None);

        var patterns = Assert.IsType<ApiResponse<List<ShiftPatternDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var agreement = Assert.Single(patterns, p => p.Id == s.FromAgreement.Id);
        Assert.Equal((s.Draft.Id, 2, "mornings", 1), (agreement.SourceDraftId, agreement.SourceDraftVersion, agreement.SourceBlockKey, agreement.WorkerSlot));
        Assert.Equal(("Female", true), (agreement.Requirements!.WorkerGender, agreement.Requirements.Driver));
        Assert.Equal(new[] { "FirstAid", "ManualHandling" }, agreement.Requirements.Skills);
        var handMade = Assert.Single(patterns, p => p.Id == s.HandMade.Id);
        Assert.Equal((null, null, null, null, null), (handMade.SourceDraftId, handMade.SourceDraftVersion, handMade.SourceBlockKey, handMade.WorkerSlot, handMade.Requirements));
        var json = JsonSerializer.Serialize(patterns, ApiOptions());
        Assert.Contains($"\"sourceDraftId\":\"{s.Draft.Id}\",\"sourceBlockKey\":\"mornings\",\"sourceDraftVersion\":2,\"workerSlot\":1,\"requirements\":{{\"workerGender\":\"Female\",\"driver\":true,\"skills\":[\"FirstAid\",\"ManualHandling\"]}}", json);
    }

    [Fact]
    public async Task One_pattern_by_id_says_the_same()
    {
        var s = await SeedAsync();
        await using var _ = s.Db;

        var result = await Controller(s.Db).GetPatternById(s.FromAgreement.Id, CancellationToken.None);

        var pattern = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal((s.Draft.Id, 2, "mornings"), (pattern.SourceDraftId, pattern.SourceDraftVersion, pattern.SourceBlockKey));
        Assert.True(pattern.Requirements!.Driver);
    }

    [Fact]
    public async Task An_agreement_pattern_can_be_edited_on_the_patterns_page_and_keeps_where_it_came_from_and_what_it_asks_nothing_is_locked()
    {
        var s = await SeedAsync();
        await using var _ = s.Db;
        var edit = new UpdateShiftPatternDto
        {
            ParticipantId = s.Participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), EndsNextDay = false,
            Ratio = SupportRatio.OneToTwo, NightType = SleepoverType.None, EffectiveFrom = s.FromAgreement.EffectiveFrom, EffectiveTo = new DateOnly(2026, 11, 30), IsActive = true, Notes = "Moved an hour",
        };

        var result = await Controller(s.Db).UpdatePattern(s.FromAgreement.Id, edit, CancellationToken.None);

        var pattern = Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal((new TimeOnly(10, 0), SupportRatio.OneToTwo, "Moved an hour"), (pattern.StartTime, pattern.Ratio, pattern.Notes));
        Assert.Equal((s.Draft.Id, "mornings", 1, 2), (pattern.SourceDraftId, pattern.SourceBlockKey, pattern.WorkerSlot, pattern.SourceDraftVersion));
        Assert.Equal(Female, (await s.Db.ShiftPatterns.AsNoTracking().SingleAsync(p => p.Id == s.FromAgreement.Id)).RequirementsJson);
    }

    [Fact]
    public async Task The_board_shows_what_a_shift_asks_of_a_worker_and_a_shift_that_asks_nothing_carries_no_requirements()
    {
        var s = await SeedAsync();
        await using var _ = s.Db;
        var generated = await new RosterShiftGenerator().GenerateAsync(s.Db, s.Participant.Id, new[] { s.FromAgreement.Id, s.HandMade.Id }, Monday, Monday.AddDays(1), CancellationToken.None);

        var result = await Controller(s.Db).GetBoard(Monday, "participant", CancellationToken.None);

        Assert.Equal(2, generated.Created);
        var board = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var shifts = Assert.Single(board.ParticipantRows!, row => row.ParticipantId == s.Participant.Id).Shifts;
        var asking = Assert.Single(shifts, shift => shift.ServiceDate == Monday);
        Assert.Equal(("Female", true), (asking.Requirements!.WorkerGender, asking.Requirements.Driver));
        Assert.Equal(new[] { "FirstAid", "ManualHandling" }, asking.Requirements.Skills);
        Assert.Null(Assert.Single(shifts, shift => shift.ServiceDate == Monday.AddDays(1)).Requirements);
        Assert.DoesNotContain("requirements", JsonSerializer.Serialize(shifts.Single(shift => shift.ServiceDate == Monday.AddDays(1)), ApiOptions()));
    }

    [Fact]
    public async Task The_Generate_button_on_an_agreement_pattern_copies_what_it_asks_and_leaves_out_the_holiday_the_plan_skips()
    {
        var s = await SeedAsync(skippedBlock: "mornings", skippedDay: Monday);
        await using var _ = s.Db;

        var result = await Controller(s.Db).GeneratePattern(s.FromAgreement.Id, Monday, Monday.AddDays(14), CancellationToken.None);

        var counts = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal((2, 1), (counts.Created, counts.Skipped));                       // the 12th and 19th are made, the 5th is a holiday the plan skips
        var shifts = await s.Db.Shifts.ToListAsync();
        Assert.DoesNotContain(shifts, shift => shift.ServiceDate == Monday);
        Assert.All(shifts, shift => Assert.Equal(Female, shift.RequirementsJson));
    }
}
