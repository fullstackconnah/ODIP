using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

internal enum ImportAction { Add, Update, Unchanged }

/// <summary>What an import does with one incoming row.</summary>
internal sealed class PlannedRow
{
    public required CatalogueImportRowDto Row { get; init; }
    public required ImportAction Action { get; init; }
    /// <summary>The existing row with the same code and start date (the same catalogue row, re-imported). Null for an Add.</summary>
    public SupportCatalogueItem? Match { get; init; }
    /// <summary>The row's end date once a newer row for the same code (in the file or already in the database) has taken over from it.</summary>
    public DateOnly? EffectiveTo { get; init; }
    public bool IsActive { get; init; }
    public bool PriceChanged { get; init; }
}

/// <summary>An existing row the import end-dates. It is never deleted: it stays the right row for the service dates inside its window.</summary>
internal sealed class PlannedEndDate
{
    public required SupportCatalogueItem Item { get; init; }
    public required DateOnly EffectiveTo { get; init; }
    /// <summary>True when the row's code is not in the imported file at all (rather than superseded by a newer row for the same code).</summary>
    public required bool Withdrawn { get; init; }
}

/// <summary>A row the file would end LATER than the database holds it: the stored end date is kept (an import never lengthens a row), and the preview says so.</summary>
internal sealed record HeldEnd(string ItemNumber, DateOnly EffectiveFrom, DateOnly? FileEnd, DateOnly StoredEnd);

/// <summary>A row an earlier import emptied (its code was left out of a republished file) that this file lists again: it is brought back, and the preview says so.</summary>
internal sealed record ReopenedRow(string ItemNumber, string Description, DateOnly EffectiveFrom);

/// <summary>A row of an older catalogue, imported as history, whose code the newer stored catalogue does not hold: the file ends it the day before that catalogue starts.</summary>
internal sealed record CappedRow(string ItemNumber, string Description, DateOnly EndsOn);

internal sealed class ImportPlan
{
    public required IReadOnlyList<PlannedRow> Rows { get; init; }
    public required IReadOnlyList<PlannedEndDate> EndDates { get; init; }
    public required IReadOnlyList<HeldEnd> HeldEnds { get; init; }
    public required IReadOnlyList<ReopenedRow> Reopened { get; init; }
    /// <summary>Rows the import ends because the file is an older catalogue than the one stored (see <see cref="NewerCatalogueStart"/>); only rows that change are listed.</summary>
    public required IReadOnlyList<CappedRow> Capped { get; init; }
    /// <summary>The first start of a stored catalogue row that begins in a later financial year than everything this file starts: null unless the file is an older catalogue.</summary>
    public required DateOnly? NewerCatalogueStart { get; init; }
    /// <summary>The day the catalogue takes effect: the earliest start on the Current sheet (the Legacy sheet can reach back further).</summary>
    public required DateOnly FileStart { get; init; }
}

