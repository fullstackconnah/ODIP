using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using ClaimHolidayCalendar = Odip.Domain.Billing.Services.HolidayCalendar;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The one place public holidays are read for pricing and the roster (the 2026-10-08 review, L3-01 and L3-05). A day is a public holiday if the synced feed (<c>PublicHolidays</c>) says so OR the
/// maintained override table (<c>PublicHolidayOverrides</c>) does: the feed misses days (Boxing Day 2026 for NSW among them), which is why the override table exists. The plan quote read both; the
/// shift and trip claim engines, the budget ledger and the roster read the feed only, so the same day was a holiday on the agreement and an ordinary Saturday on the claim and in the budget. They
/// all read through this now.
///
/// <list type="bullet">
/// <item><b>Every state is read, and the state is matched in memory, in any case.</b> A row written "nsw" (the old POST accepted any text) is the same state as "NSW"; matching in the database
///   is exact and case-sensitive, so a row that never left the database was never found. The window is days, so the rows read are few. A row with no state is national.</item>
/// <item><b>Part-day override rows are quote-only.</b> A row with a start or an end (SA and NT from 19:00 on Christmas Eve and New Year's Eve, QLD from 18:00 on Christmas Eve) is a part of a
///   day. A claim prices a whole shift or trip day at one day type and has no intra-day split yet (the follow-up L3-03), so it cannot use one: it asks for whole-day holidays only, and the
///   plan quote, which splits a day by the minute, asks for both.</item>
/// </list>
/// </summary>
public static class PublicHolidayLoader
{
    /// <summary>Where a synced row came from, for the plan quote's lines and notices.</summary>
    public const string FeedSource = "Nager.Date feed";

    /// <summary>
    /// The holidays dated from <paramref name="from"/> to <paramref name="to"/>, both included, for every state: the synced rows first, then the override rows. With
    /// <paramref name="includePartDay"/> false only whole-day holidays are returned (a claim, the budget and the roster); true also returns the part-day override rows (the plan quote).
    /// </summary>
    public static async Task<List<HolidayEntry>> LoadAsync(OdipDbContext db, DateOnly from, DateOnly to, bool includePartDay, CancellationToken ct)
    {
        var feed = await db.PublicHolidays.AsNoTracking()
            .Where(h => h.Date >= from && h.Date <= to)
            .Select(h => new { h.Date, h.State, h.Name })
            .ToListAsync(ct);

        return feed.Select(h => new HolidayEntry(h.Date, h.State, h.Name, null, null, FeedSource))
            .Concat((await OverridesQuery(db, from, to, includePartDay).ToListAsync(ct)).Select(o => new HolidayEntry(o.Date, o.State, o.Name, o.StartTime, o.EndTime, o.Source)))
            .ToList();
    }

    /// <summary>
    /// The override rows dated from <paramref name="from"/> to <paramref name="to"/>, every state (the state is matched in memory), whole-day ones only unless
    /// <paramref name="includePartDay"/>. A query of its own so that a test can show it translates to SQL (EF InMemory would evaluate any LINQ in memory).
    /// </summary>
    public static IQueryable<PublicHolidayOverride> OverridesQuery(OdipDbContext db, DateOnly from, DateOnly to, bool includePartDay)
    {
        var overrides = db.PublicHolidayOverrides.AsNoTracking().Where(o => o.Date >= from && o.Date <= to);
        return includePartDay ? overrides : overrides.Where(o => o.StartTime == null && o.EndTime == null);
    }

    /// <summary>
    /// The claim engines' and the budget ledger's view of holidays: the whole-day ones, asked for per state with <see cref="ClaimHolidayCalendar.For"/>, which matches the state in any case and
    /// counts a national row for every state.
    /// </summary>
    public static ClaimHolidayCalendar WholeDayCalendarOf(IEnumerable<HolidayEntry> entries) =>
        new(entries.Where(e => e.IsWholeDay).Select(e => (e.Date, e.State)));

    /// <summary>
    /// The roster's view: the whole-day holidays of the provider's state (national rows included), one for each date. A feed row comes before an override row, so the feed's name for a day it
    /// knows is the one shown. A blank state is Victoria, as the claim engines treat it.
    /// </summary>
    public static List<PublicHolidayRef> RosterRefsFor(IEnumerable<HolidayEntry> entries, string? providerState)
    {
        var state = ClaimHolidayCalendar.Normalise(providerState) is { Length: > 0 } normalised ? normalised : "VIC";
        return entries
            .Where(e => e.IsWholeDay && (e.State is null || ClaimHolidayCalendar.Normalise(e.State) == state))
            .GroupBy(e => e.Date)
            .Select(g => new PublicHolidayRef(g.Key, g.First().Name))
            .ToList();
    }
}
