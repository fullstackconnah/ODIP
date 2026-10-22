using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Data;

public enum DemoFixtureStatus { Seeded, NoDemoTenant, Rejected }

/// <param name="Added">Rows added (or, on a dry run, that would be added) by table name. Empty unless <see cref="DemoFixtureStatus.Seeded"/>.</param>
public sealed record DemoFixtureResult(DemoFixtureStatus Status, string? Detail, IReadOnlyDictionary<string, int> Added)
{
    public int Total => Added.Values.Sum();
}

/// <summary>
/// One-off, additive demo fixtures for the Demo tenant: an unsigned version-1 agreement draft for every active finalised participant that has no
/// draft, plus enquiry / intake / onboarding examples, and OnHold medications, routines, plain notes and inactive restrictive-practice examples on
/// four existing synthetic participants. It is deliberately NOT registered on startup or as a demo pack: a root-run operator invokes it
/// (<c>Odip.Api --seed-demo-participant-fixtures [--dry-run]</c>), and running it on a live database needs the owner's separate go.
///
/// Safety rules, each tested: exactly one active Demo tenant (Name "Demo", lowercase EmailDomain) or nothing is written; every query and row carries
/// that TenantId; fixture ids are <see cref="DemoIds"/> ids, a fixture id that another tenant already owns REJECTS the whole run (nothing is
/// reassigned), one that the Demo tenant already owns is skipped (a rerun adds nothing, manual rows are never touched); the whole batch is one
/// transaction. No approval, signing, roster, outbox or notification row is ever written, and nothing here sends email.
/// </summary>
public sealed class DemoParticipantFixtureSeeder
{
    public const string ActorLabel = "Synthetic demo fixture seeder";
    public const string FallbackActorLabel = "Synthetic demo fixture seeder (provisional dates or location)";
    public const string DemoLabel = "Demo fixture (synthetic)";

    /// <summary>Who gets medications, routines, notes and a restrictive-practice example: existing fictional Demo people, by NDIS number (DemoPeople).</summary>
    public static readonly string[] HostKeys = { "liam", "sophie", "noah", "olivia" };

    private static readonly string[] States = { "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA" };

    private readonly TimeProvider _clock;

    public DemoParticipantFixtureSeeder(TimeProvider? clock = null) => _clock = clock ?? TimeProvider.System;

    public static Guid IdOf(string kind, params object[] key) => DemoIds.For("fixture-" + kind, key);

