using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Catalogue;
using Xunit;

namespace Odip.Tests.PlanPricing;

/// <summary>
/// Shared set-up for the plan pricing engine tests. The catalogue is the real one: the official NDIA 2026-27 workbook phase A committed under
/// <c>Catalogue/Fixtures</c>, imported once through the real importer into an in-memory database and read back, so every price in a golden test
/// is a price the importer produced from the file and nothing here types one in.
/// </summary>
internal static class PlanPricingTestSupport
{
    private static readonly Lazy<IReadOnlyList<SupportCatalogueItem>> Rows = new(() => LoadAsync().GetAwaiter().GetResult());

    /// <summary>The 2026-27 catalogue as imported on 2 Oct 2026: 1,017 rows. Shared by every test, so the engine must never change a row.</summary>
    public static IReadOnlyList<SupportCatalogueItem> RealCatalogue => Rows.Value;

    private static async Task<IReadOnlyList<SupportCatalogueItem>> LoadAsync()
    {
        await using var db = CatalogueImportTestSupport.CreateDb();
        await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        return await db.SupportCatalogueItems.AsNoTracking().ToListAsync();
    }

    /// <summary>
    /// The same catalogue after a December price set: the rows whose codes satisfy <paramref name="raised"/> start again on 1 December 2026 at
    /// <paramref name="increase"/> dollars more (as NDIA republishes a changed row), their July rows end on 30 November, and every other row is
    /// untouched. Imported through the real importer, so the rows are exactly what an admin's second import leaves.
    /// </summary>
    public static async Task<IReadOnlyList<SupportCatalogueItem>> WithDecemberPriceSetAsync(Func<string, bool> raised, decimal increase = 1m)
    {
        await using var db = await DecemberDatabaseAsync(raised, increase);
        return await db.SupportCatalogueItems.AsNoTracking().ToListAsync();
    }

    /// <summary>The database behind <see cref="WithDecemberPriceSetAsync"/>: the 2026-27 catalogue and then the December price set, imported as a SuperAdmin would. The caller disposes it.</summary>
    public static async Task<OdipDbContext> DecemberDatabaseAsync(Func<string, bool> raised, decimal increase = 1m, string? databaseName = null)
    {
        var december1 = new DateOnly(2026, 12, 1);
        var db = CatalogueImportTestSupport.CreateDb(databaseName);
        await CatalogueImportTestSupport.ImportAsync(db, CatalogueFixtures.File2026_27);
        var rows = (await CatalogueImportTestSupport.PreviewAsync(db, CatalogueFixtures.File2026_27)).Rows
            .Select(r => raised(r.ItemNumber) && r.PriceNational is not null && (r.EffectiveTo is null || r.EffectiveTo >= december1) ? Raised(r, december1, increase) : r)
            .ToList();
        await CatalogueImportTestSupport.NewImporter(db, CatalogueImportTestSupport.ClockOn(2026, 12, 10))
            .CommitImportAsync(new ConfirmCatalogueImportDto { CatalogueVersion = "2026-27 (2026-12-01)", Rows = rows });
        return db;
    }

    private static CatalogueImportRowDto Raised(CatalogueImportRowDto r, DateOnly from, decimal increase)
    {
        var price = r.PriceNational!.Value + increase;
        return r with
        {
            EffectiveFrom = from, PriceNational = price,
            PriceRemote = r.PriceRemote is null ? null : r.PriceRemote + increase,
            PriceVeryRemote = r.PriceVeryRemote is null ? null : r.PriceVeryRemote + increase,
            PriceLimit_ACT = price, PriceLimit_NSW = price, PriceLimit_NT = price, PriceLimit_QLD = price,
            PriceLimit_SA = price, PriceLimit_TAS = price, PriceLimit_VIC = price, PriceLimit_WA = price,
        };
    }

    // ── Dates the examples use (2026 is a year where the first Monday of October is the 5th) ─────────────────────────

    public static readonly DateOnly Mon5Oct = new(2026, 10, 5);
    public static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    public static readonly DateOnly Fri16Oct = new(2026, 10, 16);
    public static readonly DateOnly Sat17Oct = new(2026, 10, 17);
    public static readonly DateOnly Sun18Oct = new(2026, 10, 18);

    public static TimeOnly T(int hour, int minute = 0) => new(hour, minute);

    // ── Blocks ────────────────────────────────────────────────────────────────────

    public static PlanBlock Block(string id, PlanSupportType type, DayOfWeek day, TimeOnly start, TimeOnly end, Func<PlanBlock, PlanBlock>? change = null)
    {
        var block = new PlanBlock
        {
            Id = id, SupportType = type, Days = new[] { day }, Start = start, End = end,
            Location = new PlanLocation { State = "NSW" },
        };
        return change is null ? block : change(block);
    }

