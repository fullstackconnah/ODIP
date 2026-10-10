using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The consent, health, ADL, checklist and community-access grids can be saved one row at a time
/// (the PUT controllers) or inside a participant save (wizard, Update, PATCH, caregiver accept).
/// Both routes must apply an answer the same way; each test saves the same sequence of answers
/// through both and compares what the row looked like after every step.
/// </summary>
public class ParticipantGridRulesAgreementTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static ParticipantsController ParticipantsFor(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    /// <summary>Saves each step through <paramref name="save"/> and describes the row after it: its
    /// fields, whether RecordedAt was left alone or re-stamped, and whether UpdatedAt moved.</summary>
    private static async Task<List<string>> Run<TStep>(
        IEnumerable<TStep> steps,
        Func<OdipDbContext, Guid, TStep, Task> save,
        Func<OdipDbContext, Guid, Task<(string Fields, DateTime? RecordedAt, DateTime UpdatedAt)>> read)
    {
        using var db = CreateDb();
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var seen = new List<string>();
        DateTime? previousRecordedAt = null;
        var previousUpdatedAt = DateTime.MinValue;
        foreach (var step in steps)
        {
            await Task.Delay(20); // UtcNow must differ between saves for "kept" vs "re-stamped" to be visible
            await save(db, participant.Id, step);
            var (fields, recordedAt, updatedAt) = await read(db, participant.Id);
            var recorded = recordedAt is null ? "none" : recordedAt == previousRecordedAt ? "kept" : "re-stamped";
            seen.Add($"{fields} recorded={recorded} updated={(updatedAt > previousUpdatedAt ? "moved" : "same")}");
            (previousRecordedAt, previousUpdatedAt) = (recordedAt, updatedAt);
        }
        return seen;
    }

    private static readonly DateOnly SignedOn = new(2026, 1, 15);

    [Fact]
    public async Task Consent_SingleRowPut_And_ParticipantSave_ApplyAnswersIdentically()
    {
        var steps = new (bool? Granted, string? Name, DateOnly? Date)[]
        {
            (true, "  Sophie  ", SignedOn),   // first grant stamps, name is trimmed
            (true, "Sophie B", SignedOn),     // same Granted: RecordedAt must not move
            (false, "   ", null),             // changed: re-stamped, blank name becomes null
            (null, null, null),               // cleared: RecordedAt cleared, row kept
        };
        async Task<(string, DateTime?, DateTime)> Read(OdipDbContext db, Guid id)
        {
            var r = await db.ParticipantConsents.SingleAsync(c => c.ParticipantId == id);
            return ($"{r.Granted}|{r.SignedByName}|{r.SignedDate:yyyy-MM-dd}", r.RecordedAt, r.UpdatedAt);
        }

        var put = await Run(steps, async (db, id, s) =>
            await new ParticipantConsentsController(db).Upsert(id, nameof(ConsentType.Privacy),
                new UpsertParticipantConsentDto { Granted = s.Granted, SignedByName = s.Name, SignedDate = s.Date }, default), Read);
        var save = await Run(steps, async (db, id, s) =>
        {
            await ParticipantPatchApplier.UpsertConsentsAsync(db, id, new() { new() { ConsentType = ConsentType.Privacy, Granted = s.Granted, SignedByName = s.Name, SignedDate = s.Date } }, default);
            await db.SaveChangesAsync();
        }, Read);

        Assert.Equal(put, save);
        // The rule itself, not only agreement: first grant stamps, the same answer keeps the stamp,
        // a flip re-stamps, clearing drops it. Names are trimmed and a blank one becomes null.
        Assert.Equal(new[]
        {
            "True|Sophie|2026-01-15 recorded=re-stamped updated=moved",
            "True|Sophie B|2026-01-15 recorded=kept updated=moved",
            "False|| recorded=re-stamped updated=moved",
            "|| recorded=none updated=moved",
        }, put);
    }

    [Fact]
    public async Task HealthCondition_SingleRowPut_And_ParticipantSave_ApplyAnswersIdentically()
    {
        var steps = new (bool? Has, string? Severity, bool? Plan, bool? Training, string? Notes)[]
        {
            (true, " Mild ", true, false, "  needs a plan  "),
            (null, "   ", null, null, "   "),
            (false, "Severe", false, true, "x"),
        };
        async Task<(string, DateTime?, DateTime)> Read(OdipDbContext db, Guid id)
        {
            var r = await db.ParticipantHealthConditions.SingleAsync(c => c.ParticipantId == id);
            return ($"{r.Has}|{r.Severity}|{r.PlanProvided}|{r.TrainingRequired}|{r.Notes}", (DateTime?)null, r.UpdatedAt);
        }

        var put = await Run(steps, async (db, id, s) =>
            await new ParticipantHealthConditionsController(db).Upsert(id, nameof(HealthConditionType.Epilepsy),
                new UpsertParticipantHealthConditionDto { Has = s.Has, Severity = s.Severity, PlanProvided = s.Plan, TrainingRequired = s.Training, Notes = s.Notes }, default), Read);
        var save = await Run(steps, async (db, id, s) =>
        {
            await ParticipantPatchApplier.UpsertHealthConditionsAsync(db, id, new() { new() { ConditionType = HealthConditionType.Epilepsy, Has = s.Has, Severity = s.Severity, PlanProvided = s.Plan, TrainingRequired = s.Training, Notes = s.Notes } }, default);
            await db.SaveChangesAsync();
        }, Read);

        Assert.Equal(put, save);
    }

    [Fact]
    public async Task AdlAssessment_SingleRowPut_And_ParticipantSave_ApplyAnswersIdentically()
    {
        var steps = new (AdlLevel? Level, string? Notes, string? HowToHelp)[]
        {
            (AdlLevel.Assistance, "  cue first  ", " prompt, then wait "),
            (null, "   ", null),
            (AdlLevel.Independent, "ok", "   "),
        };
        async Task<(string, DateTime?, DateTime)> Read(OdipDbContext db, Guid id)
        {
            var r = await db.ParticipantAdlAssessments.SingleAsync(a => a.ParticipantId == id);
            return ($"{r.Level}|{r.Notes}|{r.HowToHelpNotes}", (DateTime?)null, r.UpdatedAt);
        }

        var put = await Run(steps, async (db, id, s) =>
            await new ParticipantAdlAssessmentsController(db).Upsert(id, nameof(AdlType.Bathing),
                new UpsertParticipantAdlAssessmentDto { Level = s.Level, Notes = s.Notes, HowToHelpNotes = s.HowToHelp }, default), Read);
        var save = await Run(steps, async (db, id, s) =>
        {
            await ParticipantPatchApplier.UpsertAdlAssessmentsAsync(db, id, new() { new() { AdlType = AdlType.Bathing, Level = s.Level, Notes = s.Notes, HowToHelpNotes = s.HowToHelp } }, default);
            await db.SaveChangesAsync();
        }, Read);

        Assert.Equal(put, save);
    }

    [Fact]
    public async Task ChecklistItem_SingleRowPut_And_ParticipantSave_ApplyAnswersIdentically()
    {
        var steps = new (ChecklistItemValue? Value, string? Notes)[]
        {
            (ChecklistItemValue.Yes, "  power chair  "),
            (null, "   "),
            (ChecklistItemValue.NotApplicable, "n/a"),
        };
        async Task<(string, DateTime?, DateTime)> Read(OdipDbContext db, Guid id)
        {
            var r = await db.ParticipantChecklistItems.SingleAsync(c => c.ParticipantId == id);
            return ($"{r.Value}|{r.Notes}", (DateTime?)null, r.UpdatedAt);
        }

        var put = await Run(steps, async (db, id, s) =>
            await new ParticipantChecklistItemsController(db).Upsert(id, nameof(ChecklistItemType.UsesWheelchair),
                new UpsertParticipantChecklistItemDto { Value = s.Value, Notes = s.Notes }, default), Read);
        var save = await Run(steps, async (db, id, s) =>
        {
            await ParticipantPatchApplier.UpsertChecklistItemsAsync(db, id, new() { new() { ItemType = ChecklistItemType.UsesWheelchair, Value = s.Value, Notes = s.Notes } }, default);
            await db.SaveChangesAsync();
        }, Read);

        Assert.Equal(put, save);
    }

    [Fact]
    public async Task CommunityAccessRiskItem_SingleRowPut_And_ParticipantUpdate_ApplyAnswersIdentically()
    {
        var steps = new (RiskRatingLevel? Rating, string? Strategy)[]
        {
            (RiskRatingLevel.High, "  hold the rail  "),
            (null, "   "),
            (RiskRatingLevel.Low, "ok"),
        };
        async Task<(string, DateTime?, DateTime)> Read(OdipDbContext db, Guid id)
        {
            var r = await db.ParticipantCommunityAccessRiskItems.SingleAsync(x => x.ParticipantId == id);
            return ($"{r.Rating}|{r.StrategyNotes}", (DateTime?)null, r.UpdatedAt);
        }
        var itemType = Enum.GetValues<CommunityAccessRiskItemType>().First();

        var put = await Run(steps, async (db, id, s) =>
            await new ParticipantCommunityAccessRiskItemsController(db).Upsert(id, itemType.ToString(),
                new UpsertParticipantCommunityAccessRiskItemDto { Rating = s.Rating, StrategyNotes = s.Strategy }, default), Read);
        var update = await Run(steps, async (db, id, s) =>
            await ParticipantsFor(db).Update(id, new UpdateParticipantDto
            {
                FirstName = "Sophie", LastName = "Brown", IsActive = true, PlanType = PlanType.SelfManaged,
                OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
                CommunityAccessRiskItems = new() { new() { ItemType = itemType, Rating = s.Rating, StrategyNotes = s.Strategy } },
            }, default), Read);

        Assert.Equal(put, update);
    }
}
