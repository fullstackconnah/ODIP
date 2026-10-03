using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Services;

namespace Odip.Tests.DemoData;

/// <summary>
/// The Demo tenant's people as the old seed (DbSeeder.cs) creates them, minimally: the eleven users with their real ids, emails, roles and
/// credential flags, and the seventeen participants the stories use with the NDIS numbers and the support-need flags the roster checks read
/// (wheelchair, hoist, high support, overnight). Pack tests use this because it is fast and does not shift when somebody else edits the
/// big seed. The tests that must hold against the REAL seed (the old-seed database, T3, and the board codes) run DbSeeder itself.
///
/// It also holds the six of the old seed's fifteen medications the stories use (fixed ids, schedules and flags as in DbSeeder.SeedMedicationsAsync),
/// because the top-up writes no medication unless the old seed's register is already there (plan 4.5).
/// </summary>
internal static class DemoFixture
{
    private sealed record StaffRow(string Key, string Id, string First, string Last, UserRole Role, bool Driver, bool FirstAid, bool Medication, bool ManualHandling, bool Overnight);

    // Same ids, emails and flags as DbSeeder.cs lines 64-80 and 270-274.
    private static readonly StaffRow[] Staff =
    {
        new("sarah", "b1000000-0000-0000-0000-000000000002", "Sarah", "Mitchell", UserRole.Coordinator, true, true, true, true, true),
        new("james", "b1000000-0000-0000-0000-000000000003", "James", "O'Brien", UserRole.SupportWorker, true, true, true, true, true),
        new("emily", "b2000000-0000-0000-0000-000000000002", "Emily", "Nguyen", UserRole.SupportWorker, true, true, false, true, true),
        new("daniel", "b2000000-0000-0000-0000-000000000003", "Daniel", "Williams", UserRole.SupportWorker, false, true, true, false, false),
        new("rachel", "b2000000-0000-0000-0000-000000000001", "Rachel", "Thompson", UserRole.Coordinator, true, true, true, true, true),
        new("marcus", "a2000000-0000-0000-0000-000000000001", "Marcus", "Papadopoulos", UserRole.SupportWorker, true, true, true, true, true),
        new("priya", "a2000000-0000-0000-0000-000000000002", "Priya", "Sharma", UserRole.SupportWorker, false, true, true, true, true),
        new("lachlan", "a2000000-0000-0000-0000-000000000003", "Lachlan", "Robertson", UserRole.SupportWorker, true, false, false, true, false),
        new("jade", "a2000000-0000-0000-0000-000000000004", "Jade", "Watkins", UserRole.SupportWorker, true, true, true, true, true),
        new("brendan", "a2000000-0000-0000-0000-000000000005", "Brendan", "Nguyen", UserRole.SupportWorker, true, true, true, true, true),
    };

    private sealed record ParticipantRow(string Key, string Id, string First, string Last, bool High = false, OvernightSupportType Overnight = OvernightSupportType.None,
        bool Wheelchair = false, bool Hoist = false);

    private static readonly ParticipantRow[] Participants =
    {
        new("liam", "d1000000-0000-0000-0000-000000000001", "Liam", "Johnson", Wheelchair: true),
        new("sophie", "d1000000-0000-0000-0000-000000000002", "Sophie", "Brown", High: true, Overnight: OvernightSupportType.ActiveNight),
        new("noah", "d1000000-0000-0000-0000-000000000003", "Noah", "Taylor"),
        new("olivia", "d1000000-0000-0000-0000-000000000004", "Olivia", "Wilson", High: true, Overnight: OvernightSupportType.Sleepover, Wheelchair: true, Hoist: true),
        new("ethan", "d1000000-0000-0000-0000-000000000005", "Ethan", "Davis"),
        new("mia", "d1000000-0000-0000-0000-000000000006", "Mia", "Anderson"),
        new("jack", "d1000000-0000-0000-0000-000000000007", "Jack", "Thomas", Wheelchair: true),
        new("charlotte", "d1000000-0000-0000-0000-000000000008", "Charlotte", "White", High: true, Overnight: OvernightSupportType.PassiveNight),
        new("william", "d1000000-0000-0000-0000-000000000009", "William", "Martin"),
        new("isabella", "d2000000-0000-0000-0000-000000000001", "Isabella", "Clarke"),
        new("mason", "d2000000-0000-0000-0000-000000000002", "Mason", "Nguyen", Wheelchair: true),
        new("chloe", "d2000000-0000-0000-0000-000000000003", "Chloe", "Robinson", High: true, Overnight: OvernightSupportType.Sleepover),
        new("thomas", "d2000000-0000-0000-0000-000000000004", "Thomas", "Patel"),
        new("grace", "d2000000-0000-0000-0000-000000000005", "Grace", "O'Sullivan"),
        new("harrison", "d2000000-0000-0000-0000-000000000006", "Harrison", "Lee", High: true, Overnight: OvernightSupportType.SleepoverSupport, Wheelchair: true),
        new("ryan", "d2000000-0000-0000-0000-000000000008", "Ryan", "Murphy", High: true, Overnight: OvernightSupportType.ActiveNight),
        new("dylan", "d2000000-0000-0000-0000-000000000010", "Dylan", "Foster", Wheelchair: true),
    };