    /// <summary>
    /// A block that is wrong in 26 ways at once (an id over 64 characters, four unknown enum values, a day that is not one, no workers and no participants, a sleepover window and active
    /// hours with no sleeping worker, a missing and a bad headcount entry, travel, transport and accommodation numbers out of range, a state that is not one): the worst case for a
    /// message that repeats the id, because every message names the block.
    /// </summary>
    public static PlanBlock WrongInManyWays(string id) => new()
    {
        Id = id, SupportType = (PlanSupportType)99, Intensity = (SupportIntensity)99, Setting = (PlanSetting)99, OnPublicHoliday = (HolidayDecision)99,
        Days = new[] { (DayOfWeek)99, (DayOfWeek)99 }, Workers = 0, ParticipantsPresent = 0, Start = T(9), End = T(13),
        Location = new PlanLocation { State = "XX" },
        SleepoverWindow = new PlanSleepoverWindow { From = T(1), To = T(2) }, SleepoverActiveHours = -1m,
        HeadcountChanges = new PlanHeadcountChange[] { null!, new PlanHeadcountChange { From = T(9), ParticipantsPresent = 99 } },
        Travel = new PlanProviderTravel { Claim = true, MinutesEachWay = -1, ParticipantsSharing = 0, KmEachWay = -1m },
        Transport = new PlanActivityTransport { Vehicle = (VehicleKind)99, Km = -1m, Tolls = -1m, Parking = -1m, ParticipantsSharing = 0 },
        Accommodation = new PlanAccommodation { Nights = 99 },
    };

    // ── Quotes ────────────────────────────────────────────────────────────────────

    /// <summary>Prices blocks over a period against the real 2026-27 catalogue (or the one given), with the default provider settings unless a policy is given.</summary>
    public static PlanQuote Quote(IEnumerable<PlanBlock> blocks, DateOnly from, DateOnly to, PlanPricingPolicy? policy = null,
        IEnumerable<HolidayEntry>? holidays = null, IReadOnlyCollection<SupportCatalogueItem>? catalogue = null,
        IReadOnlyCollection<HolidayCoverage>? holidayCoverage = null, DateOnly? overridesThrough = null) =>
        PlanPricingEngine.Quote(new PlanQuoteRequest
        {
            Blocks = blocks.ToList(), PeriodFrom = from, PeriodTo = to,
            Policy = policy ?? PlanPricingPolicy.Default,
            Catalogue = catalogue ?? RealCatalogue,
            Holidays = holidays?.ToList() ?? new List<HolidayEntry>(),
            HolidayCoverage = holidayCoverage, HolidayOverridesThrough = overridesThrough,
        });

    /// <summary>One block on one day.</summary>
    public static PlanQuote QuoteOne(PlanBlock block, DateOnly day, PlanPricingPolicy? policy = null, IEnumerable<HolidayEntry>? holidays = null) =>
        Quote(new[] { block }, day, day, policy, holidays);

    public static PlanPricingPolicy SplitPolicy => PlanPricingPolicy.Default with { Crossing = CrossingPolicy.Split };
    public static PlanPricingPolicy HigherOfPolicy => PlanPricingPolicy.Default with { Crossing = CrossingPolicy.HigherOf };

    /// <summary>A line as a comparable tuple: code, quantity, unit price, total.</summary>
    public static (string Code, decimal Qty, decimal UnitPrice, decimal Total) Row(PlannedLine l) => (l.ItemCode!, l.Qty, l.UnitPrice, l.Total);

    public static IEnumerable<PlannedLine> Priced(PlanQuote quote) => quote.Lines.Where(l => l.IsPriced);

    public static HolidayEntry NswLabourDay { get; } = new(Mon5Oct, "NSW", "Labour Day", null, null, "Nager.Date feed");

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    /// <summary>A value as the JSON the API would send: the outputs hold lists, which a record compares by reference, so "the same output" is compared as text.</summary>
    public static string Json(object value) => JsonSerializer.Serialize(value, JsonOptions);

    // ── Stored lines against a re-quote ───────────────────────────────────────────

    private static (string Field, object? Value)[] LineFields(ServiceAgreementDraftLine l) =>
    [
        ("BlockKey", l.BlockKey), ("ItemCode", l.ItemCode), ("Band", l.Band), ("Unit", l.Unit), ("UnitPrice", l.UnitPrice), ("Hours", l.Hours), ("Total", l.Total), ("Occurrences", l.Occurrences),
        ("Flags", l.Flags), ("CatalogueVersion", l.CatalogueVersion), ("CatalogueEffectiveFrom", l.CatalogueEffectiveFrom),
    ];

    /// <summary>
    /// The lines a revision stored against the lines the engine gives now, field by field and by VALUE. A decimal compares by what it is worth, not by its text: the columns are numeric(12,2) and
    /// numeric(14,2), so 8 hours reads back from PostgreSQL as 8.00, the same number as the 8 a fresh quote has and not the same JSON. (A first version serialised both sides and compared strings:
    /// "Hours":8 against "Hours":8.00 failed in CI, where the sibling test that compares tuples passed.) A value the column would round, 0.333 hours say, still differs, which is right: a stored line
    /// has to be exactly what the engine says. Each field is its own assertion that names the line and the field, so a failure says what differs and not a truncated string.
    /// </summary>
    public static void AssertSameLinesByValue(IReadOnlyList<ServiceAgreementDraftLine> stored, IReadOnlyList<ServiceAgreementDraftLine> requoted)
    {
        Assert.True(stored.Count == requoted.Count, string.Create(CultureInfo.InvariantCulture, $"{stored.Count} lines stored, {requoted.Count} from the re-quote"));
        for (var line = 0; line < stored.Count; line++)
        {
            var (was, now) = (LineFields(stored[line]), LineFields(requoted[line]));
            for (var field = 0; field < was.Length; field++)
                Assert.True(Equals(was[field].Value, now[field].Value),
                    string.Create(CultureInfo.InvariantCulture, $"line {line} ({stored[line].BlockKey} {stored[line].ItemCode}), {was[field].Field}: stored {was[field].Value}, re-quoted {now[field].Value}"));
        }
    }
}
