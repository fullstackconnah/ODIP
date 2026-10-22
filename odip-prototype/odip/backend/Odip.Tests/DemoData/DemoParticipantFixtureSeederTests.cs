using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.Notifications;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The additive Demo participant fixtures against a real PostgreSQL built from the real migrations and the old startup seed (the PostgreSQL facts skip
/// where POSTGRES_CONNECTION_STRING is unset, so a skip proves nothing: the runner's dotnet target provides a server). Each fact is red against a seeder
/// that writes nothing, or is a negative control for the green path of another fact.
/// </summary>
public sealed class DemoParticipantFixtureSeederTests : IClassFixture<DemoDataPostgresFixture>
{
    private static readonly Guid DemoTenant = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    // Tables the seeder may add to: nothing else (no approval, signing, roster, outbox or notification row) may appear in a run's diff.
    private static readonly HashSet<string> AllowedAdds = new()
    {
        nameof(ParticipantInquiry), nameof(Participant), nameof(ParticipantMedication), nameof(ParticipantRoutine), nameof(ParticipantNote),
        nameof(RestrictivePractice), nameof(ServiceAgreementDraft), nameof(ServiceAgreementDraftBlock), nameof(ServiceAgreementDraftLine), nameof(AuditLog),
    };

    private readonly DemoDataPostgresFixture _pg;

    public DemoParticipantFixtureSeederTests(DemoDataPostgresFixture pg) => _pg = pg;

    private void Require() => Skip.IfNot(_pg.Available, _pg.UnavailableReason);

    private sealed class Env
    {
        public DbContextOptions<OdipDbContext> Options { get; }

        public Env(string connectionString, params IInterceptor[] extra) =>
            Options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(connectionString)
                .AddInterceptors(new IInterceptor[] { new AuditInterceptor(new HttpContextAccessor()) }.Concat(extra).ToArray()).Options;

        public OdipDbContext Admin() => new(Options, DemoDataPostgresFixture.SuperAdmin());

        public OdipDbContext AsDemo() => new(Options, new ScopedTenantOverride { TenantId = DemoTenant });

        public Task<DemoFixtureResult> RunAsync(bool dryRun = false) => new DemoParticipantFixtureSeeder().RunAsync(Options, dryRun, CancellationToken.None);

        public async Task<DemoSnapshot> SnapshotAsync()
        {
            await using var db = Admin();
            return DemoSnapshot.Take(db);
        }
    }

    private async Task<Env> SeededAsync()
    {
        Require();
        var env = new Env(await _pg.NewDatabaseAsync());
        await using var db = env.Admin();
        await DemoOldSeedTests.RunOldSeedAsync(db);
        return env;
    }

    private static string TypeOf(DemoSnapshot.Change c) => DemoSnapshot.TypeOf(c.Key);

    private static List<Guid> FixtureIds(params string[] kinds) => kinds.Select(k => DemoParticipantFixtureSeeder.IdOf(k)).ToList();

    // ── 1. Counts and complete agreement coverage on a fresh database ────────────────────────────

    [SkippableFact]
    public async Task Postgres_AFreshDatabase_GainsExactlyTheFixtures_AndEveryActiveFinalisedParticipantHasAnUnsignedVersionOneDraft()
    {
        var env = await SeededAsync();
        await using var before = env.Admin();
        var eligible = await before.Participants.Where(p => p.TenantId == DemoTenant && p.IsActive && !p.IsDraft).Select(p => p.Id).ToListAsync();
        var alreadyCovered = await before.ServiceAgreementDrafts.Where(d => d.TenantId == DemoTenant).Select(d => d.ParticipantId).Distinct().ToListAsync();
        var counts = new[]
        {
            await before.ParticipantInquiries.CountAsync(), await before.Participants.CountAsync(), await before.ParticipantMedications.CountAsync(),
            await before.ParticipantRoutines.CountAsync(), await before.ParticipantNotes.CountAsync(), await before.RestrictivePractices.CountAsync(),
        };
        var snapshotBefore = await env.SnapshotAsync();
        Assert.NotEmpty(eligible);

        var result = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.Seeded, result.Status);
        await using var db = env.Admin();
        Assert.Equal(counts[0] + 2, await db.ParticipantInquiries.CountAsync());
        Assert.Equal(counts[1] + 3, await db.Participants.CountAsync());
        Assert.Equal(counts[2] + 8, await db.ParticipantMedications.CountAsync());
        Assert.Equal(counts[3] + 8, await db.ParticipantRoutines.CountAsync());
        Assert.Equal(counts[4] + 12, await db.ParticipantNotes.CountAsync());
        Assert.Equal(counts[5] + 4, await db.RestrictivePractices.CountAsync());

        // Complete coverage: every eligible participant has a draft; those that had none got exactly one, version 1, with provenance from the catalogue.
        var drafts = await db.ServiceAgreementDrafts.Include(d => d.Blocks).Include(d => d.Lines).Where(d => d.TenantId == DemoTenant).ToListAsync();
        Assert.All(eligible, id => Assert.Contains(drafts, d => d.ParticipantId == id));
        var added = eligible.Except(alreadyCovered).ToList();
        Assert.NotEmpty(added);
        Assert.Equal(added.Count, result.Added["ServiceAgreementDraft"]);
        var catalogue = await db.SupportCatalogueItems.Select(i => new { i.ItemNumber, i.CatalogueVersion }).ToListAsync();
        foreach (var id in added)
        {
            var draft = Assert.Single(drafts, d => d.ParticipantId == id);
            Assert.Equal(1, draft.Version);
            Assert.StartsWith(DemoParticipantFixtureSeeder.ActorLabel, draft.CreatedBy);
            Assert.True(draft.PlanStartDate <= draft.PlanEndDate && draft.AgreementStartDate <= draft.AgreementEndDate);
            Assert.Single(draft.Blocks);
            Assert.NotNull(draft.PricingJson);
            Assert.NotEmpty(draft.Lines);   // priced by the catalogue service, never hand-typed
            Assert.All(draft.Lines, l => Assert.Contains(catalogue, c => c.ItemNumber == l.ItemCode && c.CatalogueVersion == l.CatalogueVersion));
        }

        // Nothing but the allowed tables gained rows: no approval, signing, roster, outbox or notification.
        var changes = snapshotBefore.Diff(await env.SnapshotAsync());
        Assert.All(changes, c => Assert.Equal("added", c.Kind));
        var types = changes.Select(TypeOf).Distinct().ToList();
        Assert.True(types.All(AllowedAdds.Contains), "unexpected tables gained rows: " + string.Join(", ", types.Where(t => !AllowedAdds.Contains(t))));
        Assert.Equal(0, await db.ServiceAgreementDraftApprovals.CountAsync());
        Assert.Equal(0, await db.ElectronicSigningSnapshots.CountAsync());
        Assert.Equal(0, await db.NotificationOutbox.CountAsync());
        Assert.Equal(0, await db.NotificationLogs.CountAsync());
    }

    // ── 2. A rerun changes nothing ───────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_ARerun_AddsNothing_AndChangesNoRow()
    {
        var env = await SeededAsync();
        var first = await env.RunAsync();
        Assert.True(first.Total > 0, "the first run must add rows, or the rerun proves nothing");
        var afterFirst = await env.SnapshotAsync();

        var second = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.Seeded, second.Status);
        Assert.Equal(0, second.Total);
        var changes = afterFirst.Diff(await env.SnapshotAsync());
        Assert.True(changes.Count == 0, "a rerun changed: " + DemoSnapshot.Describe(changes));
    }

    [SkippableFact]
    public async Task Postgres_ADryRun_ReportsTheRowsButWritesNothing()
    {
        var env = await SeededAsync();
        var before = await env.SnapshotAsync();

        var result = await env.RunAsync(dryRun: true);

        Assert.True(result.Total > 0);
        Assert.Empty(before.Diff(await env.SnapshotAsync()));
    }

    // ── 3. Manual records are untouched, with no duplicate revision ──────────────────────────────

    [SkippableFact]
    public async Task Postgres_ManualRowsAreUntouched_AndAParticipantWithADraftGetsNoSecondRevision()
    {
        var env = await SeededAsync();
        Guid manualParticipant, host;
        await using (var db = env.Admin())
        {
            manualParticipant = await db.Participants.Where(p => p.TenantId == DemoTenant && p.IsActive && !p.IsDraft).OrderBy(p => p.Id).Select(p => p.Id).FirstAsync();
            host = await db.Participants.Where(p => p.TenantId == DemoTenant && p.NdisNumber == DemoPeople.ParticipantNdisNumbers["liam"]).Select(p => p.Id).SingleAsync();
            db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
            {
                Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = manualParticipant, Version = 1, State = "QLD", ServiceTypesJson = "[]",
                ParticipantNameSnapshot = "Manual", CreatedBy = "a coordinator", PlanStartDate = new DateOnly(2026, 1, 1), PlanEndDate = new DateOnly(2026, 12, 31),
                AgreementStartDate = new DateOnly(2026, 1, 1), AgreementEndDate = new DateOnly(2026, 12, 31),
            });
            db.ParticipantNotes.Add(new ParticipantNote { Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = host, Title = "Manual", Description = "kept", CreatedByName = "a coordinator" });
            db.ParticipantRoutines.Add(new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = host, Title = "Manual", Description = "kept" });
            db.ParticipantMedications.Add(new ParticipantMedication
            {
                Id = Guid.NewGuid(), TenantId = DemoTenant, ParticipantId = host, Name = "Manual", DoseDescription = "kept", TimesOfDay = "08:00", StartDate = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        var before = await env.SnapshotAsync();

        await env.RunAsync();

        var changes = before.Diff(await env.SnapshotAsync());
        Assert.NotEmpty(changes);
        Assert.All(changes, c => Assert.Equal("added", c.Kind));   // nothing removed, nothing changed: every manual row is as it was
        await using var check = env.Admin();
        var draft = Assert.Single(await check.ServiceAgreementDrafts.Where(d => d.ParticipantId == manualParticipant).ToListAsync());
        Assert.Equal("a coordinator", draft.CreatedBy);
    }

    // ── 4. Another tenant: rejected when it owns a fixture id, never given a child, and a missing or ambiguous Demo tenant writes nothing ──

    [SkippableFact]
    public async Task Postgres_AFixtureIdOwnedByAnotherTenant_RejectsTheWholeRun_AndWritesNothing()
    {
        var env = await SeededAsync();
        var otherTenant = Guid.NewGuid();
        await using (var db = env.Admin())
        {
            db.Tenants.Add(new Tenant { Id = otherTenant, Name = "Other", EmailDomain = "other.example.invalid", IsActive = true });
            await db.SaveChangesAsync();
            db.Participants.Add(new Participant { Id = DemoParticipantFixtureSeeder.IdOf("participant", "direct-intake"), TenantId = otherTenant, FirstName = "Theirs", LastName = "Owned", IsDraft = true });
            await db.SaveChangesAsync();
        }
        var before = await env.SnapshotAsync();

        var result = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.Rejected, result.Status);
        Assert.Equal(0, result.Total);
        Assert.Empty(before.Diff(await env.SnapshotAsync()));
        await using var check = env.Admin();
        Assert.Equal(otherTenant, (await check.Participants.SingleAsync(p => p.Id == DemoParticipantFixtureSeeder.IdOf("participant", "direct-intake"))).TenantId);
    }

    [SkippableFact]
    public async Task Postgres_TheSameNdisNumberInAnotherTenant_GetsNoChild_AndTheRunStillSeedsTheDemoTenant()
    {
        var env = await SeededAsync();
        var otherTenant = Guid.NewGuid();
        var lookalike = Guid.NewGuid();
        await using (var db = env.Admin())
        {
            db.Tenants.Add(new Tenant { Id = otherTenant, Name = "Other", EmailDomain = "other.example.invalid", IsActive = true });
            await db.SaveChangesAsync();
            db.Participants.Add(new Participant
            {
                Id = lookalike, TenantId = otherTenant, FirstName = "Look", LastName = "Alike", NdisNumber = DemoPeople.ParticipantNdisNumbers["liam"], IsActive = true,
            });
            await db.SaveChangesAsync();
        }

        var result = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.Seeded, result.Status);
        await using var check = env.Admin();
        Assert.Equal(8, await check.ParticipantMedications.CountAsync(m => m.Name.EndsWith("(demo)")));
        Assert.False(await check.ParticipantMedications.AnyAsync(m => m.ParticipantId == lookalike));
        Assert.False(await check.ParticipantNotes.AnyAsync(m => m.ParticipantId == lookalike));
        Assert.False(await check.ParticipantRoutines.AnyAsync(m => m.ParticipantId == lookalike));
        Assert.False(await check.RestrictivePractices.AnyAsync(m => m.ParticipantId == lookalike));
        Assert.False(await check.ServiceAgreementDrafts.AnyAsync(m => m.ParticipantId == lookalike));   // the lookalike's own tenant is not the Demo tenant
        Assert.All(await check.ParticipantMedications.Where(m => m.Name.EndsWith("(demo)")).ToListAsync(),
            m => Assert.Equal(DemoTenant, check.Participants.Single(p => p.Id == m.ParticipantId).TenantId));
    }

    [SkippableFact]
    public async Task Postgres_NoDemoTenant_WritesNothing()
    {
        Require();
        var env = new Env(await _pg.NewDatabaseAsync());   // migrated, never seeded: no tenant at all
        var before = await env.SnapshotAsync();

        var result = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.NoDemoTenant, result.Status);
        Assert.Empty(before.Diff(await env.SnapshotAsync()));
    }

    [SkippableFact]
    public async Task Postgres_AnAmbiguousDemoTenant_WritesNothing()
    {
        var env = await SeededAsync();
        await using (var db = env.Admin())
        {
            // The unique index is case-sensitive, so a case variant of the domain is a second active "Demo" tenant.
            db.Tenants.Add(new Tenant { Id = Guid.NewGuid(), Name = "Demo", EmailDomain = "DEMO.odip.com.au", IsActive = true });
            await db.SaveChangesAsync();
        }
        var before = await env.SnapshotAsync();

        var result = await env.RunAsync();

        Assert.Equal(DemoFixtureStatus.NoDemoTenant, result.Status);
        Assert.Empty(before.Diff(await env.SnapshotAsync()));
    }

    // ── 5. Lifecycle stages ──────────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Postgres_TheLifecycleQueriesFindTheEnquiriesIntakeAndOnboardingExamples_AndNoDraftCanReceiveServices()
    {
        var env = await SeededAsync();
        int directBefore, onboardingBefore, unconvertedBefore, serviceableBefore;
        await using (var db = env.AsDemo())
        {
            directBefore = await ParticipantStages.DirectIntakes(db, db.Participants).CountAsync();
            onboardingBefore = await ParticipantStages.InOnboarding(db.Participants).CountAsync();
            unconvertedBefore = await db.ParticipantInquiries.CountAsync(i => i.ParticipantId == null);
            serviceableBefore = await db.Participants.Where(Participant.CanReceiveServicesRule).CountAsync();
        }

        await env.RunAsync();

        await using var after = env.AsDemo();
        var direct = DemoParticipantFixtureSeeder.IdOf("participant", "direct-intake");
        var onboarding = new[] { DemoParticipantFixtureSeeder.IdOf("participant", "onboarding-awaiting-detail"), DemoParticipantFixtureSeeder.IdOf("participant", "onboarding-agreement-outstanding") };
        Assert.Equal(directBefore + 1, await ParticipantStages.DirectIntakes(after, after.Participants).CountAsync());
        Assert.True(await ParticipantStages.DirectIntakes(after, after.Participants).AnyAsync(p => p.Id == direct));
        Assert.Equal(onboardingBefore + 2, await ParticipantStages.InOnboarding(after.Participants).CountAsync());
        Assert.All(onboarding, id => Assert.True(after.Participants.Any(p => p.Id == id && p.IsDraft && p.IntakeCompletedAt != null)));
        Assert.Equal(unconvertedBefore + 2, await after.ParticipantInquiries.CountAsync(i => i.ParticipantId == null));
        Assert.Equal(serviceableBefore, await after.Participants.Where(Participant.CanReceiveServicesRule).CountAsync());   // draft children make nobody operational

        var fixtures = await after.Participants.Where(p => p.Id == direct || onboarding.Contains(p.Id)).ToListAsync();
        Assert.Equal(3, fixtures.Count);
        Assert.All(fixtures, p =>
        {
            Assert.True(p.IsDraft);
            Assert.False(p.IsActive);
            Assert.Null(p.ServicesStartedAt);
            Assert.EndsWith("@example.invalid", p.Email);
        });
        var inquiries = await after.ParticipantInquiries.Where(i => i.CreatedAt > DateTime.UtcNow.AddDays(-3) && i.Provenance!.StartsWith("Demo fixture")).ToListAsync();
        Assert.Equal(2, inquiries.Count);
        Assert.All(inquiries, i =>
        {
            Assert.EndsWith("@example.invalid", i.Email);
            Assert.Null(i.IntakeInviteSentAt);
            Assert.Null(i.IntakeUid);
            Assert.Null(i.IntakeStartsAt);
            Assert.Null(i.ParticipantId);
        });
    }

    // ── 6. The new chart rows are valid and make no clinical claim ───────────────────────────────

    [SkippableFact]
    public async Task Postgres_TheMedicationRoutineNoteAndPracticeFixtures_AreValidDemoLabelledAndMakeNoClaim()
    {
        var env = await SeededAsync();
        await env.RunAsync();

        await using var db = env.Admin();
        var meds = await db.ParticipantMedications.Where(m => m.Name.EndsWith("(demo)")).ToListAsync();
        Assert.Equal(8, meds.Count);
        Assert.Equal(4, meds.Select(m => m.ParticipantId).Distinct().Count());
        Assert.All(meds, m =>
        {
            Assert.Equal(MedicationStatus.OnHold, m.Status);
            Assert.False(m.IsChemicalRestraint || m.IsPsychotropic || m.IsHighRisk || m.ConsentObtained);
            Assert.Null(m.PrescriberName);
            Assert.Contains("Demo fixture", m.Notes);
            if (m.Type == MedicationType.Prn)
            {
                Assert.False(string.IsNullOrWhiteSpace(m.PrnIndication));
                Assert.True(m.PrnMaxDosesPer24h > 0);
            }
            else
            {
                Assert.True(MedicationSlotCalculator.TryParseTimesOfDay(m.TimesOfDay, out _));
                if (m.Frequency == MedicationFrequency.SpecificDays) Assert.True(m.DaysOfWeek is { } d && d != Weekdays.None);
                if (m.Frequency == MedicationFrequency.EveryNDays) Assert.True(m.IntervalDays > 0 && m.AnchorDate != null);
            }
        });
        Assert.Contains(meds, m => m.Type == MedicationType.Prn);
        Assert.Contains(meds, m => m.Frequency == MedicationFrequency.SpecificDays);
        Assert.Contains(meds, m => m.Frequency == MedicationFrequency.EveryNDays);
        var medIds = meds.Select(m => m.Id).ToList();
        Assert.Equal(0, await db.MedicationAdministrations.CountAsync(a => medIds.Contains(a.ParticipantMedicationId)));

        var routines = await db.ParticipantRoutines.Where(r => r.Description.StartsWith("Demo fixture")).ToListAsync();
        Assert.Equal(8, routines.Count);
        Assert.All(routines, r =>
        {
            Assert.NotEqual(ParticipantRoutineDays.None, r.Days);
            Assert.True(Enum.IsDefined(r.Category));
            Assert.Equal(r.StartTime is null, r.EndTime is null);
            if (r.StartTime is { } s) Assert.True(s < r.EndTime);
        });
        Assert.Equal(4, routines.Count(r => r.StartTime is null));

        var notes = await db.ParticipantNotes.Where(n => n.Description.StartsWith("Demo fixture")).ToListAsync();
        Assert.Equal(12, notes.Count);
        Assert.All(notes, n => Assert.Null(n.SourceKey));
        Assert.Equal((4, 2), (notes.Count(n => n.IsPinned), notes.Count(n => n.IsArchived)));

        var practices = await db.RestrictivePractices.Where(p => p.Description.StartsWith("Demo fixture")).ToListAsync();
        Assert.Equal(4, practices.Count);
        Assert.All(practices, p =>
        {
            Assert.False(p.IsActive);
            Assert.Null(p.AuthorisedBy);
            Assert.Null(p.AuthorisationDate);
            Assert.Null(p.ReviewDate);
            Assert.NotEqual(RestrictivePracticeType.ChemicalRestraint, p.Type);
            Assert.Null(p.RelatedMedicationId);
        });
        Assert.All(meds.Select(m => m.TenantId).Concat(routines.Select(r => r.TenantId)).Concat(notes.Select(n => n.TenantId)).Concat(practices.Select(p => p.TenantId)),
            t => Assert.Equal(DemoTenant, t));
    }

    // ── 7. A failure part-way rolls the whole batch back ─────────────────────────────────────────

    private sealed class FailOnSecondDraft : SaveChangesInterceptor
    {
        public int DraftSaves { get; private set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Added) && ++DraftSaves == 2)
                throw new InvalidOperationException("injected failure on the second agreement draft");
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    [SkippableFact]
    public async Task Postgres_AFailureAfterTheFirstDraft_RollsBackTheWholeBatch()
    {
        Require();
        var failing = new FailOnSecondDraft();
        var connection = await _pg.NewDatabaseAsync();
        var env = new Env(connection, failing);
        await using (var db = env.Admin()) await DemoOldSeedTests.RunOldSeedAsync(db);
        var before = await env.SnapshotAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => env.RunAsync());

        Assert.True(failing.DraftSaves >= 2, "the failure must come after the other rows and the first draft were saved, or the rollback proves nothing");
        var after = await env.SnapshotAsync();
        Assert.True(before.Diff(after).Count == 0, "the batch was not rolled back: " + DemoSnapshot.Describe(before.Diff(after)));

        // Negative control: the same database with no injected failure takes the whole batch.
        var control = await new Env(connection).RunAsync();
        Assert.True(control.Total > 0);
    }
}