    public async Task<DemoFixtureResult> RunAsync(DbContextOptions<OdipDbContext> options, bool dryRun, CancellationToken ct)
    {
        // 1. Exactly one active Demo tenant; the lookup context has no tenant of its own, so it sees only the unfiltered Tenants table.
        await using var lookup = new OdipDbContext(options, new ScopedTenantOverride());
        var demo = (await lookup.Tenants.AsNoTracking().Where(t => t.Name == DemoPeople.TenantName).ToListAsync(ct))
            .Where(t => t.IsActive && string.Equals(t.EmailDomain, DemoPeople.TenantEmailDomain, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (demo.Count != 1)
            return new(DemoFixtureStatus.NoDemoTenant, $"Needs exactly one active tenant named {DemoPeople.TenantName} on {DemoPeople.TenantEmailDomain}; found {demo.Count}. Nothing written.", new Dictionary<string, int>());
        var tenantId = demo[0].Id;

        await using var db = new OdipDbContext(options, new ScopedTenantOverride { TenantId = tenantId, IsSuperAdmin = false });
        var now = _clock.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(now);

        var hosts = await HostsAsync(db, tenantId, ct);
        var inquiries = Inquiries(tenantId, now);
        var participants = Participants(tenantId, now);
        var (meds, routines, notes, practices) = HostRows(tenantId, hosts, now, today);

        // 2. Reject on a fixture id another tenant owns, skip ids the Demo tenant already owns. Nothing has been written yet.
        string? rejected = null;
        var toAdd = new Dictionary<string, int>();
        async Task<List<T>> Fresh<T>(List<T> rows, Func<T, Guid> id, Func<T, Guid> owner) where T : class
        {
            var ids = rows.Select(id).ToList();
            var existing = (await db.Set<T>().IgnoreQueryFilters().Where(e => ids.Contains(EF.Property<Guid>(e, "Id")))
                .Select(e => new { Id = EF.Property<Guid>(e, "Id"), Tenant = EF.Property<Guid>(e, "TenantId") }).ToListAsync(ct)).ToDictionary(e => e.Id, e => e.Tenant);
            var foreign = existing.Where(e => e.Value != tenantId).Select(e => e.Key).ToList();
            if (foreign.Count > 0) rejected ??= $"{typeof(T).Name} id {foreign[0]} is owned by another tenant; a fixture never reassigns an owner.";
            var fresh = rows.Where(r => !existing.ContainsKey(id(r))).ToList();
            toAdd[typeof(T).Name] = fresh.Count;
            return fresh;
        }
        var newInquiries = await Fresh(inquiries, x => x.Id, x => x.TenantId);
        var newParticipants = await Fresh(participants, x => x.Id, x => x.TenantId);
        var newMeds = await Fresh(meds, x => x.Id, x => x.TenantId);
        var newRoutines = await Fresh(routines, x => x.Id, x => x.TenantId);
        var newNotes = await Fresh(notes, x => x.Id, x => x.TenantId);
        var newPractices = await Fresh(practices, x => x.Id, x => x.TenantId);
        if (rejected is not null) return new(DemoFixtureStatus.Rejected, rejected, new Dictionary<string, int>());

        // 3. One transaction for the whole batch: any failure below rolls everything back.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        db.ParticipantInquiries.AddRange(newInquiries);
        db.Participants.AddRange(newParticipants);
        db.ParticipantMedications.AddRange(newMeds);
        db.ParticipantRoutines.AddRange(newRoutines);
        db.ParticipantNotes.AddRange(newNotes);
        db.RestrictivePractices.AddRange(newPractices);
        await db.SaveChangesAsync(ct);

        // 4. An agreement draft for every active finalised participant with none: the same service the screen uses, so the lines are priced from the
        // catalogue and carry its provenance. A participant who already has any revision (manual or not) is left alone.
        var drafts = 0;
        var eligible = await db.Participants.Where(p => p.TenantId == tenantId && p.IsActive && !p.IsDraft
                && !db.ServiceAgreementDrafts.Any(d => d.TenantId == tenantId && d.ParticipantId == p.Id))
            .OrderBy(p => p.Id).ToListAsync(ct);
        var service = new ServiceAgreementDraftService(db, null, _clock);
        foreach (var p in eligible)
        {
            var (request, provisional) = AgreementRequest(p, today);
            var saved = await service.SaveAsync(tenantId, p.Id, request, provisional ? FallbackActorLabel : ActorLabel, ct);
            if (saved.Draft is null)
                throw new InvalidOperationException($"The agreement draft for participant {p.Id} was refused: {string.Join(" ", saved.Errors)}");
            drafts++;
        }
        toAdd[nameof(ServiceAgreementDraft)] = drafts;

        if (dryRun) await tx.RollbackAsync(ct);
        else await tx.CommitAsync(ct);
        return new(DemoFixtureStatus.Seeded, dryRun ? "Dry run: everything was rolled back." : null, toAdd);
    }

    // Plan dates and state come from the participant when they are usable; otherwise a labelled provisional year from today in QLD, for the new draft only.
    private static (CreateServiceAgreementDraftDto Request, bool Provisional) AgreementRequest(Participant p, DateOnly today)
    {
        var datesOk = p.PlanStartDate is { } s && p.PlanEndDate is { } e && e >= s && e.DayNumber - s.DayNumber + 1 <= PlanPricingEngine.MaxPeriodDays;
        var stateOk = p.AddressState is { } st && States.Contains(st.Trim().ToUpperInvariant());
        var start = datesOk ? p.PlanStartDate!.Value : today;
        var end = datesOk ? p.PlanEndDate!.Value : today.AddDays(364);
        var state = stateOk ? p.AddressState!.Trim().ToUpperInvariant() : "QLD";
        var block = new PlanBlock
        {
            Id = "demo-community-access", SupportType = PlanSupportType.CommunityAccess,
            Days = new[] { DayOfWeek.Monday, DayOfWeek.Thursday }, Start = new TimeOnly(10, 0), End = new TimeOnly(13, 0),
            Location = new PlanLocation { State = state },
        };
        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = start, PlanEndDate = end, AgreementStartDate = start, AgreementEndDate = end, State = state,
            Blocks = new List<DraftBlockDto> { new() { Block = block } },
        };
        return (request, !datesOk || !stateOk);
    }

    private static async Task<Dictionary<string, Guid>> HostsAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var numbers = HostKeys.ToDictionary(k => DemoPeople.ParticipantNdisNumbers[k], k => k);
        var rows = await db.Participants.Where(p => p.TenantId == tenantId && p.IsActive && !p.IsDraft && p.NdisNumber != null && numbers.Keys.Contains(p.NdisNumber))
            .Select(p => new { p.Id, p.NdisNumber }).ToListAsync(ct);
        return rows.ToDictionary(r => numbers[r.NdisNumber!], r => r.Id);
    }