/// <summary>
/// Decides, per code, how an incoming catalogue joins the rows already in the database, so the preview and the commit cannot disagree. A code's rows
/// form a timeline of versions, each valid from its own start date until the day before the next one starts:
/// <list type="bullet">
/// <item>The row with the same code and start date is the same catalogue row: identical content changes nothing, a corrected one is updated in place.</item>
/// <item>A row superseded by a newer one is end-dated the day before the newer row starts. The same holds in the other direction: a row that has a newer
/// version already in the database is capped at the day before it, so importing an older file later never disturbs the newer rows.</item>
/// <item>An active row whose code is not in the file at all is end-dated the same way, at the day before the catalogue starts, unless it belongs to a
/// newer version than the file (it starts after everything the file starts). A row that starts WITH the catalogue and is missing from a republished
/// workbook was dropped by it: it is end-dated with an empty window (it ends the day before it starts) and counted in the preview.</item>
/// <item>An import only ever shortens a catalogue row it already holds, never lengthens it. So importing an older file again cannot bring back a row a
/// newer catalogue replaced or dropped, and importing any file twice, in any order, changes nothing. The one exception is a row the importer itself emptied
/// (it ends the day before it starts, because a republished file left its code out): a file that lists the code again brings it back, unless another row of
/// the code covers its start, so a truncated or wrong workbook that was confirmed can be repaired by importing the right one.</item>
/// <item>Rows written before the catalogue carried its own dates have no source document: the importer that wrote them (and the demo seed) stamped the day it
/// ran, which is not a catalogue date. A real catalogue row for the same code replaces them outright, so one is end-dated even if its stamp is later.</item>
/// <item>A file is an OLDER catalogue than the rows already stored when those rows begin in a later NDIA financial year (prices change on 1 July). Importing it is
/// history, and a code of it that the newer catalogue does not hold (no later version of the code in the file or in the database) ended the day before that
/// catalogue began: it is end-dated there and is no longer current, instead of staying open-ended beside a catalogue that dropped it. The same rule applies
/// to rows an earlier import left open. A republication of the SAME year (a December price set that restarts the changed rows and leaves the rest on their
/// 1 July start) is not a later catalogue, so importing the July file again after it ends nothing.</item>
/// </list>
/// Nothing is deleted and no group is deactivated as a whole: only rows the incoming catalogue actually replaces or drops are touched.
/// </summary>
internal static class CatalogueImportPlanner
{
    public static ImportPlan Plan(
        IReadOnlyList<CatalogueImportRowDto> incoming,
        IReadOnlyCollection<SupportCatalogueItem> existing,
        IReadOnlyDictionary<Guid, string> groupCodeById,
        DateOnly today)
    {
        // The day the catalogue takes effect: the earliest start on the Current sheet. The Legacy sheet can reach back further (the 2025-26 file's starts
        // on 1 Jul 2024), but those are items of earlier catalogues, not the date the catalogue they sit in began.
        var fileStart = incoming.Where(r => !r.IsLegacy).Select(r => (DateOnly?)r.EffectiveFrom).Min() ?? incoming.Min(r => r.EffectiveFrom);
        // ...and the latest start the file itself holds: a row already imported that starts after ALL of this is newer than the file, anything up to it is the same catalogue.
        var fileLatest = incoming.Where(r => !r.IsLegacy).Select(r => (DateOnly?)r.EffectiveFrom).Max() ?? incoming.Max(r => r.EffectiveFrom);
        // The file is an older catalogue when stored rows begin in a LATER financial year than everything it starts (NDIA reprices on 1 July). Rows of the same year
        // are its own republication (changed rows restart, unchanged rows keep their start): they do not make it older. The newer catalogue begins at the first
        // such start.
        var fileYear = FinancialYearOf(fileLatest);
        DateOnly? newerStart = existing.Where(x => HasCatalogueDates(x) && FinancialYearOf(x.EffectiveFrom) > fileYear).Select(x => (DateOnly?)x.EffectiveFrom).Min();
        var existingByCode = existing.ToLookup(x => x.ItemNumber, StringComparer.Ordinal);
        var incomingCodes = incoming.Select(r => r.ItemNumber).ToHashSet(StringComparer.Ordinal);
        var ends = new Dictionary<Guid, PlannedEndDate>();
        var heldEnds = new List<HeldEnd>();
        var reopened = new List<ReopenedRow>();
        var capped = new List<CappedRow>();
        var planned = new List<PlannedRow>(incoming.Count);

        // Ends a row the day before `newStart`. A window can only shrink, and a row that starts on or after `newStart` is wholly shadowed:
        // its window becomes empty (it ends the day before it starts) so it can never be found beside the row that replaces it.
        void EndDate(SupportCatalogueItem x, DateOnly newStart, bool withdrawn)
        {
            var end = newStart.AddDays(-1);
            if (end < x.EffectiveFrom) end = x.EffectiveFrom.AddDays(-1);
            var newTo = x.EffectiveTo is { } to && to <= end ? to : end;
            if (newTo == x.EffectiveTo && !x.IsActive) return;   // already as the import would leave it
            if (ends.TryGetValue(x.Id, out var earlier) && earlier.EffectiveTo <= newTo) return;
            ends[x.Id] = new PlannedEndDate { Item = x, EffectiveTo = newTo, Withdrawn = withdrawn };
        }

        foreach (var byCode in incoming.GroupBy(r => r.ItemNumber, StringComparer.Ordinal))
        {
            var rows = byCode.OrderBy(r => r.EffectiveFrom).ToList();
            var dbRows = existingByCode[byCode.Key].ToList();

            for (var i = 0; i < rows.Count; i++)
            {
                var row = rows[i];

                // The next version of this code that is already known: the next incoming row, or a dated row already in the database.
                DateOnly? nextStart = i + 1 < rows.Count ? rows[i + 1].EffectiveFrom : null;
                foreach (var x in dbRows)
                    if (HasCatalogueDates(x) && x.EffectiveFrom > row.EffectiveFrom && (nextStart is null || x.EffectiveFrom < nextStart))
                        nextStart = x.EffectiveFrom;

                var effectiveTo = row.EffectiveTo;
                if (nextStart is { } next && (effectiveTo is null || effectiveTo > next.AddDays(-1))) effectiveTo = next.AddDays(-1);

                // An import only ever shortens a catalogue row it already holds, never lengthens it: a row end-dated because a newer catalogue replaced or
                // dropped it must stay ended when an older file that still lists it (open-ended) is imported again, and an inactive row is not brought back.
                // (A row from before catalogue dates, written by the previous importer, has an end date that is only that importer's "today": replaceable.)
                // Normally one row has this code and start date. If a double import left several (two confirms that both read an empty table), the active
                // one is the match, the lowest Id breaking a tie, so the choice never depends on row order; the extra copies are ended below.
                var match = dbRows.Where(x => x.EffectiveFrom == row.EffectiveFrom).OrderByDescending(x => x.IsActive).ThenBy(x => x.Id).FirstOrDefault();
                var held = match is not null && HasCatalogueDates(match) ? match : null;
                // A window the importer itself emptied (the code was left out of a republished file) is not a row a newer catalogue shortened: when a file lists the
                // code again and no other row of the code covers its start, the row comes back (the update below gives it the file's end date and makes it active).
                if (held is not null && IsEmptied(held) && !dbRows.Any(x => !ReferenceEquals(x, held) && EffectiveCatalogueResolver.IsValidOn(x, held.EffectiveFrom)))
                {
                    reopened.Add(new ReopenedRow(row.ItemNumber, row.Description, row.EffectiveFrom));
                    held = null;
                }
                if (held?.EffectiveTo is { } heldTo && (effectiveTo is null || heldTo < effectiveTo))
                {
                    heldEnds.Add(new HeldEnd(row.ItemNumber, row.EffectiveFrom, effectiveTo, heldTo));
                    effectiveTo = heldTo;
                }
                // A code of an older catalogue with no later version anywhere (not in the file, not stored) is not held by the newer catalogue: it ended the day
                // before that catalogue began. Shortening is always allowed, so a row an earlier import left open is ended too. The cap comes after the held end
                // above, so a row the database already ended earlier keeps that date (and the preview's warning for it).
                var endsWithNewerCatalogue = nextStart is null && newerStart is not null;
                var cappedAt = DateOnly.MinValue;
                var shortenedByCap = false;
                if (endsWithNewerCatalogue)
                {
                    cappedAt = newerStart!.Value.AddDays(-1);
                    if (effectiveTo is null || effectiveTo > cappedAt)
                    {
                        effectiveTo = cappedAt;
                        shortenedByCap = true;
                    }
                }
                var isActive = nextStart is null && !endsWithNewerCatalogue && (effectiveTo is null || effectiveTo >= today) && (held?.IsActive ?? true);

                var action = match is null ? ImportAction.Add : SameContent(match, row, effectiveTo, groupCodeById) ? ImportAction.Unchanged : ImportAction.Update;
                var previous = match ?? dbRows.Where(x => x.EffectiveFrom < row.EffectiveFrom).OrderByDescending(x => x.EffectiveFrom).FirstOrDefault();
                var priceChanged = action != ImportAction.Unchanged && previous is not null && (PriceOf(previous) != PriceOf(row) || previous.IsIntensive != row.IsIntensive);

                planned.Add(new PlannedRow { Row = row, Action = action, Match = match, EffectiveTo = effectiveTo, IsActive = isActive, PriceChanged = priceChanged });
                if (shortenedByCap && action != ImportAction.Unchanged) capped.Add(new CappedRow(row.ItemNumber, row.Description, cappedAt));

                foreach (var x in dbRows)
                {
                    if (ReferenceEquals(x, match)) continue;
                    if (x.EffectiveFrom < row.EffectiveFrom)
                    {
                        if (x.EffectiveTo is null || x.EffectiveTo >= row.EffectiveFrom) EndDate(x, row.EffectiveFrom, withdrawn: false);
                    }
                    else if (x.EffectiveFrom == row.EffectiveFrom || (!HasCatalogueDates(x) && x.EffectiveFrom > row.EffectiveFrom))
                        EndDate(x, row.EffectiveFrom, withdrawn: false);   // an extra copy of this very version, or a previous-importer row stamped later: an empty window
                }
            }
        }

        // Active rows whose code the file does not list. A dated row from a NEWER catalogue than this file is not this file's to withdraw; a row that starts
        // with this catalogue (the same start date, or days after it like four rows of the official file) and is missing from a republished workbook was
        // dropped by it, so it is end-dated with an empty window, like a previous-importer row it shadows.
        foreach (var x in existing)
        {
            if (!x.IsActive || incomingCodes.Contains(x.ItemNumber)) continue;
            if (HasCatalogueDates(x) && x.EffectiveFrom > fileLatest) continue;
            EndDate(x, fileStart, withdrawn: true);
        }

        return new ImportPlan { Rows = planned, EndDates = ends.Values.ToList(), HeldEnds = heldEnds, Reopened = reopened, Capped = capped, NewerCatalogueStart = newerStart, FileStart = fileStart };
    }

