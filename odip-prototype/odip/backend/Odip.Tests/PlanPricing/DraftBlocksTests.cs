using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Plan builder phase C, item 1: the blocks of a service agreement draft revision. A revision stores its blocks exactly as the pricing engine takes them, the server prices them on
/// save (the client sends no price and no code) and stores the lines the engine generates, and a revision is never edited. The catalogue is the real 2026-27 one, imported once
/// through the real importer, so every price below is a price the importer read from the NDIA file.
/// </summary>
public class DraftBlocksTests
{
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    private static readonly DateOnly Mon26Oct = new(2026, 10, 26);

    /// <summary>One in-memory database with the real catalogue and the seeded holiday overrides, opened as one tenant's Admin sees it.</summary>
    private sealed class Fixture : IAsyncDisposable
    {
        public required string DbName { get; init; }
        public required Guid TenantId { get; init; }
        public required OdipDbContext Db { get; init; }
        public required Participant Participant { get; init; }
        public ServiceAgreementDraftService Service => new(Db);
        public ValueTask DisposeAsync() => Db.DisposeAsync();

        /// <summary>The same database as another tenant sees it (query filters on).</summary>
        public OdipDbContext Open(Guid? tenantId, bool superAdmin = false) => NewContext(DbName, tenantId, superAdmin);
    }

    private static OdipDbContext NewContext(string name, Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static async Task<Fixture> SetUpAsync(Guid? tenantId = null, string? dbName = null)
    {
        var tenant = tenantId ?? TenantA;
        var name = dbName ?? Guid.NewGuid().ToString();
        var db = NewContext(name, tenant);
        await db.Database.EnsureCreatedAsync();
        if (!await db.SupportCatalogueItems.AnyAsync())
        {
            // The catalogue is global: import it as a SuperAdmin would, into the same database.
            await using var importDb = NewContext(name, null, superAdmin: true);
            await CatalogueImportTestSupport.ImportAsync(importDb, CatalogueFixtures.File2026_27);
        }

        var participant = db.Participants.Add(new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenant, FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234",
            DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true,
        }).Entity;
        await db.SaveChangesAsync();
        return new Fixture { DbName = name, TenantId = tenant, Db = db, Participant = participant };
    }

    private static PlanBlock MonWed(string id = "b1") =>
        Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

    private static DraftBlockDto Entry(PlanBlock block, DraftBlockRequirementsDto? requirements = null) => new() { Block = block, Requirements = requirements ?? new DraftBlockRequirementsDto() };

    private static CreateServiceAgreementDraftDto Request(IEnumerable<DraftBlockDto> blocks, DateOnly? from = null, DateOnly? to = null) => new()
    {
        PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        AgreementStartDate = from ?? Mon12Oct, AgreementEndDate = to ?? Sun18Oct, State = "NSW", Representative = "A. Representative",
        Blocks = blocks.ToList(),
    };

    // ── Free text ─────────────────────────────────────────────────────────────────

