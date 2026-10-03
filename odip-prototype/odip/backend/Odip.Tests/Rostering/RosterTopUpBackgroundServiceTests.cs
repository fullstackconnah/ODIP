using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The daily top-up: it keeps eight weeks of open shifts generated for the patterns an approved agreement made, for each organisation on its own provider day, and for participants who may be
/// rostered. It never touches a hand-made or demo pattern, an ended or switched-off pattern, or a participant who is not ready; running it twice (or after a restart) makes nothing twice.
/// </summary>
public class RosterTopUpBackgroundServiceTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    // 02:00 UTC on Saturday 10 October 2026 is 13:00 on Saturday in Sydney (AEDT, UTC+11), the same day in Brisbane (AEST, UTC+10).
    private static FakeClock Clock() => FakeClock.AtUtc(2026, 10, 10, 2, 0);

    private static OdipDbContext NewAdminDb(string name)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static (OdipDbContext Db, RosterTopUpBackgroundService Service, string Name) Build(FakeClock clock, Dictionary<string, string?>? config = null, IRosterPlacementGate? gate = null, string? name = null)
    {
        name ??= Guid.NewGuid().ToString();
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(name));
        services.AddSingleton<IRosterPlacementGate>(gate ?? new RosterPlacementGate());
        services.AddSingleton<RosterShiftGenerator>();
        var provider = services.BuildServiceProvider();
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(config ?? new Dictionary<string, string?>()).Build();
        var service = new RosterTopUpBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), configuration, NullLogger<RosterTopUpBackgroundService>.Instance, clock);
        return (NewAdminDb(name), service, name);
    }

    private static async Task<Participant> AddParticipantAsync(OdipDbContext db, Guid tenantId, bool active = true, string name = "Amy")
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Ng", IsActive = active, IsDraft = !active };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        return participant;
    }

    private static ShiftPattern AgreementPattern(Participant participant, DayOfWeek day, Guid? draftId = null, string blockKey = "b", Action<ShiftPattern>? change = null)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, DayOfWeek = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2027, 3, 31), IsActive = true, SourceDraftId = draftId ?? Guid.NewGuid(), SourceBlockKey = blockKey, WorkerSlot = 1,
            RequirementsJson = """{"workerGender":"NoPreference","driver":false,"skills":[]}""",
        };
        change?.Invoke(pattern);
        return pattern;
    }

    private static async Task<ServiceAgreementDraft> AddDraftAsync(OdipDbContext db, Participant participant, Guid? id = null)
    {
        var draft = new ServiceAgreementDraft
        {
            Id = id ?? Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, Version = 1, State = "NSW", ParticipantNameSnapshot = "Amy Ng",
            AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2027, 3, 31), PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        };
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return draft;
    }

    [Fact]
    public async Task A_ready_participants_agreement_pattern_is_topped_up_to_eight_weeks_ahead_as_open_draft_shifts_that_copy_it()
    {
        var (db, service, _) = Build(Clock());
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        var draft = await AddDraftAsync(db, participant);
        var pattern = AgreementPattern(participant, DayOfWeek.Monday, draft.Id);
        db.ShiftPatterns.Add(pattern);
        await db.SaveChangesAsync();

        var run = await service.RunOnceAsync(CancellationToken.None);

        var shifts = await db.Shifts.OrderBy(s => s.ServiceDate).ToListAsync();
        // Mondays from Saturday 10 October to 56 days ahead (Saturday 5 December): 12, 19, 26 Oct and 2, 9, 16, 23, 30 Nov
        Assert.Equal(8, shifts.Count);
        Assert.Equal((new DateOnly(2026, 10, 12), new DateOnly(2026, 11, 30)), (shifts.First().ServiceDate, shifts.Last().ServiceDate));
        Assert.All(shifts, s =>
        {
            Assert.Equal((pattern.Id, ShiftStatus.Draft, (Guid?)null, TenantA, participant.Id), (s.ShiftPatternId, s.Status, s.UserId, s.TenantId, s.ParticipantId));
            Assert.Equal(pattern.RequirementsJson, s.RequirementsJson);
        });
        Assert.Equal((1, 1, 1, 8, 0, 0), (run.Tenants, run.Participants, run.Patterns, run.ShiftsCreated, run.ParticipantsNotReady, run.Failures));
    }

    [Fact]
    public async Task A_participant_who_is_not_ready_is_skipped_and_counted_and_gets_no_shifts_until_they_are()
    {
        var (db, service, name) = Build(Clock());
        await using var _ = db;
        var onboarding = await AddParticipantAsync(db, TenantA, active: false, name: "Jordan");
        db.ShiftPatterns.Add(AgreementPattern(onboarding, DayOfWeek.Monday));
        await db.SaveChangesAsync();

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Empty(await db.Shifts.ToListAsync());
        Assert.Equal((1, 1), (run.ParticipantsNotReady, run.Participants));
        Assert.Equal(0, run.ShiftsCreated);

        // Activated the next provider day: the next run (a new day) generates for them.
        var tracked = await db.Participants.SingleAsync();
        tracked.IsActive = true; tracked.IsDraft = false;
        await db.SaveChangesAsync();
        var clock = Clock(); clock.Set(clock.GetUtcNow().AddDays(1));
        var (db2, service2, _) = Build(clock, name: name);
        await using var __ = db2;
        var next = await service2.RunOnceAsync(CancellationToken.None);
        Assert.True(next.ShiftsCreated > 0);
    }

    [Fact]
    public async Task Hand_made_demo_ended_and_switched_off_patterns_are_never_touched()
    {
        var (db, service, _) = Build(Clock());
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        var handMade = AgreementPattern(participant, DayOfWeek.Monday, change: p => { p.SourceDraftId = null; p.SourceBlockKey = null; p.WorkerSlot = null; p.RequirementsJson = null; });      // a person's, or a demo pack's
        var ended = AgreementPattern(participant, DayOfWeek.Tuesday, change: p => p.EffectiveTo = new DateOnly(2026, 10, 9));                                                                 // ended yesterday
        var switchedOff = AgreementPattern(participant, DayOfWeek.Wednesday, change: p => p.IsActive = false);
        db.ShiftPatterns.AddRange(handMade, ended, switchedOff);
        await db.SaveChangesAsync();
        var before = await db.ShiftPatterns.AsNoTracking().OrderBy(p => p.Id).Select(p => new { p.Id, p.EffectiveTo, p.IsActive, p.StartTime, p.Notes }).ToListAsync();

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Empty(await db.Shifts.ToListAsync());
        Assert.Equal((0, 0, 0), (run.Tenants, run.Patterns, run.ShiftsCreated));
        Assert.Equal(before, await db.ShiftPatterns.AsNoTracking().OrderBy(p => p.Id).Select(p => new { p.Id, p.EffectiveTo, p.IsActive, p.StartTime, p.Notes }).ToListAsync());
    }

    [Fact]
    public async Task Running_it_again_the_same_day_or_after_a_restart_makes_nothing_twice()
    {
        var (db, service, name) = Build(Clock());
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Monday));
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Friday));
        await db.SaveChangesAsync();

        var first = await service.RunOnceAsync(CancellationToken.None);
        var sameDay = await service.RunOnceAsync(CancellationToken.None);                 // the hourly tick: this provider day is done
        var (db2, restarted, _) = Build(Clock(), name: name);                              // a restart forgets that, and the generator finds the shifts that are there
        await using var __ = db2;
        var afterRestart = await restarted.RunOnceAsync(CancellationToken.None);

        Assert.Equal(16, first.ShiftsCreated);
        Assert.Equal((0, 0), (sameDay.Tenants, sameDay.ShiftsCreated));
        Assert.Equal((1, 0), (afterRestart.Tenants, afterRestart.ShiftsCreated));
        Assert.Equal(16, await db.Shifts.CountAsync());
        Assert.Equal(16, (await db.Shifts.Select(s => new { s.ShiftPatternId, s.ServiceDate }).Distinct().ToListAsync()).Count);
    }

    [Fact]
    public async Task The_next_provider_day_keeps_the_horizon_eight_weeks_out()
    {
        var clock = Clock();
        var (db, service, name) = Build(clock);
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Saturday));
        await db.SaveChangesAsync();
        await service.RunOnceAsync(CancellationToken.None);                                // Saturdays up to 5 December inclusive: 10 Oct to 5 Dec, 9 of them
        Assert.Equal(9, await db.Shifts.CountAsync());

        clock.Set(clock.GetUtcNow().AddDays(7));                                           // Saturday 17 October: the horizon is now 12 December
        var next = await service.RunOnceAsync(CancellationToken.None);

        Assert.Equal(1, next.ShiftsCreated);
        Assert.Equal(new DateOnly(2026, 12, 12), await db.Shifts.MaxAsync(s => s.ServiceDate));
    }

    [Fact]
    public async Task The_horizon_is_held_to_the_end_of_the_pattern_and_the_configured_number_of_days()
    {
        var (db, service, _) = Build(Clock(), new Dictionary<string, string?> { ["RosterTopUp:HorizonDays"] = "14" });
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Monday, change: p => p.EffectiveTo = new DateOnly(2026, 10, 20)));
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Wednesday));
        await db.SaveChangesAsync();

        await service.RunOnceAsync(CancellationToken.None);

        // 14 days from Saturday 10 October is the 24th: the Monday pattern ends on the 20th (12th and 19th), the Wednesday one runs to the horizon (14th and 21st)
        Assert.Equal(new[] { "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21" }, (await db.Shifts.OrderBy(s => s.ServiceDate).Select(s => s.ServiceDate).ToListAsync()).Select(d => d.ToString("yyyy-MM-dd")));
    }

    [Fact]
    public async Task Each_organisation_is_topped_up_on_its_own_provider_day_and_only_with_its_own_patterns()
    {
        // 13:30 UTC on Saturday 10 October is 00:30 on Sunday 11th in Sydney (UTC+11) but 23:30 on Saturday 10th in Brisbane (UTC+10, no daylight saving).
        var clock = FakeClock.AtUtc(2026, 10, 10, 13, 30);
        var (db, service, _) = Build(clock);
        await using var _ = db;
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, State = "NSW" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantB, State = "QLD" });
        var sydney = await AddParticipantAsync(db, TenantA);
        var brisbane = await AddParticipantAsync(db, TenantB);
        db.ShiftPatterns.Add(AgreementPattern(sydney, DayOfWeek.Saturday));
        db.ShiftPatterns.Add(AgreementPattern(brisbane, DayOfWeek.Saturday));
        await db.SaveChangesAsync();

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Equal(2, run.Tenants);
        var first = async (Guid participantId) => (await db.Shifts.Where(s => s.ParticipantId == participantId).OrderBy(s => s.ServiceDate).FirstAsync());
        Assert.Equal((new DateOnly(2026, 10, 17), TenantA), ((await first(sydney.Id)).ServiceDate, (await first(sydney.Id)).TenantId));        // Sydney's today is Sunday the 11th: its first Saturday is the 17th
        Assert.Equal((new DateOnly(2026, 10, 10), TenantB), ((await first(brisbane.Id)).ServiceDate, (await first(brisbane.Id)).TenantId));    // Brisbane's today is still Saturday the 10th
        Assert.Equal(new[] { TenantA }, (await db.Shifts.Where(s => s.ParticipantId == sydney.Id).Select(s => s.TenantId).Distinct().ToListAsync()));
    }

    private sealed class FailingFor(Guid participantId) : IRosterPlacementGate
    {
        private readonly RosterPlacementGate _real = new();
        public Task<bool> MayPlaceAsync(OdipDbContext db, Guid id, CancellationToken ct) => id == participantId ? throw new InvalidOperationException("boom") : _real.MayPlaceAsync(db, id, ct);
    }

    [Fact]
    public async Task One_participants_failure_is_counted_and_the_others_are_still_topped_up()
    {
        var name = Guid.NewGuid().ToString();
        await using var seed = NewAdminDb(name);
        var bad = await AddParticipantAsync(seed, TenantA, name: "Bad");
        var good = await AddParticipantAsync(seed, TenantA, name: "Good");
        seed.ShiftPatterns.Add(AgreementPattern(bad, DayOfWeek.Monday));
        seed.ShiftPatterns.Add(AgreementPattern(good, DayOfWeek.Monday));
        await seed.SaveChangesAsync();
        var (db, service, _) = Build(Clock(), gate: new FailingFor(bad.Id), name: name);
        await using var _ = db;

        var run = await service.RunOnceAsync(CancellationToken.None);

        Assert.Equal((1, 8), (run.Failures, run.ShiftsCreated));
        Assert.Equal(new[] { good.Id }, await db.Shifts.Select(s => s.ParticipantId).Distinct().ToListAsync());
    }

    [Fact]
    public async Task The_job_can_be_switched_off_and_then_does_nothing_at_all()
    {
        var (db, service, _) = Build(Clock(), new Dictionary<string, string?> { ["RosterTopUp:Enabled"] = "false" });
        await using var _ = db;
        var participant = await AddParticipantAsync(db, TenantA);
        db.ShiftPatterns.Add(AgreementPattern(participant, DayOfWeek.Monday));
        await db.SaveChangesAsync();

        await service.StartAsync(CancellationToken.None);
        await service.ExecuteTask!;
        await service.StopAsync(CancellationToken.None);

        Assert.Empty(await db.Shifts.ToListAsync());
    }

    [Theory]
    [InlineData(null, true, 56)]
    [InlineData("", true, 56)]
    [InlineData("84", true, 84)]
    [InlineData("0", true, 56)]
    [InlineData("500", true, 56)]
    [InlineData("soon", true, 56)]
    public void The_settings_default_to_enabled_and_fifty_six_days_and_an_unusable_horizon_reads_as_the_default(string? horizon, bool enabled, int days)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["RosterTopUp:HorizonDays"] = horizon }).Build();

        var options = RosterTopUpOptions.From(configuration);

        Assert.Equal((enabled, days), (options.Enabled, options.HorizonDays));
        Assert.Equal(new RosterTopUpOptions(true, 56), RosterTopUpOptions.From(null));
    }
}
