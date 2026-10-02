using Odip.Application.DTOs;
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

internal sealed class ImportPlan
{
    public required IReadOnlyList<PlannedRow> Rows { get; init; }
    public required IReadOnlyList<PlannedEndDate> EndDates { get; init; }
    /// <summary>The earliest start date in the file: the day the catalogue takes effect.</summary>
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
/// newer version than the file.</item>
/// <item>Rows written before the catalogue carried its own dates have no source document: the importer that wrote them (and the demo seed) stamped the day it
/// ran, which is not a catalogue date. A real catalogue row for the same code replaces them outright, so one is end-dated even if its stamp is later.</item>
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
        var fileStart = incoming.Min(r => r.EffectiveFrom);
        var existingByCode = existing.ToLookup(x => x.ItemNumber, StringComparer.Ordinal);
        var incomingCodes = incoming.Select(r => r.ItemNumber).ToHashSet(StringComparer.Ordinal);
        var ends = new Dictionary<Guid, PlannedEndDate>();
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
                var isActive = nextStart is null && (effectiveTo is null || effectiveTo >= today);

                var match = dbRows.FirstOrDefault(x => x.EffectiveFrom == row.EffectiveFrom);
                var action = match is null ? ImportAction.Add : SameContent(match, row, effectiveTo, groupCodeById) ? ImportAction.Unchanged : ImportAction.Update;
                var previous = match ?? dbRows.Where(x => x.EffectiveFrom < row.EffectiveFrom).OrderByDescending(x => x.EffectiveFrom).FirstOrDefault();
                var priceChanged = action != ImportAction.Unchanged && previous is not null && (PriceOf(previous) != PriceOf(row) || previous.IsIntensive != row.IsIntensive);

                planned.Add(new PlannedRow { Row = row, Action = action, Match = match, EffectiveTo = effectiveTo, IsActive = isActive, PriceChanged = priceChanged });

                foreach (var x in dbRows)
                {
                    if (ReferenceEquals(x, match)) continue;
                    if (x.EffectiveFrom < row.EffectiveFrom)
                    {
                        if (x.EffectiveTo is null || x.EffectiveTo >= row.EffectiveFrom) EndDate(x, row.EffectiveFrom, withdrawn: false);
                    }
                    else if (!HasCatalogueDates(x) && x.EffectiveFrom > row.EffectiveFrom)
                        EndDate(x, row.EffectiveFrom, withdrawn: false);
                }
            }
        }

        // Active rows whose code the file does not list. A dated row from a newer catalogue than this file is not this file's to withdraw.
        foreach (var x in existing)
        {
            if (!x.IsActive || incomingCodes.Contains(x.ItemNumber)) continue;
            if (HasCatalogueDates(x) && x.EffectiveFrom >= fileStart) continue;
            EndDate(x, fileStart, withdrawn: true);
        }

        return new ImportPlan { Rows = planned, EndDates = ends.Values.ToList(), FileStart = fileStart };
    }

    /// <summary>A row the 2026-27 importer wrote: its dates are the catalogue's own. Older rows (and the demo seed) carry no source document.</summary>
    internal static bool HasCatalogueDates(SupportCatalogueItem x) => x.SourceDocument is not null;

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