    /// <summary>The NDIA financial year a date falls in, named by the year it starts (1 July 2025 to 30 June 2026 is 2025).</summary>
    private static int FinancialYearOf(DateOnly date) => date.Month >= 7 ? date.Year : date.Year - 1;

    /// <summary>A row the 2026-27 importer wrote: its dates are the catalogue's own. Older rows (and the demo seed) carry no source document.</summary>
    internal static bool HasCatalogueDates(SupportCatalogueItem x) => x.SourceDocument is not null;

    /// <summary>The window holds no date: it ends before it starts, as the importer leaves a row it drops (or an extra copy of one version).</summary>
    private static bool IsEmptied(SupportCatalogueItem x) => x.EffectiveTo is { } to && to < x.EffectiveFrom;

    private static decimal? PriceOf(SupportCatalogueItem x) => x.PriceNational ?? (x.PriceLimit_VIC > 0m ? x.PriceLimit_VIC : null);
    private static decimal? PriceOf(CatalogueImportRowDto r) => r.PriceNational ?? (r.PriceLimit_VIC > 0m ? r.PriceLimit_VIC : null);

    /// <summary>Everything an import stores except the version label, the source document and the active flag (labels and derived state, not catalogue content).</summary>
    private static bool SameContent(SupportCatalogueItem x, CatalogueImportRowDto r, DateOnly? effectiveTo, IReadOnlyDictionary<Guid, string> groupCodeById) =>
        x.Description == r.Description && x.Unit == r.Unit && x.DayType == r.DayType && x.IsIntensive == r.IsIntensive
        && x.PriceLimit_ACT == r.PriceLimit_ACT && x.PriceLimit_NSW == r.PriceLimit_NSW && x.PriceLimit_NT == r.PriceLimit_NT && x.PriceLimit_QLD == r.PriceLimit_QLD
        && x.PriceLimit_SA == r.PriceLimit_SA && x.PriceLimit_TAS == r.PriceLimit_TAS && x.PriceLimit_VIC == r.PriceLimit_VIC && x.PriceLimit_WA == r.PriceLimit_WA
        && x.PriceLimit_Remote == r.PriceLimit_Remote && x.PriceLimit_VeryRemote == r.PriceLimit_VeryRemote
        && x.PriceNational == r.PriceNational && x.PriceRemote == r.PriceRemote && x.PriceVeryRemote == r.PriceVeryRemote
        && x.RegistrationGroup == r.RegistrationGroup && x.SupportCategoryNumber == r.SupportCategoryNumber && x.PaceSupportCategoryNumber == r.PaceSupportCategoryNumber
        && x.OutcomeDomain == r.OutcomeDomain && x.SupportPurpose == r.SupportPurpose && x.CatalogueType == r.CatalogueType
        && x.NonFaceToFace == r.NonFaceToFace && x.ProviderTravel == r.ProviderTravel && x.ShortNoticeCancellation == r.ShortNoticeCancellation
        && x.NdiaRequestedReports == r.NdiaRequestedReports && x.IrregularSil == r.IrregularSil && x.IsLegacy == r.IsLegacy
        && x.EffectiveTo == effectiveTo
        && groupCodeById.TryGetValue(x.ActivityGroupId, out var groupCode) && groupCode == r.GroupCode;
}
