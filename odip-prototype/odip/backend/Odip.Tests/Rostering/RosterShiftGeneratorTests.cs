using Microsoft.EntityFrameworkCore;
using Moq;
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
/// The one place a pattern becomes shifts, shared by the Generate button, the approval of an agreement revision and the daily top-up. It copies what the pattern asks of a worker,
/// leaves out the days a plan skipped for a public holiday, and does the same thing twice without making a shift twice.
/// </summary>
public class RosterShiftGeneratorTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly DateOnly Mon5Oct = new(2026, 10, 5);          // Labour Day in NSW

    private static OdipDbContext NewDb(string? name = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name ?? Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static ShiftPattern Pattern(Guid participantId, DayOfWeek day = DayOfWeek.Monday, Action<ShiftPattern>? change = null)
    {
        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participantId, DayOfWeek = day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 12, 31), IsActive = true,
        };
        change?.Invoke(pattern);
        return pattern;
    }

    private static async Task<(OdipDbContext Db, Guid ParticipantId)> SeedAsync(params Func<Guid, ShiftPattern>[] patterns)
    {
        var db = NewDb();
        var participantId = Guid.NewGuid();
        db.Participants.Add(new Participant { Id = participantId, TenantId = Tenant, FirstName = "Amy", LastName = "Ng", IsActive = true });
        foreach (var make in patterns) db.ShiftPatterns.Add(make(participantId));
        await db.SaveChangesAsync();
        return (db, participantId);
    }

    private static ServiceAgreementDraft DraftSkipping(Guid participantId, string blockKey, params DateOnly[] skipped)
    {
        var quote = new PlanQuote
        {
            HolidayOccurrences = skipped.Select(date => new HolidayOccurrence(blockKey, date, "Labour Day", "NSW", HolidayDecision.Skip, true, null, null, null)).ToList(),
        };
        return new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participantId, Version = 1, State = "NSW", ParticipantNameSnapshot = "Amy Ng",
            AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2026, 12, 31), PlanStartDate = new DateOnly(2026, 10, 1), PlanEndDate = new DateOnly(2026, 12, 31),
            PricingJson = DraftJson.Write(quote),
        };
    }

    [Fact]
    public async Task Each_matching_day_in_the_window_becomes_a_draft_shift_that_copies_the_pattern_including_what_it_asks_of_a_worker()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id, change: p =>
        {
            p.DefaultUserId = null; p.EndsNextDay = false; p.Ratio = SupportRatio.TwoToOne; p.NightType = SleepoverType.ActiveNight;
            p.RequirementsJson = """{"workerGender":"Female","driver":true,"skills":["FirstAid"]}""";
        }));
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 25), CancellationToken.None);

        Assert.Equal((3, 0), (result.Created, result.Skipped));
        var shifts = await db.Shifts.OrderBy(s => s.ServiceDate).ToListAsync();
        Assert.Equal(new[] { new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 19) }, shifts.Select(s => s.ServiceDate));
        Assert.All(shifts, s =>
        {
            Assert.Equal((participantId, pattern.Id, Tenant, ShiftStatus.Draft, (Guid?)null), (s.ParticipantId, s.ShiftPatternId, s.TenantId, s.Status, s.UserId));
            Assert.Equal((new TimeOnly(9, 0), new TimeOnly(13, 0), false, SupportRatio.TwoToOne, SleepoverType.ActiveNight), (s.StartTime, s.EndTime, s.EndsNextDay, s.Ratio, s.NightType));
            Assert.Equal("""{"workerGender":"Female","driver":true,"skills":["FirstAid"]}""", s.RequirementsJson);
        });
        Assert.Equal((new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 19)), (result.FirstDate, result.LastDate));
    }

    [Fact]
    public async Task A_pattern_that_names_a_default_worker_gives_the_shifts_that_worker_as_it_always_did()
    {
        var staff = Guid.NewGuid();
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        db.Users.Add(new User { Id = staff, TenantId = Tenant, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
        var pattern = await db.ShiftPatterns.SingleAsync();
        pattern.DefaultUserId = staff;
        await db.SaveChangesAsync();

        await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 5), CancellationToken.None);

        var shift = await db.Shifts.SingleAsync();
        Assert.Equal(staff, shift.UserId);
        Assert.Null(shift.RequirementsJson);        // a pattern that asked for nothing leaves the shift asking for nothing
    }

    [Fact]
    public async Task Generating_the_same_window_twice_makes_every_shift_once_and_says_how_many_were_already_there()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();
        var generator = new RosterShiftGenerator();

        var first = await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 19), CancellationToken.None);
        var second = await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 26), CancellationToken.None);

        Assert.Equal((3, 0), (first.Created, first.Skipped));
        Assert.Equal((1, 3), (second.Created, second.Skipped));         // only the 26th is new
        Assert.Equal(4, await db.Shifts.CountAsync());
    }

    [Fact]
    public async Task A_day_already_holding_a_shift_of_the_pattern_is_not_made_again_whatever_became_of_that_shift()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();
        db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participantId, ShiftPatternId = pattern.Id, ServiceDate = new DateOnly(2026, 10, 12), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Cancelled });
        await db.SaveChangesAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 19), CancellationToken.None);

        Assert.Equal((2, 1), (result.Created, result.Skipped));
    }

    [Fact]
    public async Task A_public_holiday_the_plan_skips_gets_no_shift_for_that_block_and_that_day_only()
    {
        var (db, participantId) = await SeedAsync();
        await using var _ = db;
        var draft = DraftSkipping(participantId, "outing", Mon5Oct);
        db.ServiceAgreementDrafts.Add(draft);
        var skipping = Pattern(participantId, change: p => { p.SourceDraftId = draft.Id; p.SourceBlockKey = "outing"; p.WorkerSlot = 1; });
        var otherBlock = Pattern(participantId, change: p => { p.SourceDraftId = draft.Id; p.SourceBlockKey = "morning"; p.WorkerSlot = 1; });
        var handMade = Pattern(participantId);
        db.ShiftPatterns.AddRange(skipping, otherBlock, handMade);
        await db.SaveChangesAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { skipping.Id, otherBlock.Id, handMade.Id }, Mon5Oct, new DateOnly(2026, 10, 12), CancellationToken.None);

        Assert.Equal((5, 1, 1), (result.Created, result.Skipped, result.HolidaysSkipped));
        Assert.Equal(new[] { new DateOnly(2026, 10, 12) }, await db.Shifts.Where(s => s.ShiftPatternId == skipping.Id).Select(s => s.ServiceDate).ToListAsync());
        Assert.Equal(2, await db.Shifts.CountAsync(s => s.ShiftPatternId == otherBlock.Id));      // another block of the same plan still works on the holiday
        Assert.Equal(2, await db.Shifts.CountAsync(s => s.ShiftPatternId == handMade.Id));        // and a pattern nobody's plan made does not read any plan
    }

    [Fact]
    public async Task A_holiday_a_plan_charges_or_has_not_decided_still_gets_its_shift()
    {
        var (db, participantId) = await SeedAsync();
        await using var _ = db;
        var draft = DraftSkipping(participantId, "outing");
        var quote = new PlanQuote
        {
            HolidayOccurrences = new[]
            {
                new HolidayOccurrence("outing", Mon5Oct, "Labour Day", "NSW", HolidayDecision.Charge, false, null, null, null),
                new HolidayOccurrence("outing", new DateOnly(2026, 10, 12), "Some Day", "NSW", HolidayDecision.Review, false, null, null, null),
            },
        };
        draft.PricingJson = DraftJson.Write(quote);
        db.ServiceAgreementDrafts.Add(draft);
        var pattern = Pattern(participantId, change: p => { p.SourceDraftId = draft.Id; p.SourceBlockKey = "outing"; p.WorkerSlot = 1; });
        db.ShiftPatterns.Add(pattern);
        await db.SaveChangesAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { pattern.Id }, Mon5Oct, new DateOnly(2026, 10, 12), CancellationToken.None);

        Assert.Equal((2, 0), (result.Created, result.HolidaysSkipped));
    }

    [Fact]
    public async Task A_pattern_that_has_been_ended_or_switched_off_since_it_was_chosen_generates_nothing_for_the_days_it_no_longer_covers()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id), id => Pattern(id, DayOfWeek.Tuesday));
        await using var _ = db;
        var patterns = await db.ShiftPatterns.OrderBy(p => p.DayOfWeek).ToListAsync();
        // Another request ended the Monday pattern (and switched the Tuesday one off) after this one had picked them: generation reads them again once it holds the lock.
        patterns[0].EffectiveTo = new DateOnly(2026, 10, 11);
        patterns[1].IsActive = false;
        await db.SaveChangesAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, patterns.Select(p => p.Id).ToList(), new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 25), CancellationToken.None);

        Assert.Equal(1, result.Created);           // only Monday 5 October: the Monday pattern ended on the 11th, and the Tuesday pattern is off
        Assert.Equal(new DateOnly(2026, 10, 5), (await db.Shifts.SingleAsync()).ServiceDate);
    }

    [Fact]
    public async Task Patterns_of_another_participant_are_never_generated_by_a_call_for_this_one()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        var stranger = Pattern(Guid.NewGuid());
        db.ShiftPatterns.Add(stranger);
        await db.SaveChangesAsync();

        var result = await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { stranger.Id }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 12), CancellationToken.None);

        Assert.Equal(0, result.Created);
        Assert.Empty(db.Shifts);
    }

    [Fact]
    public async Task Patterns_that_are_not_saved_yet_are_added_to_the_context_for_the_caller_to_save_with_its_own_work()
    {
        var (db, participantId) = await SeedAsync();
        await using var _ = db;
        var fresh = Pattern(participantId, DayOfWeek.Wednesday);
        db.ShiftPatterns.Add(fresh);

        var result = await new RosterShiftGenerator().AddAsync(db, new[] { fresh }, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 18), CancellationToken.None);

        Assert.Equal((2, 0), (result.Created, result.Skipped));
        Assert.Empty(await db.Shifts.ToListAsync());                                             // nothing is saved by the generator: the caller saves it in its transaction
        Assert.Equal(2, db.ChangeTracker.Entries<Shift>().Count(e => e.State == EntityState.Added));
        await db.SaveChangesAsync();
        Assert.Equal(2, await db.Shifts.CountAsync());
    }

    // ── How far generation has reached ────────────────────────────────────────────

    private static DateOnly D(int month, int day) => new(2026, month, day);

    [Fact]
    public async Task Each_generation_records_how_far_it_reached_held_to_the_patterns_end_and_never_moves_it_back()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));                  // 1 October to 31 December
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();
        var generator = new RosterShiftGenerator();
        Assert.Null(pattern.GeneratedThrough);

        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 5), D(10, 25), CancellationToken.None);
        Assert.Equal(D(10, 25), (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough);

        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 5), D(10, 12), CancellationToken.None);          // an earlier window
        Assert.Equal(D(10, 25), (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough);

        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 26), new DateOnly(2027, 2, 28), CancellationToken.None);   // past the pattern's end
        Assert.Equal(D(12, 31), (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough);
    }

    [Fact]
    public async Task A_window_outside_the_pattern_and_a_pattern_switched_off_record_nothing()
    {
        var (db, participantId) = await SeedAsync(
            id => Pattern(id, DayOfWeek.Monday, p => p.EffectiveTo = D(10, 11)),        // ended on the 11th
            id => Pattern(id, DayOfWeek.Tuesday),
            id => Pattern(id, DayOfWeek.Wednesday, p => p.IsActive = false));
        await using var _ = db;
        var ended = await db.ShiftPatterns.SingleAsync(p => p.DayOfWeek == DayOfWeek.Monday);
        var generator = new RosterShiftGenerator();

        await generator.GenerateAsync(db, participantId, new[] { ended.Id }, D(10, 12), D(10, 25), CancellationToken.None);      // after it ended
        var tuesday = await db.ShiftPatterns.SingleAsync(p => p.DayOfWeek == DayOfWeek.Tuesday);
        await generator.GenerateAsync(db, participantId, new[] { tuesday.Id }, D(9, 1), D(9, 20), CancellationToken.None);       // before it began
        var off = await db.ShiftPatterns.SingleAsync(p => p.DayOfWeek == DayOfWeek.Wednesday);
        await generator.GenerateAsync(db, participantId, new[] { off.Id }, D(10, 5), D(10, 25), CancellationToken.None);         // it is switched off: nothing was covered

        Assert.All(await db.ShiftPatterns.AsNoTracking().ToListAsync(), p => Assert.Null(p.GeneratedThrough));
    }

    [Fact]
    public async Task A_persons_window_that_leaves_a_gap_after_what_was_covered_does_not_move_it_but_one_that_joins_on_does_and_the_top_up_always_does()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();
        var generator = new RosterShiftGenerator();
        async Task<DateOnly?> ReachedAsync() => (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough;
        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 5), D(10, 25), CancellationToken.None);

        // A Generate button over a later block of days: the days between would never be reached by the top-up if it were recorded.
        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(11, 9), D(11, 30), CancellationToken.None, onlyWhenContiguous: true);
        Assert.Equal(D(10, 25), await ReachedAsync());

        // One that starts the next day (or earlier) joins on.
        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 26), D(11, 8), CancellationToken.None, onlyWhenContiguous: true);
        Assert.Equal(D(11, 8), await ReachedAsync());

        // The top-up (an approval too) is the one that decides where the roster is kept up to: it records its window wherever it starts.
        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(12, 7), D(12, 20), CancellationToken.None);
        Assert.Equal(D(12, 20), await ReachedAsync());
    }

    [Fact]
    public async Task A_generate_over_the_day_of_a_deleted_shift_makes_it_again_and_leaves_how_far_it_reached_where_it_was()
    {
        var (db, participantId) = await SeedAsync(id => Pattern(id));
        await using var _ = db;
        var pattern = await db.ShiftPatterns.SingleAsync();
        var generator = new RosterShiftGenerator();
        await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 5), D(10, 26), CancellationToken.None);         // 5, 12, 19 and 26 October
        db.Shifts.Remove(await db.Shifts.SingleAsync(s => s.ServiceDate == D(10, 12)));                                              // the coordinator deletes one
        await db.SaveChangesAsync();

        var again = await generator.GenerateAsync(db, participantId, new[] { pattern.Id }, D(10, 5), D(10, 26), CancellationToken.None, onlyWhenContiguous: true);

        Assert.Equal((1, 3), (again.Created, again.Skipped));
        Assert.Equal(new[] { D(10, 5), D(10, 12), D(10, 19), D(10, 26) }, await db.Shifts.OrderBy(s => s.ServiceDate).Select(s => s.ServiceDate).ToListAsync());
        Assert.Equal(D(10, 26), (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough);
    }

    [Fact]
    public async Task A_pattern_made_in_the_callers_context_has_how_far_it_reached_saved_with_it()
    {
        var (db, participantId) = await SeedAsync();
        await using var _ = db;
        var fresh = Pattern(participantId, DayOfWeek.Wednesday);
        db.ShiftPatterns.Add(fresh);

        await new RosterShiftGenerator().AddAsync(db, new[] { fresh }, D(10, 5), D(10, 18), CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(D(10, 18), (await db.ShiftPatterns.AsNoTracking().SingleAsync()).GeneratedThrough);
    }

    [Fact]
    public async Task The_generation_lock_is_a_no_op_off_PostgreSQL_and_opens_no_transaction_there()
    {
        var (db, participantId) = await SeedAsync();
        await using var _ = db;

        await using var held = await RosterGenerationLock.AcquireAsync(db, participantId, CancellationToken.None);

        Assert.False(held.Held);
        Assert.Null(db.Database.CurrentTransaction);
        await held.CommitAsync(CancellationToken.None);
    }
}
