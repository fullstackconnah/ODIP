using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// One medication the top-up adds to a Demo participant's chart (plan 3a): the nine new ones. <see cref="Key"/> feeds <see cref="DemoIds"/>, so the
/// row is found again on every tick whatever its values have become. Dates are offsets in days from the day of the first run (stored as typed
/// wall-clock midnights, like the old seed's); nothing is derived from the clock afterwards. A medication that was ceased or put on hold was first
/// prescribed Active: <see cref="ChangedOffset"/> is the day (an offset from the first run's, at nine in the morning) the coordinator made that change,
/// and <see cref="Status"/>, <see cref="EndOffset"/> and <see cref="Notes"/> are what it left (plan 4.4: the history shows the edit).
/// </summary>
public sealed record MedicationSpec(
    string Key, string Participant, string Name, string Strength, MedicationForm Form, MedicationRoute Route, string DoseDescription, string Directions,
    MedicationType Type, string? Times, string Purpose, DrugSchedule Schedule, MedicationSupportLevel Support, string Prescriber, string Pharmacy,
    PackagingType Packaging, int StartOffset, int? ReviewOffset, MedicationStatus Status = MedicationStatus.Active,
    MedicationFrequency Frequency = MedicationFrequency.Daily, Weekdays? Days = null, int? PrnMaxPer24h = null, int? PrnMinIntervalMinutes = null,
    string? PrnIndication = null, bool Psychotropic = false, int? EndOffset = null, string? Notes = null, int? ChangedOffset = null);

/// <summary>
/// The Demo tenant's medication charts as the top-up knows them: the nine medications it adds, and the fixed ids of the old seed's medications the
/// stories also use (DbSeeder.SeedMedicationsAsync). The nine are seven Active, one OnHold, one Ceased; Regular daily, on specific days and (in the
/// old seed) every N days; and one as-needed medication with a minimum interval besides the old seed's two. The plan names six participants for them
/// (3a); the one place this differs is that Olivia carries the specific-days one and the on-hold one, Mia the ceased one, so the register shows all
/// three statuses on people who also have shifts.
/// </summary>
public static class MedicationCatalog
{
    // Who the old seed's fixed-id medications belong to (DbSeeder.cs:1090-1100): the live stories and the history use these.
    public static readonly Guid Levetiracetam = Guid.Parse("70000000-0000-0000-0000-000000000001");      // Sophie, 08:00 and 20:00
    public static readonly Guid Paracetamol = Guid.Parse("70000000-0000-0000-0000-000000000002");        // Sophie, PRN (max 4 in 24 h, 240 min apart)
    public static readonly Guid CharlotteSertraline = Guid.Parse("70000000-0000-0000-0000-000000000004");   // Charlotte, 08:00
    public static readonly Guid InsulinGlargine = Guid.Parse("70000000-0000-0000-0000-000000000005");    // Harrison, 08:00, high risk
    public static readonly Guid Movicol = Guid.Parse("70000000-0000-0000-0000-00000000000a");            // Olivia, 08:00
    public static readonly Guid MiaSertraline = Guid.Parse("70000000-0000-0000-0000-00000000000f");      // Mia, 08:00

    /// <summary>Every fixed id of the old seed's fifteen medications: at least one must be present before this top-up writes a medication (plan 4.5).</summary>
    public static readonly IReadOnlyList<Guid> OldSeedIds = Enumerable.Range(1, 15)
        .Select(n => Guid.Parse($"70000000-0000-0000-0000-{n:x12}")).ToArray();

