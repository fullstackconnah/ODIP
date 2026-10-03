using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// A person's own record of a medication slot (PR 2 review finding H2). The app has no unique index on the slot of a dose, only the recorder's rule and slot lock:
/// one active record per scheduled slot. So nothing in the database stops the script writing a second active record beside a presenter's, and a pack that decides
/// "already written?" by its own deterministic id alone does exactly that: the shift's close writes the lunchtime dose "given a little late", and the dose
/// the presenter recorded as given (or refused) at 12:35 now has a second, contradicting record on the same slot. Each test records through the real recorder,
/// as the portal does, lets the script's next ticks come due, and asks for what the MAR would show: one active record for the slot, and it is the presenter's.
/// </summary>
public class DemoRecordedSlotTests
{
    private static readonly Guid Clobazam = MedicationCatalog.IdOf("sophie-clobazam");
    private static readonly Guid Omeprazole = MedicationCatalog.IdOf("sophie-omeprazole");

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateTime GivenAt(int hour, int minute) => ProviderLocalTime.LocalToUtc(At(Friday, hour, minute), Zone());

    /// <summary>One "record this dose" request through the app's own recorder, as a worker's portal sends it.</summary>
    private static async Task<Guid> RecordAsync(DemoTestEnv env, Guid medicationId, User worker, Guid participantId, CreateAdministrationDto dto)
    {
        await using var db = env.DemoTenantDb();                                                      // a portal request: tenant-scoped, so the row is the Demo tenant's
        var result = await new MedicationAdministrationRecorder(db, clock: env.Clock)
            .RecordAsync(new RecordAdministrationRequest(medicationId, dto, worker.Id, worker.FullName, participantId), CancellationToken.None);
        Assert.True(result.Outcome == RecordAdministrationOutcome.Created, $"the presenter's record was {result.Outcome}: {result.Message}");
        return result.Administration!.Id;
    }

    private static async Task AssertOnlyTheirs(DemoTestEnv env, Guid medicationId, DateTime slot, Guid theirs, User worker, MedicationAdministrationStatus status)
    {
        await using var check = env.AdminDb();
        var records = await check.MedicationAdministrations.Where(a => a.ParticipantMedicationId == medicationId && a.ScheduledAt == slot).ToListAsync();
        var only = Assert.Single(records);                                                              // nothing beside it, superseded or not
        Assert.Equal(theirs, only.Id);
        Assert.Equal(status, only.Status);
        Assert.Equal(worker.Id, only.RecordedByUserId);
        Assert.Null(only.SupersededByAdministrationId);
        Assert.DoesNotContain("demo-v1:", only.IdempotencyKey ?? string.Empty, StringComparison.Ordinal);       // the presenter's key, not the script's
    }

    [Fact]
    public async Task APresenterWhoRecordsTheLunchtimeDoseAsGiven_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn()
    {
        var env = await TickAsync(Utc("2026-10-02T02:30:00Z"));                                          // Fri 12:30: the lunchtime Clobazam (12:00) is due and nobody has recorded it
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.Null(morning.Slot(Clobazam, 12, 0));
        var slot = At(Friday, 12, 0);

        var theirs = await RecordAsync(env, Clobazam, morning.Worker, morning.Shift.ParticipantId, new CreateAdministrationDto
        {
            ScheduledAt = slot, Status = MedicationAdministrationStatus.Administered, AdministeredAt = GivenAt(12, 25), DoseGiven = "1 tablet (10mg)",
            IdempotencyKey = Guid.NewGuid().ToString("N"),
        });

        await RunAsync(env, Utc("2026-10-02T03:45:00Z"));                                                // Fri 13:45: the shift has been finished, which writes the doses nobody recorded
        await RunAsync(env, Utc("2026-10-02T04:30:00Z"));                                                // and one more

        await AssertOnlyTheirs(env, Clobazam, slot, theirs, morning.Worker, MedicationAdministrationStatus.Administered);
        Assert.NotNull((await RequireDayAsync(env, LiveSetCatalog.Morning, Friday)).Completion!.SubmittedAt);     // the shift itself was still finished
    }

    [Fact]
    public async Task APresenterWhoRecordsTheLunchtimeDoseAsRefused_BeforeTheShiftsEnd_LeavesOneActiveRecordOfTheSlot_TheirOwn()
    {
        var env = await TickAsync(Utc("2026-10-02T02:30:00Z"));
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        var slot = At(Friday, 12, 0);

        var theirs = await RecordAsync(env, Clobazam, morning.Worker, morning.Shift.ParticipantId, new CreateAdministrationDto
        {
            ScheduledAt = slot, Status = MedicationAdministrationStatus.Refused, Reason = "Sophie said no to the lunchtime tablet and was not to be pressed.",
            IdempotencyKey = Guid.NewGuid().ToString("N"),
        });

        await RunAsync(env, Utc("2026-10-02T03:45:00Z"));
        await RunAsync(env, Utc("2026-10-02T04:30:00Z"));

        await AssertOnlyTheirs(env, Clobazam, slot, theirs, morning.Worker, MedicationAdministrationStatus.Refused);       // not "refused, then given a little late"
        Assert.NotNull((await RequireDayAsync(env, LiveSetCatalog.Morning, Friday)).Completion!.SubmittedAt);
    }

    [Fact]
    public async Task APresenterWhoRecordsADoseTheScriptWouldWriteWhileTheShiftRuns_LeavesOneActiveRecordOfTheSlot_TheirOwn()
    {
        var env = await TickAsync(Utc("2026-10-01T23:55:00Z"));                                          // Fri 09:55: the 10:00 omeprazole is about to be due; the script refuses it at 10:08
        var morning = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        var slot = At(Friday, 10, 0);

        var theirs = await RecordAsync(env, Omeprazole, morning.Worker, morning.Shift.ParticipantId, new CreateAdministrationDto
        {
            ScheduledAt = slot, Status = MedicationAdministrationStatus.Administered, AdministeredAt = GivenAt(9, 54), DoseGiven = "1 capsule (20mg)",
            IdempotencyKey = Guid.NewGuid().ToString("N"),
        });

        await RunAsync(env, Utc("2026-10-02T00:30:00Z"));                                                // Fri 10:30: the script's refusal (10:08) has come due
        await RunAsync(env, Utc("2026-10-02T00:45:00Z"));

        await AssertOnlyTheirs(env, Omeprazole, slot, theirs, morning.Worker, MedicationAdministrationStatus.Administered);
        var day = await RequireDayAsync(env, LiveSetCatalog.Morning, Friday);
        Assert.Contains(day.Doses, d => d.ParticipantMedicationId == MedicationCatalog.Paracetamol);     // the rest of the morning was still written
    }
}