    // Code review N13: the representative is length-limited but was not filtered for control characters, so a NUL through the API was a PostgreSQL refusal and a 500, as a block id's was (review F6).
    [Theory]
    [InlineData("A. Rep\0resentative")]
    [InlineData("A. Rep\nresentative")]
    [InlineData("A.\tRepresentative")]
    public async Task A_representative_with_a_control_character_is_refused_in_words_and_nothing_is_saved(string representative)
    {
        await using var f = await SetUpAsync();

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }) with { Representative = representative }, "actor", CancellationToken.None);

        Assert.Null(result.Draft);
        var error = Assert.Single(result.Errors);
        Assert.Contains("representative", error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("control character", error);
        Assert.DoesNotContain(error, c => char.IsControl(c));        // and the character is not repeated in the message that says so
        Assert.Empty(await f.Db.ServiceAgreementDrafts.ToListAsync());
    }

    [Fact]
    public async Task A_representative_is_trimmed_and_an_ordinary_one_saves()
    {
        await using var f = await SetUpAsync();

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }) with { Representative = "  A. Representative, O'Brien-Smith  " }, "actor", CancellationToken.None);

        Assert.Equal("A. Representative, O'Brien-Smith", Assert.IsType<ServiceAgreementDraft>(result.Draft).Representative);
    }

    // ── Saving prices the blocks on the server ────────────────────────────────────

    [Fact]
    public async Task Saving_blocks_prices_them_on_the_server_and_stores_the_blocks_and_the_lines_the_engine_generated()
    {
        await using var f = await SetUpAsync();
        var gentle = Block("g", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()), Entry(gentle) }), "actor", CancellationToken.None);

        var draft = Assert.IsType<ServiceAgreementDraft>(result.Draft);
        Assert.Empty(result.Errors);
        Assert.Equal(1, draft.Version);
        var saved = await f.Db.ServiceAgreementDrafts.Include(x => x.Lines).Include(x => x.Blocks).SingleAsync();
        // The brief's proof: Mon and Wed 09:00-13:00 is 8 hours at $73.58, and Saturday 09:00-15:00 at 1:3 is $34.51 an hour.
        var lines = saved.Lines.OrderBy(x => x.Position).ToList();
        Assert.Equal(new[] { ("b1", "04_104_0125_6_1", "Weekday Daytime", 8m, 73.58m, 588.64m, 2), ("g", "04_104_0136_6_1", "Saturday", 6m, 34.51m, 207.06m, 1) },
            lines.Select(l => (l.BlockKey!, l.ItemCode, l.Band!, l.Hours, l.UnitPrice, l.Total!.Value, l.Occurrences)));
        Assert.All(lines, l => Assert.Equal("H", l.Unit));
        Assert.Equal(new[] { "Community access", "Group activity" }, lines.Select(l => l.ServiceType));
        // The catalogue provenance is the row that priced it, as for a hand-typed line.
        Assert.All(lines, l => Assert.Equal("2026-27", l.CatalogueVersion.Split(' ')[0]));
        Assert.All(lines, l => Assert.Equal(new DateOnly(2026, 7, 1), l.CatalogueEffectiveFrom));
        Assert.Equal(new[] { "b1", "g" }, saved.Blocks.OrderBy(b => b.Position).Select(b => b.BlockKey));
    }

    [Fact]
    public async Task A_block_is_stored_exactly_as_the_engine_takes_it_and_comes_back_unchanged()
    {
        await using var f = await SetUpAsync();
        var overnight = new PlanBlock
        {
            Id = "night", SupportType = PlanSupportType.PersonalCare, Days = new[] { DayOfWeek.Friday, DayOfWeek.Saturday }, Start = T(22), End = T(7), Setting = PlanSetting.AtHome,
            WorkerMaySleep = true, SleepoverWindow = new PlanSleepoverWindow { From = T(22), To = T(6) }, SleepoverActiveHours = 1.5m, OnPublicHoliday = HolidayDecision.Charge,
            ParticipantsPresent = 2, HeadcountChanges = new[] { new PlanHeadcountChange { From = T(23, 30), ParticipantsPresent = 1 } },
            Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = 25, ReturnToBase = true, KmEachWay = 12.5m, ParticipantsSharing = 2 },
            Location = new PlanLocation { State = "NSW", Zone = Odip.Domain.Enums.PriceZone.Remote, Mm = 6 },
        };
        var requirements = new DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = ["ManualHandling", "FirstAid", "ManualHandling"] };

        await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(overnight, requirements) }, Mon12Oct, new DateOnly(2026, 10, 25)), "actor", CancellationToken.None);

        var row = await f.Db.ServiceAgreementDraftBlocks.SingleAsync();
        Assert.Equal(DraftJson.Write(overnight), DraftJson.Write(DraftJson.ReadBlock(row.BlockJson)));   // nothing lost or reshaped by the round trip
        var back = DraftJson.ReadBlock(row.BlockJson);
        Assert.Equal((overnight.SupportType, overnight.Start, overnight.End, overnight.WorkerMaySleep, overnight.SleepoverActiveHours), (back.SupportType, back.Start, back.End, back.WorkerMaySleep, back.SleepoverActiveHours));
        Assert.Equal(overnight.Days, back.Days);
        Assert.Equal(overnight.SleepoverWindow, back.SleepoverWindow);
        Assert.Equal(overnight.Travel, back.Travel);
        Assert.Equal(overnight.Location, back.Location);
        Assert.Equal(overnight.HeadcountChanges.Single(), back.HeadcountChanges.Single());
        var stored = DraftJson.ReadRequirements(row.RequirementsJson);
        Assert.Equal(("Female", true, "FirstAid,ManualHandling"), (stored.WorkerGender, stored.Driver, string.Join(",", stored.Skills)));   // each skill once, in a fixed order
    }

    [Fact]
    public async Task Hours_and_totals_of_a_line_are_what_the_engine_summed_not_hours_times_price()
    {
        await using var f = await SetUpAsync();
        // 09:00 to 09:40 is 0.6667 of an hour: each occurrence is 73.58 x 40 / 60 = 49.05 (floored), so two are 98.10; 1.33 hours times 73.58 would be 97.86.
        var brief = Block("brief", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(9, 40), b => b with { Days = new[] { DayOfWeek.Monday, DayOfWeek.Wednesday } });

        await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(brief) }), "actor", CancellationToken.None);

        var line = await f.Db.ServiceAgreementDraftLines.SingleAsync();
        Assert.Equal((1.33m, 73.58m, 98.10m, 2), (line.Hours, line.UnitPrice, line.Total, line.Occurrences));
    }

    [Fact]
    public async Task What_the_engine_answered_is_kept_with_the_revision_without_its_per_occurrence_lines()
    {
        await using var f = await SetUpAsync();

        await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }), "actor", CancellationToken.None);

        var pricing = DraftJson.ReadQuote((await f.Db.ServiceAgreementDrafts.SingleAsync()).PricingJson)!;
        Assert.Empty(pricing.Lines);
        Assert.Equal((588.64m, 8m), (pricing.Totals.Amount, pricing.Totals.SupportHours));
        Assert.Contains(pricing.Notices, n => n.Code == "registration-groups-not-confirmed");   // nothing stored in the settings yet: the defaults, unconfirmed
        Assert.Equal((Mon12Oct, Sun18Oct), (pricing.PeriodFrom, pricing.PeriodTo));
    }

    [Fact]
    public async Task A_public_holiday_is_priced_at_the_holiday_item_and_kept_as_a_review_for_a_person_to_decide()
    {
        await using var f = await SetUpAsync();
        f.Db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = Mon5Oct, Name = "Labour Day", State = "NSW" });
        await f.Db.SaveChangesAsync();

        await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }, Mon5Oct, new DateOnly(2026, 10, 11)), "actor", CancellationToken.None);

        var lines = (await f.Db.ServiceAgreementDraftLines.ToListAsync()).OrderBy(l => l.ItemCode).ToList();
        // Monday 5 October is Labour Day in NSW: 4 hours at the public holiday item ($653.84, flagged), and Wednesday 7 October is an ordinary day ($294.32).
        Assert.Equal(new[] { ("04_102_0125_6_1", 653.84m), ("04_104_0125_6_1", 294.32m) }, lines.Select(l => (l.ItemCode, l.Total!.Value)));
        Assert.Equal((PlannedLineFlags.Review | PlannedLineFlags.HolidayExposure, PlannedLineFlags.None), ((PlannedLineFlags)lines[0].Flags, (PlannedLineFlags)lines[1].Flags));
        var holiday = DraftJson.ReadQuote((await f.Db.ServiceAgreementDrafts.SingleAsync()).PricingJson)!.HolidayOccurrences.Single();
        Assert.Equal((Mon5Oct, "Labour Day", HolidayDecision.Review), (holiday.Date, holiday.HolidayName, holiday.Decision));
    }

    // ── Review flags and issues are saved, not refused ────────────────────────────

    [Fact]
    public async Task A_band_with_no_item_is_saved_as_an_issue_of_the_revision_and_is_not_a_line_of_the_agreement()
    {
        await using var f = await SetUpAsync();
        // Community access has no weekday night item: Monday 22:00 to Tuesday 02:00 prices its evening and leaves its night as an unpriced line.
        var late = Block("late", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(22), T(2));

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(late) }), "actor", CancellationToken.None);

        Assert.NotNull(result.Draft);
        var line = await f.Db.ServiceAgreementDraftLines.SingleAsync();
        Assert.Equal(("Weekday Evening", 2m), (line.Band, line.Hours));   // only what was priced
        var pricing = DraftJson.ReadQuote((await f.Db.ServiceAgreementDrafts.SingleAsync()).PricingJson)!;
        var issue = Assert.Single(pricing.Issues, i => i.Reason == PlanFailureReason.NoItem);
        Assert.Equal("late", issue.BlockId);
        Assert.True(pricing.NeedsReview);
    }

    // ── What is refused, with every reason ────────────────────────────────────────

    [Fact]
    public async Task A_block_the_engine_cannot_price_refuses_the_save_and_stores_nothing()
    {
        await using var f = await SetUpAsync();
        var noDays = Block("empty", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13), b => b with { Days = Array.Empty<DayOfWeek>() });

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()), Entry(noDays) }), "actor", CancellationToken.None);

        Assert.Null(result.Draft);
        Assert.Contains(result.Errors, e => e.Contains("choose at least one day") && e.Contains("empty"));
        Assert.Empty(f.Db.ServiceAgreementDrafts);
        Assert.Empty(f.Db.ServiceAgreementDraftBlocks);
    }

    [Fact]
    public async Task A_support_family_the_provider_does_not_hold_is_refused_with_that_reason()
    {
        await using var f = await SetUpAsync();
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = f.TenantId, RegistrationGroupsHeld = "0107,0104", RegistrationGroupsConfirmed = true });
        await f.Db.SaveChangesAsync();

        var result = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }), "actor", CancellationToken.None);

        Assert.Null(result.Draft);
        Assert.Contains(result.Errors, e => e.Contains("0125"));
        Assert.Empty(f.Db.ServiceAgreementDrafts);
    }

    [Fact]
    public async Task Duplicate_block_ids_a_second_state_unknown_requirements_and_a_missing_plan_each_refuse_the_save()
    {
        await using var f = await SetUpAsync();
        var save = (CreateServiceAgreementDraftDto request) => f.Service.SaveAsync(f.TenantId, f.Participant.Id, request, "actor", CancellationToken.None);

        var duplicate = await save(Request(new[] { Entry(MonWed("same")), Entry(MonWed("same")) }));
        var otherState = await save(Request(new[] { Entry(MonWed() with { Location = new PlanLocation { State = "VIC" } }) }));
        var gender = await save(Request(new[] { Entry(MonWed(), new DraftBlockRequirementsDto { WorkerGender = "Somebody" }) }));
        var skill = await save(Request(new[] { Entry(MonWed(), new DraftBlockRequirementsDto { Skills = ["Juggling"] }) }));
        var neither = await save(Request(Array.Empty<DraftBlockDto>()));
        var both = await save(Request(new[] { Entry(MonWed()) }) with { Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "x", ItemCode = "y", Hours = 1m }] });
        var tooLong = await save(Request(new[] { Entry(MonWed()) }, Mon12Oct, Mon12Oct.AddDays(900)));

        Assert.Contains(duplicate.Errors, e => e.Contains("same"));
        Assert.Contains(otherState.Errors, e => e.Contains("delivery state must be NSW"));
        Assert.Contains(gender.Errors, e => e.Contains("worker gender"));
        Assert.Contains(skill.Errors, e => e.Contains("skill"));
        Assert.Equal("Add at least one support block.", Assert.Single(neither.Errors));
        Assert.Equal("Send the support blocks or the hand-typed lines, not both.", Assert.Single(both.Errors));
        Assert.Contains(tooLong.Errors, e => e.Contains("longer than 800 days"));
        Assert.Empty(f.Db.ServiceAgreementDrafts);
    }

    [Fact]
    public async Task End_dates_before_start_dates_and_another_tenants_participant_are_refused_as_before()
    {
        await using var f = await SetUpAsync();
        var backwards = Request(new[] { Entry(MonWed()) }, Sun18Oct, Mon12Oct);

        var dates = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, backwards, "actor", CancellationToken.None);
        var foreign = await f.Service.SaveAsync(TenantB, f.Participant.Id, Request(new[] { Entry(MonWed()) }), "actor", CancellationToken.None);

        Assert.Equal("End dates must not precede start dates.", Assert.Single(dates.Errors));
        Assert.True(foreign.NotFound);
        Assert.Equal("Participant not found.", Assert.Single(foreign.Errors));
        Assert.Empty(f.Db.ServiceAgreementDrafts.IgnoreQueryFilters());
    }

    // ── A revision is immutable ───────────────────────────────────────────────────

    /// <summary>
    /// Records that a person approved the revision. That is what keeps a revision when a later save replaces the participant's older ones that did nothing (DraftPruningTests): the tests
    /// below that read an older revision approve it first.
    /// </summary>
    private static async Task ApproveAsync(Fixture f, int version)
    {
        var draft = await f.Db.ServiceAgreementDrafts.SingleAsync(d => d.ParticipantId == f.Participant.Id && d.Version == version);
        f.Db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
        {
            Id = Guid.NewGuid(), TenantId = f.TenantId, DraftId = draft.Id, ParticipantId = f.Participant.Id, DraftVersion = version,
            ApprovedAt = new DateTime(2026, 10, 5, 1, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex Admin",
        });
        await f.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task Every_save_is_a_new_revision_and_an_approved_earlier_one_keeps_its_blocks_lines_and_answer()
    {
        await using var f = await SetUpAsync();
        await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()) }), "actor", CancellationToken.None);
        await ApproveAsync(f, 1);
        var before = await Snapshot(f.Db, 1);

        // The coordinator adds a Saturday outing and saves again; and the catalogue's weekday price moves in between (a later import).
        foreach (var row in f.Db.SupportCatalogueItems.Where(i => i.ItemNumber == "04_104_0125_6_1")) row.PriceNational += 5m;
        await f.Db.SaveChangesAsync();
        var saturday = Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });
        var second = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed()), Entry(saturday) }), "actor", CancellationToken.None);

        Assert.Equal(2, second.Draft!.Version);
        Assert.Equal(before, await Snapshot(f.Db, 1));   // version 1 is byte for byte what it was
        Assert.Equal(1, (await f.Db.ServiceAgreementDraftBlocks.Where(b => b.Draft!.Version == 1).ToListAsync()).Count);
        Assert.Equal(2, (await f.Db.ServiceAgreementDraftBlocks.Where(b => b.Draft!.Version == 2).ToListAsync()).Count);
        Assert.Equal(73.58m, (await f.Db.ServiceAgreementDraftLines.Where(l => l.Draft!.Version == 1).SingleAsync()).UnitPrice);   // the price it was saved at
    }

    private static async Task<string> Snapshot(OdipDbContext db, int version)
    {
        var draft = await db.ServiceAgreementDrafts.Include(d => d.Blocks).Include(d => d.Lines).SingleAsync(d => d.Version == version);
        return JsonSerializer.Serialize(new
        {
            draft.PricingJson, draft.ServiceTypesJson,
            Blocks = draft.Blocks.OrderBy(b => b.Position).Select(b => new { b.BlockKey, b.BlockJson, b.RequirementsJson }),
            Lines = draft.Lines.OrderBy(l => l.Position).Select(l => new { l.ItemCode, l.Band, l.Hours, l.UnitPrice, l.Total, l.Occurrences, l.Flags, l.CatalogueVersion }),
        });
    }

    // ── A save names the version it started from (review F3) ──────────────────────

    private static Task<DraftSaveResult> SaveFrom(Fixture f, int? baseVersion, params DraftBlockDto[] blocks) =>
        f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(blocks) with { BaseVersion = baseVersion }, "actor", CancellationToken.None);

    [Fact]
    public async Task A_save_that_started_from_an_older_version_is_refused_with_the_newer_version_and_stores_nothing()
    {
        await using var f = await SetUpAsync();
        var saturday = Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });
        Assert.Equal(1, (await SaveFrom(f, 0, Entry(MonWed()))).Draft!.Version);                         // the first save starts from nothing
        Assert.Equal(2, (await SaveFrom(f, 1, Entry(MonWed()), Entry(saturday))).Draft!.Version);        // A started from version 1 and saves version 2

        var stale = await SaveFrom(f, 1, Entry(MonWed()));                                               // B also started from version 1

        Assert.Null(stale.Draft);
        Assert.Equal(2, stale.ConflictVersion);
        Assert.Contains("Version 2", Assert.Single(stale.Errors));
        Assert.Equal(new[] { 2 }, f.Db.ServiceAgreementDrafts.OrderBy(d => d.Version).Select(d => d.Version).ToList());   // A's save replaced version 1 (nobody approved it); B's plan was not stored as version 3
    }

    [Fact]
    public async Task A_save_that_started_from_the_newest_version_is_accepted_and_one_that_names_no_version_is_not_checked()
    {
        await using var f = await SetUpAsync();

        var first = await SaveFrom(f, 0, Entry(MonWed()));
        var second = await SaveFrom(f, 1, Entry(MonWed()));
        var unchecked_ = await SaveFrom(f, null, Entry(MonWed()));       // a caller that predates the builder

        Assert.Equal(new[] { 1, 2, 3 }, new[] { first.Draft!.Version, second.Draft!.Version, unchecked_.Draft!.Version });
        Assert.Null(unchecked_.ConflictVersion);
    }

    [Fact]
    public async Task A_base_version_ahead_of_the_newest_is_a_conflict_too_it_names_a_version_that_does_not_exist()
    {
        await using var f = await SetUpAsync();
        await SaveFrom(f, 0, Entry(MonWed()));

        var ahead = await SaveFrom(f, 5, Entry(MonWed()));

        Assert.Equal(1, ahead.ConflictVersion);
        Assert.Single(f.Db.ServiceAgreementDrafts);
    }

    /// <summary>On the first save that inserts a draft, commits the competing save's draft through another context and then fails the way PostgreSQL does (the unique index on tenant, participant and version refuses the second one).</summary>
    private sealed class DraftVersionRaceInterceptor(Func<Task> beforeThrow) : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData, Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var inserting = eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraft>().Any(entry => entry.State == EntityState.Added);
            if (_fired || !inserting) return result;
            _fired = true;
            await beforeThrow();
            throw new DbUpdateException("duplicate key value violates unique constraint", new Npgsql.PostgresException(
                messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: Npgsql.PostgresErrorCodes.UniqueViolation, tableName: "ServiceAgreementDrafts", constraintName: "IX_ServiceAgreementDrafts_TenantId_ParticipantId_Version"));
        }
    }

    [Fact]
    public async Task Two_saves_racing_for_one_version_answer_the_loser_with_a_conflict_not_a_server_error()
    {
        await using var f = await SetUpAsync();
        var winner = new DraftVersionRaceInterceptor(async () =>
        {
            await using var other = NewContext(f.DbName, f.TenantId);
            await new ServiceAgreementDraftService(other).SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed("winner")) }), "someone-else", CancellationToken.None);
        });
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(f.TenantId);
        await using var loserDb = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(f.DbName).AddInterceptors(winner).Options, tenant.Object);

        var loser = await new ServiceAgreementDraftService(loserDb).SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed("loser")) }), "me", CancellationToken.None);

        Assert.Null(loser.Draft);
        Assert.Equal(1, loser.ConflictVersion);                      // the winner's version is the newest now
        var stored = Assert.Single(await f.Db.ServiceAgreementDrafts.Include(d => d.Blocks).ToListAsync());
        Assert.Equal("winner", Assert.Single(stored.Blocks).BlockKey);   // and the loser stored nothing
    }

    [Fact]
    public async Task The_409_is_the_apps_envelope_with_a_code_the_newer_version_and_words_for_a_person()
    {
        await using var f = await SetUpAsync();
        await SaveFrom(f, 0, Entry(MonWed()));
        await SaveFrom(f, 1, Entry(MonWed()));

        var result = await Controller(f).Create(f.Participant.Id, Request(new[] { Entry(MonWed()) }) with { BaseVersion = 1 }, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<DraftVersionConflictDto>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Equal("draft-version-conflict", body.Code);
        Assert.Equal(2, body.Data!.CurrentVersion);
        Assert.Contains("Version 2 was saved after the version this plan started from", Assert.Single(body.Errors!));
        var json = JsonSerializer.Serialize(body, ApiOptions());
        Assert.Contains("\"data\":{\"currentVersion\":2}", json);
        Assert.Contains("\"code\":\"draft-version-conflict\"", json);
    }

    // ── An id with a control character is refused by the save (review F6) ─────────

    [Fact]
    public async Task A_block_id_with_a_NUL_or_a_line_break_is_a_refusal_the_screen_can_show_not_a_database_error()
    {
        await using var f = await SetUpAsync();

        var nul = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed("a\0b")) }), "actor", CancellationToken.None);
        var lineBreak = await f.Service.SaveAsync(f.TenantId, f.Participant.Id, Request(new[] { Entry(MonWed("a\nb")) }), "actor", CancellationToken.None);

        Assert.Null(nul.Draft);
        Assert.Contains(nul.Errors, e => e.Contains("control character"));
        Assert.Contains(lineBreak.Errors, e => e.Contains("control character"));
        Assert.All(nul.Errors.Concat(lineBreak.Errors), e => Assert.DoesNotContain(e, c => char.IsControl(c)));
        Assert.Empty(f.Db.ServiceAgreementDrafts);
    }

    // ── What is stored keeps reading (review F15: an unreadable block comes back as an empty one, in silence) ──

    [Fact]
    public void A_revision_stored_today_reads_back_from_its_golden_json_so_renaming_a_member_of_the_model_fails_here_and_not_in_silence()
    {
        // As DraftJson.Write wrote them on 3 Oct 2026. If an enum member or a property is renamed, an old revision's blocks would come back empty; this test says so first.
        const string block = """{"id":"b1","supportType":"CommunityAccess","intensity":"Standard","days":["Monday","Wednesday"],"start":"09:00:00","end":"13:00:00","workers":1,"participantsPresent":1,"headcountChanges":[],"setting":"Community","location":{"state":"NSW","zone":"National"},"workerMaySleep":false,"sleepoverActiveHours":0,"onPublicHoliday":"Review","travel":{"claim":true,"minutesEachWay":20,"returnToBase":true,"kmEachWay":8.5},"transport":{"km":20,"vehicle":"Standard","tolls":0,"parking":4.5,"participantsSharing":1},"maxLinesPerOccurrence":6,"endsNextDay":false,"durationMinutes":240}""";
        const string requirements = """{"workerGender":"Female","driver":true,"skills":["FirstAid"]}""";
        const string answer = """{"periodFrom":"2026-10-12","periodTo":"2026-10-18","lines":[],"issues":[{"blockId":"b1","reason":"NoItem","message":"Block 'b1': no item.","count":3,"firstDate":"2026-10-13"}],"notices":[{"code":"registration-groups-not-confirmed","message":"The registration groups the provider holds have not been confirmed.","openQuestion":1}],"holidayOccurrences":[{"blockId":"b1","date":"2026-10-05","holidayName":"Labour Day","state":"NSW","decision":"Review","skipped":false}],"openQuestions":[{"number":1,"text":"Which registration groups does the provider hold?"},{"number":6,"text":"Travel caps."}],"totals":{"amount":769.00,"supportHours":8,"lineCount":8,"unpricedLines":0,"reviewLines":0,"provisionalLines":6,"holidayOccurrences":0,"holidayUplift":0,"byCategory":[{"paceCategory":4,"name":"Assistance with Social, Economic and Community Participation","amount":769.00,"hours":8}],"byBlock":[{"blockId":"b1","amount":769.00,"supportHours":8,"occurrences":2,"skippedOccurrences":0}]},"timeBasis":"tz-database","needsReview":false}""";

        var read = DraftJson.ReadBlock(block);

        Assert.Equal(("b1", PlanSupportType.CommunityAccess, Odip.Domain.Enums.SupportIntensity.Standard, PlanSetting.Community, HolidayDecision.Review), (read.Id, read.SupportType, read.Intensity, read.Setting, read.OnPublicHoliday));
        Assert.Equal(new[] { DayOfWeek.Monday, DayOfWeek.Wednesday }, read.Days);
        Assert.Equal((T(9), T(13)), (read.Start, read.End));
        Assert.Equal(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, ReturnToBase = true, KmEachWay = 8.5m }, read.Travel);
        Assert.Equal(new PlanActivityTransport { Km = 20m, Parking = 4.5m, ParticipantsSharing = 1 }, read.Transport);
        Assert.Equal(new PlanLocation { State = "NSW" }, read.Location);
        Assert.Equal(("Female", true, "FirstAid"), (DraftJson.ReadRequirements(requirements).WorkerGender, DraftJson.ReadRequirements(requirements).Driver, Assert.Single(DraftJson.ReadRequirements(requirements).Skills)));

        var quote = DraftJson.ReadQuote(answer)!;
        Assert.Equal(769.00m, quote.Totals.Amount);
        var issue = Assert.Single(quote.Issues);
        Assert.Equal((PlanFailureReason.NoItem, 3, new DateOnly(2026, 10, 13)), (issue.Reason, issue.Count, issue.FirstDate!.Value));
        Assert.Equal("registration-groups-not-confirmed", Assert.Single(quote.Notices).Code);
        Assert.Equal(new[] { 1, 6 }, quote.OpenQuestions.Select(q => q.Number));
        Assert.Equal("Labour Day", Assert.Single(quote.HolidayOccurrences).HolidayName);
        Assert.Equal(4, Assert.Single(quote.Totals.ByCategory).PaceCategory);
    }

    // Review F21: an unreadable stored block came back as an empty block with no signal.
    [Fact]
    public async Task A_stored_block_that_can_no_longer_be_read_says_so_and_is_not_an_empty_block_that_looks_planned()
    {
        await using var f = await SetUpAsync();
        await SaveFrom(f, 0, Entry(MonWed()), Entry(Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15))));
        var stored = f.Db.ServiceAgreementDraftBlocks.Single(b => b.BlockKey == "sat");
        stored.BlockJson = """{"id":"sat","supportType":"ARenamedMember","days":["Saturday"]}""";
        await f.Db.SaveChangesAsync();

        var newest = Assert.Single(await ListedAsync(Controller(f), f.Participant.Id));

        Assert.Equal(new[] { false, true }, newest.Blocks.Select(b => b.Unreadable));
        Assert.Equal("b1", newest.Blocks[0].Block.Id);
        Assert.Equal(string.Empty, newest.Blocks[1].Block.Id);                  // empty, and flagged
    }

    // ── Stored lines against a re-quote, by value (the comparison DraftBlocksPostgresTests makes; CI found numeric(12,2) reading 8 hours back as 8.00) ──

    private static ServiceAgreementDraftLine LineOf(decimal hours, decimal total = 588.64m, string item = "04_104_0125_6_1", string band = "Weekday Daytime") => new()
    {
        BlockKey = "b1", ItemCode = item, Band = band, Unit = "H", UnitPrice = 73.58m, Hours = hours, Total = total, Occurrences = 2, Flags = 0, CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1),
    };

    [Fact]
    public void Lines_that_differ_only_in_the_scale_of_a_decimal_are_the_same_lines_though_their_JSON_is_not()
    {
        var read = new[] { LineOf(8.00m, 588.64m) };                // what numeric(12,2) and numeric(14,2) hand back
        var fresh = new[] { LineOf(8m, 588.640m) };                 // what the engine has just produced

        Assert.NotEqual(JsonSerializer.Serialize(read[0].Hours), JsonSerializer.Serialize(fresh[0].Hours));     // why comparing the serialised lines failed on Postgres
        AssertSameLinesByValue(read, fresh);
    }

    // The Postgres test's own scenario (the brief's block and a Saturday outing over a week) through the same two-decimal columns, modelled: each stored number at exactly two places, which is what numeric(12,2)
    // and numeric(14,2) hand back. The lines are the engine's real ones; if any held a third decimal place, the column would round it and this would fail, as the Postgres test would.
    [Fact]
    public void The_engines_lines_for_two_blocks_come_back_from_two_decimal_columns_equal_in_value()
    {
        var blocks = new[] { MonWed(), Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 }) };
        var fresh = ServiceAgreementDraftService.GroupLines(Quote(blocks, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 18)), blocks).ToList();

        static decimal TwoPlaces(decimal value) => decimal.Parse(value.ToString("F2", System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture);
        var read = fresh.Select(l => new ServiceAgreementDraftLine
        {
            ServiceType = l.ServiceType, BlockKey = l.BlockKey, Band = l.Band, ItemCode = l.ItemCode, Unit = l.Unit, UnitPrice = TwoPlaces(l.UnitPrice), Hours = TwoPlaces(l.Hours),
            Total = l.Total is { } total ? TwoPlaces(total) : null, Occurrences = l.Occurrences, Flags = l.Flags, CatalogueVersion = l.CatalogueVersion, CatalogueEffectiveFrom = l.CatalogueEffectiveFrom,
        }).ToList();

        Assert.Equal(new[] { "b1", "sat" }, fresh.Select(l => l.BlockKey).Distinct());
        Assert.Contains(read, l => l.Hours.ToString(System.Globalization.CultureInfo.InvariantCulture) == "8.00");      // the stored side reads 8.00, as Postgres hands it back ...
        AssertSameLinesByValue(read, fresh);                                                                           // ... and the lines are the same lines
    }

    [Fact]
    public void A_value_the_column_would_round_still_differs_and_the_failure_names_the_line_and_the_field()
    {
        var stored = new[] { LineOf(8m), LineOf(0.33m, item: "04_102_0125_6_1") };
        var fresh = new[] { LineOf(8m), LineOf(0.333m, item: "04_102_0125_6_1") };     // numeric(12,2) stores 0.33; the engine never meant 0.33

        var failure = Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => AssertSameLinesByValue(stored, fresh));

        Assert.Contains("line 1 (b1 04_102_0125_6_1), Hours: stored 0.33, re-quoted 0.333", failure.Message);
    }

    [Fact]
    public void A_field_that_is_not_a_number_is_compared_exactly_and_named_too()
    {
        var failure = Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => AssertSameLinesByValue(new[] { LineOf(8m) }, new[] { LineOf(8m, band: "Saturday") }));

        Assert.Contains("line 0 (b1 04_104_0125_6_1), Band: stored Weekday Daytime, re-quoted Saturday", failure.Message);
    }

    [Fact]
    public void A_line_that_is_missing_is_said_with_both_counts()
    {
        var failure = Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => AssertSameLinesByValue(new[] { LineOf(8m) }, new[] { LineOf(8m), LineOf(6m) }));

        Assert.Contains("1 lines stored, 2 from the re-quote", failure.Message);
    }

    // ── The list: the newest revision in full, the older ones as summaries (review F12) ──

    private static async Task<List<ServiceAgreementDraftDto>> ListedAsync(ServiceAgreementDraftsController controller, Guid participantId) =>
        Assert.IsType<ApiResponse<List<ServiceAgreementDraftDto>>>(Assert.IsType<OkObjectResult>((await controller.List(participantId, CancellationToken.None)).Result).Value).Data!;

    [Fact]
    public async Task The_list_has_the_newest_revision_in_full_and_older_ones_as_summaries_with_no_blocks_lines_or_answer()
    {
        await using var f = await SetUpAsync();
        var saturday = Block("sat", PlanSupportType.GroupActivity, DayOfWeek.Saturday, T(9), T(15), b => b with { ParticipantsPresent = 3 });
        await SaveFrom(f, 0, Entry(MonWed()));
        await ApproveAsync(f, 1);
        await SaveFrom(f, 1, Entry(MonWed()), Entry(saturday));
        await ApproveAsync(f, 2);
        await SaveFrom(f, 2, Entry(MonWed()), Entry(saturday));

        var listed = await ListedAsync(Controller(f), f.Participant.Id);

        Assert.Equal(new[] { 3, 2, 1 }, listed.Select(d => d.Version));
        var newest = listed[0];
        Assert.False(newest.IsSummary);
        Assert.Equal(2, newest.Blocks.Count);
        Assert.Equal(2, newest.Lines.Count);
        Assert.NotNull(newest.Pricing);
        Assert.Equal((2, 2), (newest.BlockCount, newest.LineCount));
        Assert.Equal(newest.Lines.Sum(l => l.Total), newest.Total);
        foreach (var older in listed.Skip(1))
        {
            Assert.True(older.IsSummary);
            Assert.Empty(older.Blocks);
            Assert.Empty(older.Lines);
            Assert.Null(older.Pricing);
            Assert.True(older.Total > 0m);                                     // but it still says what it came to
        }
        Assert.Equal((2, 2), (listed[1].BlockCount, listed[1].LineCount));      // version 2 had both blocks
        Assert.Equal((1, 1), (listed[2].BlockCount, listed[2].LineCount));      // version 1 had one
        Assert.Equal(588.64m, listed[2].Total);
    }

    [Fact]
    public async Task A_summary_carries_the_caveats_of_its_answer_and_a_hand_typed_one_says_what_it_is()
    {
        await using var f = await SetUpAsync();
        f.Db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = f.TenantId, ParticipantId = f.Participant.Id, Version = 1, State = "NSW", ServiceTypesJson = "[]", ParticipantNameSnapshot = "Synthetic Participant", CreatedBy = "t",
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30),
            Lines = { new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = "x", ItemCode = "TEST", Hours = 2.5m, UnitPrice = 20.55m, CatalogueVersion = "t", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1) } },
        });
        await f.Db.SaveChangesAsync();
        await ApproveAsync(f, 1);
        await SaveFrom(f, 1, Entry(MonWed()));

        var listed = await ListedAsync(Controller(f), f.Participant.Id);

        var byHand = listed[1];
        Assert.True(byHand.IsSummary);
        Assert.Equal((0, 1, 51.37m), (byHand.BlockCount, byHand.LineCount, byHand.Total));       // floor(2.5 x 20.55 = 51.375), as for a full hand-typed line
        Assert.Empty(byHand.Caveats);
        Assert.Contains(listed[0].Pricing!.Notices, n => n.Message.Contains("registration groups"));   // the newest keeps its notices in full
    }

    [Fact]
    public async Task One_revision_in_full_is_one_get_away_for_an_older_one_and_only_for_its_own_participant_and_tenant()
    {
        await using var f = await SetUpAsync();
        await SaveFrom(f, 0, Entry(MonWed()));
        await ApproveAsync(f, 1);
        await SaveFrom(f, 1, Entry(MonWed()));
        var older = (await ListedAsync(Controller(f), f.Participant.Id)).Single(d => d.Version == 1);

        var result = await Controller(f).Get(f.Participant.Id, older.Id, CancellationToken.None);

        var full = Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.False(full.IsSummary);
        Assert.Single(full.Blocks);
        Assert.Single(full.Lines);
        Assert.NotNull(full.Pricing);
        // another participant's id under this participant, an id that does not exist, and another tenant's user: not found
        Assert.IsType<NotFoundObjectResult>((await Controller(f).Get(Guid.NewGuid(), older.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(f).Get(f.Participant.Id, Guid.NewGuid(), CancellationToken.None)).Result);
        await using var other = NewContext(f.DbName, TenantB);
        var asB = new ServiceAgreementDraftsController(other, TenantOf(TenantB), new ServiceAgreementDraftService(other));
        Assert.IsType<NotFoundObjectResult>((await asB.Get(f.Participant.Id, older.Id, CancellationToken.None)).Result);
    }

    // ── A save holds a permit of its own (review F12) ─────────────────────────────

    [Fact]
    public async Task Saving_blocks_takes_one_of_the_organisations_save_permits_and_a_burst_is_told_to_try_again()
    {
        await using var f = await SetUpAsync();
        using var limiter = new Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter(permits: 1);
        var inFlight = limiter.TryEnter("save:tenant:" + f.TenantId.ToString("N"));   // another save of this organisation is being priced
        var controller = Controller(f, limiter);

        var busy = await controller.Create(f.Participant.Id, Request(new[] { Entry(MonWed()) }), CancellationToken.None);

        var refused = Assert.IsType<ObjectResult>(busy.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, refused.StatusCode);
        Assert.Equal("1", controller.Response.Headers.RetryAfter.ToString());
        Assert.False(Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(refused.Value).Success);
        Assert.Empty(f.Db.ServiceAgreementDrafts);
        // The quote's own permits are a different partition: a save does not use them up, and they do not hold a save back.
        using var quote = limiter.TryEnter("tenant:" + f.TenantId.ToString("N"));
        Assert.True(quote.IsAcquired);
        // Once the other save has finished the permit is free again, and this save releases it when it ends.
        inFlight.Dispose();
        var saved = await controller.Create(f.Participant.Id, Request(new[] { Entry(MonWed()) }), CancellationToken.None);
        Assert.IsType<OkObjectResult>(saved.Result);
        using var after = limiter.TryEnter("save:tenant:" + f.TenantId.ToString("N"));
        Assert.True(after.IsAcquired);
    }

    [Fact]
    public async Task A_hand_typed_save_does_not_need_a_permit_it_is_not_the_heavy_work()
    {
        await using var f = await SetUpAsync();
        using var limiter = new Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter(permits: 1);
        using var inFlight = limiter.TryEnter("save:tenant:" + f.TenantId.ToString("N"));
        var request = new CreateServiceAgreementDraftDto { PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30), State = "NSW", Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "x", ItemCode = "nope", Hours = 1m }] };

        var result = await Controller(f, limiter).Create(f.Participant.Id, request, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);   // refused for its own reason (no such item), not told to wait
    }

    // ── Hand-typed drafts keep working ────────────────────────────────────────────

    [Fact]
    public async Task A_hand_typed_draft_has_no_blocks_no_answer_and_a_total_of_hours_times_price()
    {
        await using var f = await SetUpAsync();
        f.Db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = f.Db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 }).Entity.Id,
            ItemNumber = "TEST-CODE", Description = "Synthetic", DayType = Odip.Domain.Enums.ClaimDayType.Weekday, Unit = "H", IsActive = true, CatalogueVersion = "synthetic-v1",
            EffectiveFrom = new DateOnly(2025, 1, 1), PriceLimit_NSW = 20.55m,
        });
        await f.Db.SaveChangesAsync();
        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30), State = "NSW",
            ServiceTypes = ["Synthetic support"], Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Synthetic support", ItemCode = "TEST-CODE", Hours = 2.5m }],
        };
        var (draft, error) = await f.Service.CreateAsync(f.TenantId, f.Participant.Id, request, "actor", CancellationToken.None);
        Assert.Null(error);

        var dto = Assert.IsType<OkObjectResult>(((await Controller(f).List(f.Participant.Id, CancellationToken.None)).Result)).Value as ApiResponse<List<ServiceAgreementDraftDto>>;
        var listed = Assert.Single(dto!.Data!);
        Assert.Equal(draft!.Id, listed.Id);
        Assert.Empty(listed.Blocks);
        Assert.Null(listed.Pricing);
        var line = Assert.Single(listed.Lines);
        Assert.Equal((2.5m, 20.55m, 51.37m, "H", 0, null), (line.Hours, line.UnitPrice, line.Total, line.Unit, line.Occurrences, line.BlockId));   // floor(2.5 x 20.55 = 51.375)
    }

    // ── Tenant scoping ────────────────────────────────────────────────────────────

    [Fact]
    public async Task One_tenant_never_reads_another_tenants_blocks_or_lines()
    {
        await using var a = await SetUpAsync(TenantA);
        await a.Service.SaveAsync(a.TenantId, a.Participant.Id, Request(new[] { Entry(MonWed()) }), "actor", CancellationToken.None);
        await using var other = NewContext(a.DbName, TenantB);
        var asB = new ServiceAgreementDraftsController(other, TenantOf(TenantB), new ServiceAgreementDraftService(other));

        var list = Assert.IsType<OkObjectResult>((await asB.List(a.Participant.Id, CancellationToken.None)).Result).Value as ApiResponse<List<ServiceAgreementDraftDto>>;

        Assert.Empty(list!.Data!);
        Assert.Empty(other.ServiceAgreementDrafts);
        var own = Assert.IsType<OkObjectResult>((await Controller(a).List(a.Participant.Id, CancellationToken.None)).Result).Value as ApiResponse<List<ServiceAgreementDraftDto>>;
        Assert.Single(Assert.Single(own!.Data!).Blocks);
    }

    // ── The payload (the wire both ways) ──────────────────────────────────────────

    private static JsonSerializerOptions ApiOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    [Fact]
    public void The_request_the_screen_sends_binds_to_the_create_dto_with_blocks_in_the_engines_own_shape()
    {
        // What the React client posts: names in camel case, enums as their names, local times as HH:mm:ss, no price and no item code anywhere.
        const string body = """
        {
          "planStartDate": "2026-07-01", "planEndDate": "2027-06-30", "agreementStartDate": "2026-07-01", "agreementEndDate": "2027-06-30",
          "state": "NSW", "serviceTypes": ["Community access"], "representative": "A. Representative", "baseVersion": 3,
          "blocks": [ {
            "block": {
              "id": "b1", "supportType": "CommunityAccess", "intensity": "Standard", "days": ["Monday", "Wednesday"], "start": "09:00:00", "end": "13:00:00",
              "workers": 1, "participantsPresent": 1, "headcountChanges": [], "setting": "Community", "location": { "state": "NSW", "zone": "National" },
              "workerMaySleep": false, "sleepoverActiveHours": 0, "onPublicHoliday": "Review",
              "travel": { "claim": true, "minutesEachWay": 20, "returnToBase": true, "kmEachWay": 8.5 },
              "transport": { "km": 20, "vehicle": "Standard", "tolls": 0, "parking": 4.5, "participantsSharing": 1 }
            },
            "requirements": { "workerGender": "Female", "driver": true, "skills": ["FirstAid"] }
          } ]
        }
        """;

        var dto = JsonSerializer.Deserialize<CreateServiceAgreementDraftDto>(body, ApiOptions())!;

        Assert.Equal(3, dto.BaseVersion);   // the version of the newest revision the page loaded
        var entry = Assert.Single(dto.Blocks!);
        Assert.Equal(("b1", PlanSupportType.CommunityAccess, T(9), T(13)), (entry.Block.Id, entry.Block.SupportType, entry.Block.Start, entry.Block.End));
        Assert.Equal(new[] { DayOfWeek.Monday, DayOfWeek.Wednesday }, entry.Block.Days);
        Assert.Equal(new PlanProviderTravel { Claim = true, MinutesEachWay = 20, ReturnToBase = true, KmEachWay = 8.5m }, entry.Block.Travel);
        Assert.Equal(new PlanActivityTransport { Km = 20m, Parking = 4.5m, ParticipantsSharing = 1 }, entry.Block.Transport);
        Assert.Equal(("Female", true, "FirstAid"), (entry.Requirements.WorkerGender, entry.Requirements.Driver, Assert.Single(entry.Requirements.Skills)));
        Assert.Empty(dto.Lines);
    }

    [Fact]
    public async Task The_draft_the_server_returns_carries_its_blocks_lines_totals_and_answer_in_the_shape_the_screen_reads()
    {
        await using var f = await SetUpAsync();
        var created = await Controller(f).Create(f.Participant.Id, Request(new[] { Entry(MonWed(), new DraftBlockRequirementsDto { WorkerGender = "Male", Driver = true, Skills = ["MedicationCompetent"] }) }), CancellationToken.None);
        var response = Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(Assert.IsType<OkObjectResult>(created.Result).Value);

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(response, ApiOptions()));
        var data = json.RootElement.GetProperty("data");

        Assert.Equal(("2026-07-01", "2027-06-30", "NSW", "A. Representative", 1), (data.GetProperty("planStartDate").GetString(), data.GetProperty("planEndDate").GetString(), data.GetProperty("state").GetString(), data.GetProperty("representative").GetString(), data.GetProperty("version").GetInt32()));
        var block = data.GetProperty("blocks")[0];
        Assert.Equal(("b1", "CommunityAccess", "09:00:00", "13:00:00", "Monday"), (block.GetProperty("block").GetProperty("id").GetString(), block.GetProperty("block").GetProperty("supportType").GetString(),
            block.GetProperty("block").GetProperty("start").GetString(), block.GetProperty("block").GetProperty("end").GetString(), block.GetProperty("block").GetProperty("days")[0].GetString()));
        Assert.Equal(("Male", true), (block.GetProperty("requirements").GetProperty("workerGender").GetString(), block.GetProperty("requirements").GetProperty("driver").GetBoolean()));
        var line = data.GetProperty("lines")[0];
        Assert.Equal(("04_104_0125_6_1", "Weekday Daytime", "H", 8m, 588.64m, 73.58m, 2, "None", "b1"),
            (line.GetProperty("itemCode").GetString(), line.GetProperty("band").GetString(), line.GetProperty("unit").GetString(), line.GetProperty("hours").GetDecimal(), line.GetProperty("total").GetDecimal(),
             line.GetProperty("unitPrice").GetDecimal(), line.GetProperty("occurrences").GetInt32(), line.GetProperty("flags").GetString(), line.GetProperty("blockId").GetString()));
        var pricing = data.GetProperty("pricing");
        Assert.Equal((588.64m, 8m, 0), (pricing.GetProperty("totals").GetProperty("amount").GetDecimal(), pricing.GetProperty("totals").GetProperty("supportHours").GetDecimal(), pricing.GetProperty("lines").GetArrayLength()));
        Assert.Contains(pricing.GetProperty("timeBasis").GetString(), new[] { PlanTimeBasis.TzDatabase, PlanTimeBasis.FixedOffset });
        Assert.Contains(pricing.GetProperty("notices").EnumerateArray().Select(n => n.GetProperty("code").GetString()), code => code == "registration-groups-not-confirmed");
    }

    // ── The migration ─────────────────────────────────────────────────────────────

    [Fact]
    public void The_migration_is_additive_one_new_table_and_new_columns_that_read_as_they_always_did_on_every_existing_row()
    {
        var type = typeof(OdipDbContext).Assembly.GetTypes().Single(t => t.Name == "AddServiceAgreementDraftBlocks" && typeof(Migration).IsAssignableFrom(t));
        var migration = (Migration)Activator.CreateInstance(type)!;

        Assert.All(migration.UpOperations, op => Assert.True(op is CreateTableOperation or CreateIndexOperation or AddColumnOperation, $"{op.GetType().Name} could change existing data"));
        Assert.Equal("ServiceAgreementDraftBlocks", Assert.Single(migration.UpOperations.OfType<CreateTableOperation>()).Name);
        Assert.All(migration.UpOperations.OfType<CreateIndexOperation>(), i => Assert.Equal("ServiceAgreementDraftBlocks", i.Table));
        var added = migration.UpOperations.OfType<AddColumnOperation>().ToList();
        Assert.Equal(new[] { "ServiceAgreementDraftLines", "ServiceAgreementDrafts" }, added.Select(c => c.Table).Distinct().OrderBy(t => t));
        // An old row gets null, or the value it always meant: a hand-typed line is priced by the hour, is first in its draft and has no flags.
        Assert.All(added, c => Assert.True(c.IsNullable || c.DefaultValue is not null, $"{c.Table}.{c.Name} would refuse an existing row"));
        Assert.Equal("H", added.Single(c => c.Name == "Unit").DefaultValue);
        Assert.Equal(new[] { "Band", "BlockKey", "Flags", "Occurrences", "Position", "PricingJson", "Total", "Unit" }, added.Select(c => c.Name).OrderBy(n => n));
        Assert.Equal(new[] { "ServiceAgreementDraftBlocks" }, migration.DownOperations.OfType<DropTableOperation>().Select(o => o.Name));
    }

    // ── Who may save, and how much ────────────────────────────────────────────────

    [Fact]
    public void Saving_is_for_coordinators_and_admins_and_is_rate_limited_and_size_capped_like_the_quote()
    {
        var create = typeof(ServiceAgreementDraftsController).GetMethod(nameof(ServiceAgreementDraftsController.Create))!;

        Assert.Equal("Admin,Coordinator,SuperAdmin", create.GetCustomAttribute<AuthorizeAttribute>()?.Roles);
        Assert.Equal("api", create.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.NotNull(create.GetCustomAttribute<RequestSizeLimitAttribute>());
    }

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static ServiceAgreementDraftsController Controller(Fixture f, Odip.Api.RateLimiting.PlanQuoteConcurrencyLimiter? limiter = null) => new(f.Db, TenantOf(f.TenantId), new ServiceAgreementDraftService(f.Db), saveLimiter: limiter)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, "synthetic-actor"), new Claim(ClaimTypes.Role, "Admin") }, "test")) },
        },
    };
}