    public static Guid StaffId(string key) => Guid.Parse(Staff.Single(s => s.Key == key).Id);

    public static Guid ParticipantId(string key) => Guid.Parse(Participants.Single(p => p.Key == key).Id);

    /// <summary>
    /// Adds the Demo tenant (if it is not there yet), the eleven users and the seventeen participants, and (unless told not to) the old seed's
    /// rows the stories rest on: six medications, Sophie's two routines, and one aged shift with one of the old seed's shift notes. A database
    /// the old seed has not touched has none of them, which is what the "first row of a guarded table" tests need.
    /// </summary>
    public static async Task SeedPeopleAsync(DemoTestEnv env, bool oldSeed = true)
    {
        await using var probe = env.AdminDb();
        if (!await probe.Tenants.AnyAsync(t => t.Id == DemoTestEnv.DemoTenantId)) await env.AddTenantAsync();

        await using var db = env.AdminDb();
        foreach (var s in Staff)
        {
            var email = DemoPeople.StaffEmails[s.Key];
            db.Users.Add(new User
            {
                Id = Guid.Parse(s.Id), TenantId = DemoTestEnv.DemoTenantId, Username = email[..email.IndexOf('@')], Email = email, FirstName = s.First, LastName = s.Last,
                Role = s.Role, Position = Position.SupportWorker, IsDriverEligible = s.Driver, IsFirstAidQualified = s.FirstAid, IsMedicationCompetent = s.Medication,
                IsManualHandlingCompetent = s.ManualHandling, IsOvernightEligible = s.Overnight,
            });
        }
        db.Users.Add(new User
        {
            Id = Guid.Parse("b2000000-0000-0000-0000-000000000004"), TenantId = DemoTestEnv.DemoTenantId, Username = "coordinator.read", Email = "readonly@demo.odip.com.au",
            FirstName = "Read", LastName = "Only", Role = UserRole.ReadOnly,
        });
        foreach (var p in Participants)
        {
            db.Participants.Add(new Participant
            {
                Id = Guid.Parse(p.Id), TenantId = DemoTestEnv.DemoTenantId, FirstName = p.First, LastName = p.Last, NdisNumber = DemoPeople.ParticipantNdisNumbers[p.Key],
                IsActive = true, IsHighSupport = p.High, OvernightSupport = p.Overnight, MobilityAidWheelchair = p.Wheelchair, RequiresHoist = p.Hoist,
            });
        }
        if (oldSeed)
        {
            foreach (var m in OldSeedMedications()) db.ParticipantMedications.Add(m);
            foreach (var r in OldSeedRoutines()) db.ParticipantRoutines.Add(r);
            // A finished, approved shift from before the top-up began: stands in for the old seed's aged shifts, as a closed-out shift like any other.
            var oldShift = new Shift
            {
                Id = OldShiftId, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = ParticipantId("sophie"), UserId = StaffId("james"),
                ServiceDate = new DateOnly(2026, 8, 20), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Completed,
                CreatedAt = new DateTime(2026, 8, 10, 0, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 8, 24, 0, 0, 0, DateTimeKind.Utc),
            };
            db.Shifts.Add(oldShift);
            var oldCompletion = new ShiftCompletion
            {
                Id = OldCompletionId, TenantId = DemoTestEnv.DemoTenantId, ShiftId = oldShift.Id, SubmittedByUserId = StaffId("james"),
                ReviewedByUserId = StaffId("sarah"), ReviewOutcome = ReviewOutcome.Approved, VarianceMinutesStart = 0, VarianceMinutesEnd = 5,
                NothingToHandOver = true, NothingToNoteConfirmed = false, IsActive = true,
            };
            PlaceOldCompletion(oldCompletion, ProviderTimeZoneResolver.FromState(null));          // no provider settings yet: the resolver's Sydney default
            db.ShiftCompletions.Add(oldCompletion);
            db.ShiftNotes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000001"), TenantId = DemoTestEnv.DemoTenantId, ShiftId = oldShift.Id, AuthorUserId = StaffId("james"),
                AuthorName = "James O'Brien", Body = "A calm morning. Sophie enjoyed the garden.",
                CreatedAt = new DateTime(2026, 8, 20, 1, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 8, 20, 1, 0, 0, DateTimeKind.Utc),
            });
        }
        await db.SaveChangesAsync();
    }

    public static readonly Guid OldShiftId = DemoIds.For("fixture", "old-shift");
    public static readonly Guid OldCompletionId = DemoIds.For("fixture", "old-completion");

    /// <summary>
    /// Puts the aged completion where a closed-out 09:00-13:00 shift's would be in the given zone: started at 09:00, finished at 13:05 (five minutes
    /// over), submitted at 13:10 and reviewed the next morning, every instant the conversion of a local wall-clock time. A test that changes the
    /// provider's state afterwards calls this again (DemoTestEnv.SetProviderStateAsync does), so the row is consistent in every zone.
    /// </summary>
    internal static void PlaceOldCompletion(ShiftCompletion completion, ProviderTimeZone provider)
    {
        DateTime At(int day, int hour, int minute) =>
            ProviderLocalTime.LocalToUtc(new DateTime(2026, 8, day, hour, minute, 0, DateTimeKind.Unspecified), provider.Zone);

        completion.TimeZoneId = provider.Id;
        completion.StartedAt = completion.ActualStart = At(20, 9, 0);
        completion.ActualEnd = At(20, 13, 5);
        completion.SubmittedAt = completion.CreatedAt = At(20, 13, 10);
        completion.ReviewedAt = completion.UpdatedAt = At(21, 10, 0);
    }

    /// <summary>The two routines the old seed gives Sophie (DbSeeder.cs, 74..01 and 74..02): the live set ticks the morning one.</summary>
    private static IEnumerable<ParticipantRoutine> OldSeedRoutines()
    {
        yield return new ParticipantRoutine
        {
            Id = Guid.Parse("74000000-0000-0000-0000-000000000001"), TenantId = DemoTestEnv.DemoTenantId, ParticipantId = ParticipantId("sophie"),
            Title = "Epilepsy medication window", Description = "Keppra 500mg BD: within 30 minutes of the scheduled time.", Category = RoutineCategory.Medication,
            Days = ParticipantRoutineDays.All, IsCritical = true, IsActive = true,
        };
        yield return new ParticipantRoutine
        {
            Id = Guid.Parse("74000000-0000-0000-0000-000000000002"), TenantId = DemoTestEnv.DemoTenantId, ParticipantId = ParticipantId("sophie"),
            Title = "Morning routine", Description = "Wake gently. Offer a warm drink before getting up.", Category = RoutineCategory.PersonalCare,
            Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(8, 0), IsCritical = false, IsActive = true,
        };
    }

    private static IEnumerable<ParticipantMedication> OldSeedMedications()
    {
        ParticipantMedication Med(Guid id, string participant, string name, string strength, string dose, MedicationType type, string? times,
            MedicationForm form = MedicationForm.Tablet, MedicationRoute route = MedicationRoute.Oral, bool highRisk = false, int? prnMax = null,
            int? prnInterval = null) => new()
        {
            Id = id, TenantId = DemoTestEnv.DemoTenantId, ParticipantId = ParticipantId(participant), Name = name, Strength = strength, Form = form, Route = route,
            DoseDescription = dose, Type = type, TimesOfDay = times, PrnIndication = type == MedicationType.Prn ? "Mild-moderate pain or fever" : null,
            PrnMaxDosesPer24h = prnMax, PrnMinIntervalMinutes = prnInterval, IsHighRisk = highRisk, IsHighIntensitySupport = highRisk,
            SupportLevel = MedicationSupportLevel.Administer, StartDate = new DateTime(2026, 2, 1), Status = MedicationStatus.Active,
        };

        yield return Med(MedicationCatalog.Levetiracetam, "sophie", "Levetiracetam", "500mg", "1 tablet (500mg)", MedicationType.Regular, "08:00,20:00");
        yield return Med(MedicationCatalog.Paracetamol, "sophie", "Paracetamol", "500mg", "2 tablets (1000mg)", MedicationType.Prn, null, prnMax: 4, prnInterval: 240);
        yield return Med(MedicationCatalog.CharlotteSertraline, "charlotte", "Sertraline", "50mg", "1 tablet (50mg)", MedicationType.Regular, "08:00");
        yield return Med(MedicationCatalog.InsulinGlargine, "harrison", "Insulin Glargine", "100units/mL", "18 units subcutaneously", MedicationType.Regular, "08:00",
            MedicationForm.Injection, MedicationRoute.Subcutaneous, highRisk: true);
        yield return Med(MedicationCatalog.Movicol, "olivia", "Movicol (Macrogol)", "13.7g/sachet", "1 sachet", MedicationType.Regular, "08:00",
            MedicationForm.Powder, MedicationRoute.Enteral);
        yield return Med(MedicationCatalog.MiaSertraline, "mia", "Sertraline", "50mg", "1 tablet (50mg)", MedicationType.Regular, "08:00");
    }
}