    private static List<ParticipantInquiry> Inquiries(Guid tenantId, DateTime now) => new()
    {
        new()
        {
            Id = IdOf("inquiry", "first-contact"), TenantId = tenantId, FirstName = "Casey", Source = "Phone", Phone = "0400 000 001", Email = "casey.contact@example.invalid",
            Provenance = $"{DemoLabel}: first phone contact, name only.", CreatedAt = now.AddDays(-2), UpdatedAt = now.AddDays(-2),
        },
        new()
        {
            Id = IdOf("inquiry", "ready-for-intake"), TenantId = tenantId, FirstName = "Riley", LastName = "Example", Source = "Web", Phone = "0400 000 002",
            Email = "riley.example@example.invalid", ContactIsParticipant = true, DateOfBirth = new DateOnly(1990, 6, 1), PlanType = PlanType.PlanManaged,
            AddressStreet = "1 Example Street", AddressSuburb = "Exampleville", AddressState = "QLD", AddressPostcode = "4000",
            Provenance = $"{DemoLabel}: fuller web enquiry, ready to begin intake.", CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1),
        },
    };

    private static List<Participant> Participants(Guid tenantId, DateTime now) => new()
    {
        // Direct intake: a draft with no intake completed and no enquiry behind it.
        new()
        {
            Id = IdOf("participant", "direct-intake"), TenantId = tenantId, FirstName = "Jordan", LastName = "Intake-Example", IsDraft = true, IsActive = false,
            Email = "jordan.intake@example.invalid", Notes = $"{DemoLabel}: direct-intake draft.",
        },
        // Onboarding: intake finished, still a draft, services not started.
        new()
        {
            Id = IdOf("participant", "onboarding-awaiting-detail"), TenantId = tenantId, FirstName = "Sam", LastName = "Onboarding-Example", IsDraft = true, IsActive = false,
            IntakeCompletedAt = now.AddDays(-3), Email = "sam.onboarding@example.invalid", Notes = $"{DemoLabel}: onboarding, awaiting profile and service detail.",
        },
        new()
        {
            Id = IdOf("participant", "onboarding-agreement-outstanding"), TenantId = tenantId, FirstName = "Morgan", LastName = "Onboarding-Example", IsDraft = true, IsActive = false,
            IntakeCompletedAt = now.AddDays(-6), DateOfBirth = new DateOnly(1985, 3, 9), PlanType = PlanType.AgencyManaged, Email = "morgan.onboarding@example.invalid",
            AddressStreet = "2 Example Street", AddressSuburb = "Exampleville", AddressState = "QLD", AddressPostcode = "4000",
            Notes = $"{DemoLabel}: onboarding, details recorded, agreement not yet signed.",
        },
    };

    private static (List<ParticipantMedication>, List<ParticipantRoutine>, List<ParticipantNote>, List<RestrictivePractice>) HostRows(
        Guid tenantId, Dictionary<string, Guid> hosts, DateTime now, DateOnly today)
    {
        var meds = new List<ParticipantMedication>();
        var routines = new List<ParticipantRoutine>();
        var notes = new List<ParticipantNote>();
        var practices = new List<RestrictivePractice>();

        ParticipantMedication Med(string host, string key, string name, string strength, MedicationForm form, MedicationRoute route, MedicationType type, Action<ParticipantMedication> schedule)
        {
            var m = new ParticipantMedication
            {
                Id = IdOf("medication", host, key), TenantId = tenantId, ParticipantId = hosts[host], Name = name, Strength = strength, Form = form, Route = route,
                DoseDescription = $"1 dose ({strength}), example only", Type = type, DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.PromptOnly,
                Status = MedicationStatus.OnHold, StartDate = now, Notes = $"{DemoLabel}: on hold. No prescriber, consent or administration is recorded.",
                CreatedAt = now, UpdatedAt = now,
            };
            schedule(m);
            return m;
        }
        void Prn(ParticipantMedication m, string indication) { m.PrnIndication = indication; m.PrnMaxDosesPer24h = 3; m.PrnMinIntervalMinutes = 240; }

        foreach (var host in HostKeys.Where(hosts.ContainsKey))
        {
            switch (host)
            {
                case "liam":
                    meds.Add(Med(host, "regular", "Vitamin C (demo)", "500mg", MedicationForm.Tablet, MedicationRoute.Oral, MedicationType.Regular, m => m.TimesOfDay = "09:00"));
                    meds.Add(Med(host, "prn", "Paracetamol (demo)", "500mg", MedicationForm.Tablet, MedicationRoute.Oral, MedicationType.Prn, m => Prn(m, "Mild headache (example)")));
                    break;
                case "sophie":
                    meds.Add(Med(host, "regular", "Fibre powder (demo)", "5g", MedicationForm.Powder, MedicationRoute.Oral, MedicationType.Regular,
                        m => { m.TimesOfDay = "08:00"; m.Frequency = MedicationFrequency.SpecificDays; m.DaysOfWeek = Weekdays.Monday | Weekdays.Wednesday | Weekdays.Friday; }));
                    meds.Add(Med(host, "prn", "Throat lozenge (demo)", "1 lozenge", MedicationForm.Other, MedicationRoute.Oral, MedicationType.Prn, m => Prn(m, "Sore throat (example)")));
                    break;
                case "noah":
                    meds.Add(Med(host, "regular", "Weekly vitamin D (demo)", "50000IU", MedicationForm.Capsule, MedicationRoute.Oral, MedicationType.Regular,
                        m => { m.TimesOfDay = "09:00"; m.Frequency = MedicationFrequency.EveryNDays; m.IntervalDays = 7; m.AnchorDate = today; }));
                    meds.Add(Med(host, "prn", "Antacid (demo)", "500mg", MedicationForm.Tablet, MedicationRoute.Oral, MedicationType.Prn, m => Prn(m, "Heartburn (example)")));
                    break;
                default:
                    meds.Add(Med(host, "regular", "Barrier cream (demo)", "10%", MedicationForm.Cream, MedicationRoute.Topical, MedicationType.Regular, m => m.TimesOfDay = "08:00,20:00"));
                    meds.Add(Med(host, "prn", "Saline eye drops (demo)", "0.9%", MedicationForm.Drops, MedicationRoute.Ocular, MedicationType.Prn, m => Prn(m, "Dry eyes (example)")));
                    break;
            }

            routines.Add(new()
            {
                Id = IdOf("routine", host, "daily"), TenantId = tenantId, ParticipantId = hosts[host], Title = "Morning cup of tea (demo)", Category = RoutineCategory.Meals,
                Description = $"{DemoLabel}: likes a warm drink to start the day. A preference, not an instruction.", Days = ParticipantRoutineDays.All, CreatedAt = now, UpdatedAt = now,
            });
            routines.Add(new()
            {
                Id = IdOf("routine", host, "weekday"), TenantId = tenantId, ParticipantId = hosts[host], Title = "Afternoon walk (demo)", Category = RoutineCategory.Activity,
                Description = $"{DemoLabel}: a short walk when the weather is fine.",
                Days = ParticipantRoutineDays.Monday | ParticipantRoutineDays.Tuesday | ParticipantRoutineDays.Wednesday | ParticipantRoutineDays.Thursday | ParticipantRoutineDays.Friday,
                StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(15, 30), CreatedAt = now, UpdatedAt = now,
            });

            ParticipantNote Note(string key, string title, bool pinned = false, bool archived = false) => new()
            {
                Id = IdOf("note", host, key), TenantId = tenantId, ParticipantId = hosts[host], Title = title, IsPinned = pinned, IsArchived = archived, SourceKey = null,
                Description = $"{DemoLabel}: a made-up, non-clinical observation about preferences and routine.", CreatedByName = ActorLabel, CreatedAt = now, UpdatedAt = now,
            };
            notes.Add(Note("pinned", "Likes quiet starts (demo)", pinned: true));
            notes.Add(Note("ordinary", "Enjoyed the garden visit (demo)"));
            // Two hosts carry an archived note instead of a second ordinary one: 4 pinned, 6 ordinary, 2 archived overall.
            notes.Add(host is "sophie" or "olivia" ? Note("archived", "Old outing idea (demo)", archived: true) : Note("ordinary-2", "Prefers the blue cup (demo)"));

            practices.Add(new()
            {
                Id = IdOf("practice", host), TenantId = tenantId, ParticipantId = hosts[host], Type = host is "liam" or "noah" ? RestrictivePracticeType.EnvironmentalRestraint : RestrictivePracticeType.Unclassified,
                Description = $"{DemoLabel}: inactive register example. No authorisation or review is recorded and no practice is in use.", IsActive = false, RelatedMedicationId = null,
                CreatedAt = now, UpdatedAt = now,
            });
        }
        return (meds, routines, notes, practices);
    }
}