    public static readonly IReadOnlyList<MedicationSpec> New = new MedicationSpec[]
    {
        new("sophie-omeprazole", "sophie", "Omeprazole", "20mg", MedicationForm.Capsule, MedicationRoute.Oral, "1 capsule (20mg)",
            "Give 30 minutes before food, with a glass of water.", MedicationType.Regular, "10:00",
            "Stomach protection while on regular anti-seizure medication.", DrugSchedule.Schedule4, MedicationSupportLevel.Administer,
            "Dr. Amina Yusuf", "Coorparoo Chemist Warehouse", PackagingType.WebsterPack, -60, 30),
        new("sophie-clobazam", "sophie", "Clobazam", "10mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (10mg)",
            "Midday and evening, with food.", MedicationType.Regular, "12:00,20:00",
            "Add-on treatment for breakthrough seizures.", DrugSchedule.Schedule4, MedicationSupportLevel.Administer,
            "Dr. Amina Yusuf", "Coorparoo Chemist Warehouse", PackagingType.WebsterPack, -45, 20, Psychotropic: true),
        new("charlotte-quetiapine", "charlotte", "Quetiapine", "25mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (25mg)",
            "Evening, an hour before bed.", MedicationType.Regular, "20:00",
            "Evening settling and mood stability, as set out in the behaviour support plan.", DrugSchedule.Schedule4, MedicationSupportLevel.Administer,
            "Dr. Farid Haidari", "Toowong Community Pharmacy", PackagingType.WebsterPack, -50, 25, Psychotropic: true),
        new("harrison-metformin", "harrison", "Metformin", "500mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (500mg)",
            "With the midday meal.", MedicationType.Regular, "12:00",
            "Blood glucose management alongside basal insulin.", DrugSchedule.Schedule4, MedicationSupportLevel.Assist,
            "Dr. Priya Chandran", "Chermside Pharmacy", PackagingType.DosetteBox, -75, 45),
        new("liam-baclofen", "liam", "Baclofen", "10mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (10mg)",
            "Three times a day, morning, mid-afternoon and evening.", MedicationType.Regular, "08:00,14:00,20:00",
            "Muscle spasticity.", DrugSchedule.Schedule4, MedicationSupportLevel.Assist,
            "Dr. Sanjay Mehta", "Woodridge Family Pharmacy", PackagingType.DosetteBox, -90, 60),
        new("olivia-vitamin-d", "olivia", "Vitamin D3", "1000IU", MedicationForm.Capsule, MedicationRoute.Oral, "1 capsule (1000IU)",
            "Tuesdays and Fridays, with breakfast.", MedicationType.Regular, "09:00",
            "Low vitamin D.", DrugSchedule.Unscheduled, MedicationSupportLevel.Assist,
            "Dr. Amina Yusuf", "Box Hill Amcal Pharmacy", PackagingType.Sachet, -120, 90,
            Frequency: MedicationFrequency.SpecificDays, Days: Weekdays.Tuesday | Weekdays.Friday),
        new("dylan-ibuprofen", "dylan", "Ibuprofen", "200mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (200mg)",
            "With food. At least six hours between doses.", MedicationType.Prn, null,
            "Muscle and joint pain.", DrugSchedule.Unscheduled, MedicationSupportLevel.Assist,
            "Dr. Wendy Cho", "Newtown Community Pharmacy", PackagingType.OriginalPackaging, -70, 40,
            PrnMaxPer24h: 3, PrnMinIntervalMinutes: 360, PrnIndication: "Muscle or joint pain"),
        new("olivia-melatonin", "olivia", "Melatonin", "2mg", MedicationForm.Tablet, MedicationRoute.Oral, "1 tablet (2mg)",
            "Evening, an hour before bed.", MedicationType.Regular, "20:00",
            "Settling at night.", DrugSchedule.Schedule3, MedicationSupportLevel.Assist,
            "Dr. Amina Yusuf", "Box Hill Amcal Pharmacy", PackagingType.OriginalPackaging, -100, 14, MedicationStatus.OnHold,
            Notes: "On hold while the sleep review is booked. Do not give until the prescriber says to restart.", ChangedOffset: -10),
        new("mia-fluoxetine", "mia", "Fluoxetine", "20mg", MedicationForm.Capsule, MedicationRoute.Oral, "1 capsule (20mg)",
            "Each morning with breakfast.", MedicationType.Regular, "08:00",
            "Previously prescribed for low mood.", DrugSchedule.Schedule4, MedicationSupportLevel.PromptOnly,
            "Dr. Wendy Cho", "Sunnybank Community Pharmacy", PackagingType.WebsterPack, -200, null, MedicationStatus.Ceased,
            Psychotropic: true, EndOffset: -20, Notes: "Ceased by the prescriber; replaced by sertraline.", ChangedOffset: -20),
    };

    public static Guid IdOf(string key) => DemoIds.For("medication", key);

    /// <summary>
    /// The day of the first run, read back from the rows that remember it: each of the nine new medications was started on that day plus its own
    /// offset, so the first run's D0 is any of them less its offset. Null when none of the nine is on the chart (nothing then needs the anchor).
    /// </summary>
    public static DateOnly? FirstRunDay(IEnumerable<ParticipantMedication> chart)
    {
        foreach (var medication in chart)
        {
            var spec = New.FirstOrDefault(s => IdOf(s.Key) == medication.Id);
            if (spec is not null) return DateOnly.FromDateTime(medication.StartDate).AddDays(-spec.StartOffset);
        }
        return null;
    }
}
