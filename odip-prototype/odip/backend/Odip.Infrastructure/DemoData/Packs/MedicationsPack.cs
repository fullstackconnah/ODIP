using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The nine medications the plan adds to the Demo participants' charts (3a, see <see cref="MedicationCatalog"/>): the register shows seven Active,
/// one OnHold and one Ceased, daily and specific-day schedules, and an as-needed one with a minimum interval. The rows are made once, from the day
/// of the first run, and then left alone (insert-if-missing by deterministic id; the owner's edits win).
///
/// Plan 4.5: the top-up never writes the FIRST row of a table an old seed method guards with <c>Any()</c> (DbSeeder.SeedMedicationsAsync does), so a
/// future change that re-seeds medications still finds an empty table on a database that never had one. Here that means: only when at least one
/// of the old seed's own fixed-id medications is already there. A Demo participant who is missing skips only their medication.
/// </summary>
public sealed class MedicationsPack : IDemoPack
{
    public string Name => "medications";

    private static readonly IReadOnlyDictionary<string, string> ConsentBy = new Dictionary<string, string>
    {
        ["sophie"] = "Margaret Johnson (mother)",
        ["charlotte"] = "David Brown (father/guardian)",
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var oldSeed = await run.ExistingIdsAsync<ParticipantMedication>(MedicationCatalog.OldSeedIds, ct);
        if (oldSeed.Count == 0)
        {
            run.Skipped("medications", "none of the old seed's medications is there, so this would be the first row of a guarded table");
            return;
        }

        var expected = new List<ParticipantMedication>();
        foreach (var spec in MedicationCatalog.New)
        {
            var participant = run.Directory.Participant(spec.Participant);
            if (participant is null)
            {
                run.Skipped($"medication {spec.Key}", "the participant is missing");
                continue;
            }
            expected.Add(Build(run, spec, participant.Id));
        }

        var existing = await run.ExistingIdsAsync<ParticipantMedication>(expected.Select(m => m.Id), ct);
        var fresh = expected.Where(m => !existing.Contains(m.Id)).ToList();
        if (fresh.Count == 0) return;

        run.Db.ParticipantMedications.AddRange(fresh);
        await run.SaveAsync(ct);
        run.Added("medications", fresh.Count);
    }

    private static ParticipantMedication Build(DemoRun run, MedicationSpec spec, Guid participantId)
    {
        var anchors = run.Anchors;
        DateTime Midnight(int offsetDays) => anchors.D0.AddDays(offsetDays).ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);

        // Prescribed at nine on its start date; an on-hold or ceased medication was last changed when that happened.
        var prescribedAt = anchors.LocalToUtc(anchors.D0.AddDays(spec.StartOffset), new TimeOnly(9, 0));
        var changedAt = spec.EndOffset is { } end ? anchors.LocalToUtc(anchors.D0.AddDays(end), new TimeOnly(9, 0))
            : spec.Status == MedicationStatus.OnHold ? anchors.LocalToUtc(anchors.D0.AddDays(-10), new TimeOnly(9, 0))
            : prescribedAt;

        return new ParticipantMedication
        {
            Id = MedicationCatalog.IdOf(spec.Key),
            TenantId = run.TenantId,
            ParticipantId = participantId,
            Name = spec.Name,
            Strength = spec.Strength,
            Form = spec.Form,
            Route = spec.Route,
            DoseDescription = spec.DoseDescription,
            Directions = spec.Directions,
            Type = spec.Type,
            TimesOfDay = spec.Times,
            Frequency = spec.Frequency,
            DaysOfWeek = spec.Days,
            PrnIndication = spec.PrnIndication,
            PrnMaxDosesPer24h = spec.PrnMaxPer24h,
            PrnMinIntervalMinutes = spec.PrnMinIntervalMinutes,
            Purpose = spec.Purpose,
            IsPsychotropic = spec.Psychotropic,
            DrugSchedule = spec.Schedule,
            SupportLevel = spec.Support,
            PrescriberName = spec.Prescriber,
            PharmacyName = spec.Pharmacy,
            Packaging = spec.Packaging,
            StartDate = Midnight(spec.StartOffset),
            EndDate = spec.EndOffset is { } endOffset ? Midnight(endOffset) : null,
            NextReviewDue = spec.ReviewOffset is { } review ? Midnight(review) : null,
            ConsentObtained = true,
            ConsentGivenBy = ConsentBy.GetValueOrDefault(spec.Participant, "Participant"),
            ConsentDate = Midnight(spec.StartOffset),
            Status = spec.Status,
            Notes = spec.Notes,
            CreatedAt = prescribedAt,
            UpdatedAt = changedAt,
        };
    }
}
