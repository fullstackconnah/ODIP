using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Imports an NDIA support catalogue workbook. The preview reads the file (<see cref="CatalogueXlsxReader"/>: either the 2026-27 or the 2025-26 format, every
/// row of the Current and Legacy sheets) and says what the commit would do; the commit applies the rows the admin confirmed. Both go through
/// <see cref="CatalogueImportPlanner"/>, so what the preview promises is what the commit does.
/// Rows keep the catalogue's own start and end dates and are filed in activity groups by family (<see cref="CatalogueGroups"/>). The commit is
/// history-safe: it only end-dates the rows a newer catalogue supersedes or drops, never deletes, never deactivates a group as a whole, and
/// importing the same file again changes nothing.
/// </summary>
public class CatalogueImportService
{
    private const int MaxWarningLines = 10;
    /// <summary>The real catalogues hold about 1,000 rows; a confirm request far beyond that is not a catalogue.</summary>
    private const int MaxRows = 10_000;

    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public CatalogueImportService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>
    /// Parses an NDIA support catalogue XLSX stream and returns a preview of what will change. Does NOT write to the database.
    /// </summary>
    /// <param name="sourceDocument">The uploaded file's name, stored on every imported row.</param>
    public async Task<CatalogueImportPreviewDto> PreviewImportAsync(Stream xlsxStream, string? sourceDocument = null, CancellationToken ct = default)
    {
        var parsed = CatalogueXlsxReader.Read(xlsxStream, sourceDocument);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var existing = await _db.SupportCatalogueItems.AsNoTracking().ToListAsync(ct);
        var groupCodeById = (await _db.SupportActivityGroups.AsNoTracking().ToListAsync(ct)).ToDictionary(g => g.Id, g => g.GroupCode);

        var rows = parsed.Rows.Select(Normalise).ToList();
        var plan = CatalogueImportPlanner.Plan(rows, existing, groupCodeById, today);

        var warnings = parsed.Warnings.ToList();
        var withdrawn = plan.EndDates.Where(e => e.Withdrawn).OrderBy(e => e.Item.ItemNumber, StringComparer.Ordinal).ToList();
        foreach (var e in withdrawn.Take(MaxWarningLines))
            warnings.Add(FormattableString.Invariant($"Existing item {e.Item.ItemNumber} ({e.Item.Description}) is not in the new catalogue and will be end-dated {e.EffectiveTo:yyyy-MM-dd}."));
        if (withdrawn.Count > MaxWarningLines)
            warnings.Add($"...and {withdrawn.Count - MaxWarningLines} more existing items that are not in the new catalogue will be end-dated.");
        // A file that ends a stored row LATER than the database holds it: the stored date is kept (an import never lengthens a row), so say so.
        var held = plan.HeldEnds.OrderBy(h => h.ItemNumber, StringComparer.Ordinal).ToList();
        foreach (var h in held.Take(MaxWarningLines))
        {
            // The file's end date is formatted in its own FormattableString.Invariant: a nested interpolation inside another one's hole is rendered with the
            // current culture, so a Buddhist-calendar culture would print 2028 as 2571.
            var fileEnd = h.FileEnd is { } e ? FormattableString.Invariant($"ends this row on {e:yyyy-MM-dd}") : "leaves this row open-ended";
            warnings.Add(FormattableString.Invariant(
                $"{h.ItemNumber}: the file {fileEnd}, later than the stored {h.StoredEnd:yyyy-MM-dd}; an import never lengthens a row, so {h.StoredEnd:yyyy-MM-dd} was kept."));
        }
        if (held.Count > MaxWarningLines)
            warnings.Add(FormattableString.Invariant($"...and {held.Count - MaxWarningLines} more rows keep an earlier stored end date than the file gives."));
        // A row an earlier import emptied (its code was left out of a republished file) that this file lists again: it comes back. Say so row by row, so the
        // repair of a wrong workbook is not mistaken for an unexplained "updated" count.
        var back = plan.Reopened.OrderBy(r => r.ItemNumber, StringComparer.Ordinal).ToList();
        foreach (var r in back.Take(MaxWarningLines))
            warnings.Add(FormattableString.Invariant($"{r.ItemNumber} ({r.Description}) was end-dated by an earlier import that left it out; this file lists it again, so it is reopened from {r.EffectiveFrom:yyyy-MM-dd}."));
        if (back.Count > MaxWarningLines)
            warnings.Add(FormattableString.Invariant($"...and {back.Count - MaxWarningLines} more rows end-dated by an earlier import are reopened."));
        // An OLDER catalogue imported as history: its codes that the newer catalogue does not hold end the day before it starts, instead of staying open-ended and
        // current beside a catalogue that dropped them. Only rows this import changes are named (a re-import that finds them already ended says nothing).
        var history = plan.Capped.OrderBy(c => c.ItemNumber, StringComparer.Ordinal).ToList();
        if (history.Count > 0 && plan.NewerCatalogueStart is { } begins)
        {
            foreach (var c in history.Take(MaxWarningLines))
                warnings.Add(FormattableString.Invariant($"{c.ItemNumber} ({c.Description}) is not in the newer catalogue (from {begins:yyyy-MM-dd}), so this older file ends it on {c.EndsOn:yyyy-MM-dd}."));
            if (history.Count > MaxWarningLines)
                warnings.Add(FormattableString.Invariant($"...and {history.Count - MaxWarningLines} more codes of this file are not in the newer catalogue (from {begins:yyyy-MM-dd}) and end the day before it starts."));
        }
        // A row that starts after today prices services from its own start date: earlier services keep the row it replaces (claims and agreements read the
        // row valid on the service date). Say so row by row, so a republished file whose changed rows start later is not mistaken for a mistake.
        var later = rows.Where(r => r.EffectiveFrom > today).OrderBy(r => r.EffectiveFrom).ThenBy(r => r.ItemNumber, StringComparer.Ordinal).ToList();
        foreach (var r in later.Take(MaxWarningLines))
            warnings.Add(FormattableString.Invariant($"{r.ItemNumber} ({r.Description}) starts on {r.EffectiveFrom:yyyy-MM-dd}, after today ({today:yyyy-MM-dd}): it prices services from that date; earlier services keep the row it replaces."));
        if (later.Count > MaxWarningLines)
            warnings.Add(FormattableString.Invariant($"...and {later.Count - MaxWarningLines} more rows start after today."));
        // The file is older than what is imported only when imported rows start AFTER everything the file itself starts (its latest Current start): a few
        // rows that start days after the catalogue's first day (the real file has some on 2 and 3 July), or a republished file's changed rows, are the
        // file's own, and previewing the same file again must not call it history.
        var fileLatest = rows.Where(r => !r.IsLegacy).Select(r => (DateOnly?)r.EffectiveFrom).Max() ?? rows.Max(r => r.EffectiveFrom);
        var newer = existing.Where(x => CatalogueImportPlanner.HasCatalogueDates(x) && x.EffectiveFrom > fileLatest).Select(x => (DateOnly?)x.EffectiveFrom).Min();
        if (newer is { } from)
            warnings.Add(FormattableString.Invariant($"This file starts on {plan.FileStart:yyyy-MM-dd}, before catalogue rows already imported (from {from:yyyy-MM-dd}). It is added as history and the newer rows are not changed."));

        return new CatalogueImportPreviewDto
        {
            DetectedVersion = parsed.DetectedVersion,
            DetectedFormat = parsed.Format,
            SourceDocument = parsed.SourceDocument,
            EffectiveFrom = parsed.EffectiveFrom,
            ItemsToAdd = plan.Rows.Count(p => p.Action == ImportAction.Add),
            ItemsUnchanged = plan.Rows.Count(p => p.Action == ImportAction.Unchanged),
            LegacyItems = rows.Count(r => r.IsLegacy),
            ItemsToDeactivate = plan.EndDates.Count,
            Rows = plan.Rows.Select(p => p.Row with { IsNew = p.Action == ImportAction.Add, IsUnchanged = p.Action == ImportAction.Unchanged, PriceChanged = p.PriceChanged }).ToList(),
            Warnings = warnings,
        };
    }

    /// <summary>
    /// Commits the import the admin confirmed. Call only after the user has reviewed the preview. Throws <see cref="InvalidOperationException"/>
    /// (a 400 from the controller) before writing anything if a row cannot be stored.
    /// </summary>
    public async Task<CatalogueImportResultDto> CommitImportAsync(ConfirmCatalogueImportDto dto, CancellationToken ct = default)
    {
        var rows = Validate(dto);

        // Read, plan and save are one unit: with another confirm in between, both would plan against the same table and insert the catalogue twice.
        await using var gate = await CatalogueImportLock.AcquireAsync(_db, ct);

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var existing = await _db.SupportCatalogueItems.ToListAsync(ct);
        var groups = await _db.SupportActivityGroups.ToListAsync(ct);
        var groupsByCode = groups.ToDictionary(g => g.GroupCode, StringComparer.Ordinal);
        var plan = CatalogueImportPlanner.Plan(rows, existing, groups.ToDictionary(g => g.Id, g => g.GroupCode), today);

        Guid GroupId(string groupCode)
        {
            if (groupsByCode.TryGetValue(groupCode, out var group)) return group.Id;
            var definition = CatalogueGroups.All.FirstOrDefault(d => d.GroupCode == groupCode) ?? CatalogueGroups.For(CatalogueClassification.Other);
            group = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = definition.GroupCode, DisplayName = definition.DisplayName, SupportCategory = definition.SupportCategory, IsActive = true };
            _db.SupportActivityGroups.Add(group);
            groupsByCode[definition.GroupCode] = group;
            return group.Id;
        }

        foreach (var p in plan.Rows)
        {
            if (p.Action == ImportAction.Unchanged) continue;
            var item = p.Match;
            if (item is null)
            {
                item = new SupportCatalogueItem { Id = Guid.NewGuid() };
                _db.SupportCatalogueItems.Add(item);
            }
            Apply(item, p, GroupId(p.Row.GroupCode), dto.CatalogueVersion.Trim());
        }
        foreach (var end in plan.EndDates)
        {
            // A planned end date can land on a row this import also updated: a code listed twice with a gap updates its first version to end where the file says,
            // while the second version's plan ends every earlier row that reaches its start the day before it. The row keeps the earlier of the two dates; for a
            // row that was not updated the planner already never lengthens, so this is its planned date.
            end.Item.EffectiveTo = end.Item.EffectiveTo is { } updatedTo && updatedTo <= end.EffectiveTo ? updatedTo : end.EffectiveTo;
            end.Item.IsActive = false;
        }

        await _db.SaveChangesAsync(ct);
        await gate.CommitAsync(ct);
        return new CatalogueImportResultDto(
            plan.Rows.Count(p => p.Action == ImportAction.Add),
            plan.Rows.Count(p => p.Action == ImportAction.Update),
            plan.Rows.Count(p => p.Action == ImportAction.Unchanged),
            plan.EndDates.Count);
    }

    private static void Apply(SupportCatalogueItem item, PlannedRow planned, Guid groupId, string version)
    {
        var r = planned.Row;
        item.ActivityGroupId = groupId;
        item.ItemNumber = r.ItemNumber;
        item.Description = r.Description;
        item.Unit = r.Unit;
        item.DayType = r.DayType;
        item.IsIntensive = r.IsIntensive;
        item.PriceLimit_ACT = r.PriceLimit_ACT;
        item.PriceLimit_NSW = r.PriceLimit_NSW;
        item.PriceLimit_NT = r.PriceLimit_NT;
        item.PriceLimit_QLD = r.PriceLimit_QLD;
        item.PriceLimit_SA = r.PriceLimit_SA;
        item.PriceLimit_TAS = r.PriceLimit_TAS;
        item.PriceLimit_VIC = r.PriceLimit_VIC;
        item.PriceLimit_WA = r.PriceLimit_WA;
        item.PriceLimit_Remote = r.PriceLimit_Remote;
        item.PriceLimit_VeryRemote = r.PriceLimit_VeryRemote;
        item.CatalogueVersion = version;
        item.EffectiveFrom = r.EffectiveFrom;
        item.EffectiveTo = planned.EffectiveTo;
        item.IsActive = planned.IsActive;
        item.RegistrationGroup = r.RegistrationGroup;
        item.SupportCategoryNumber = r.SupportCategoryNumber;
        item.PaceSupportCategoryNumber = r.PaceSupportCategoryNumber;
        item.OutcomeDomain = r.OutcomeDomain;
        item.SupportPurpose = r.SupportPurpose;
        item.CatalogueType = r.CatalogueType;
        item.NonFaceToFace = r.NonFaceToFace;
        item.ProviderTravel = r.ProviderTravel;
        item.ShortNoticeCancellation = r.ShortNoticeCancellation;
        item.NdiaRequestedReports = r.NdiaRequestedReports;
        item.IrregularSil = r.IrregularSil;
        item.IsLegacy = r.IsLegacy;
        item.PriceNational = r.PriceNational;
        item.PriceRemote = r.PriceRemote;
        item.PriceVeryRemote = r.PriceVeryRemote;
        item.SourceDocument = r.SourceDocument.Length == 0 ? "Support Catalogue import" : r.SourceDocument;
    }

    /// <summary>
    /// The columns derived from the item number (day type, intensity, family, group) are recomputed here, never trusted from the posted row, so a
    /// row cannot file itself under another family, least of all the community access group the claims price from.
    /// </summary>
    private static CatalogueImportRowDto Normalise(CatalogueImportRowDto row)
    {
        var code = (row.ItemNumber ?? string.Empty).Trim();
        var registrationGroup = string.IsNullOrWhiteSpace(row.RegistrationGroup) ? null : row.RegistrationGroup.Trim();
        var classification = CatalogueClassifier.Classify(code, registrationGroup);
        return row with
        {
            ItemNumber = code,
            Description = (row.Description ?? string.Empty).Trim(),
            Unit = string.IsNullOrWhiteSpace(row.Unit) ? "H" : row.Unit.Trim(),
            RegistrationGroup = registrationGroup,
            SourceDocument = (row.SourceDocument ?? string.Empty).Trim(),
            DayType = classification.DayType ?? ClaimDayType.Weekday,
            IsIntensive = classification.IsIntensive,
            Family = classification.Family.ToString(),
            GroupCode = CatalogueGroups.For(classification).GroupCode,
            IsNew = false,
            IsUnchanged = false,
            PriceChanged = false,
        };
    }

    private static List<CatalogueImportRowDto> Validate(ConfirmCatalogueImportDto dto)
    {
        if (dto.Rows is null || dto.Rows.Count == 0)
            throw new InvalidOperationException("No rows to import.");
        if (dto.Rows.Count > MaxRows)
            throw new InvalidOperationException(FormattableString.Invariant($"A catalogue import is limited to {MaxRows:N0} rows; this one has {dto.Rows.Count:N0}."));
        var version = dto.CatalogueVersion?.Trim() ?? string.Empty;
        if (version.Length is 0 or > 20)
            throw new InvalidOperationException("The catalogue version must be 1 to 20 characters.");

        var errors = new List<string>();
        var seen = new HashSet<(string, DateOnly)>();
        var rows = new List<CatalogueImportRowDto>(dto.Rows.Count);
        foreach (var raw in dto.Rows)
        {
            var row = Normalise(raw);
            var label = row.ItemNumber.Length == 0 ? "(a row with no item number)" : row.ItemNumber;
            if (row.ItemNumber.Length is 0 or > 50) errors.Add($"{label}: the item number must be 1 to 50 characters.");
            else if (row.EffectiveFrom == default) errors.Add($"{label}: the row has no start date (an import uses the catalogue's own dates, never today's).");
            else if (row.EffectiveTo is { } to && to < row.EffectiveFrom) errors.Add(FormattableString.Invariant($"{label}: the end date {to:yyyy-MM-dd} is before the start date {row.EffectiveFrom:yyyy-MM-dd}."));
            else if (!seen.Add((row.ItemNumber, row.EffectiveFrom))) errors.Add(FormattableString.Invariant($"{label}: appears more than once with the start date {row.EffectiveFrom:yyyy-MM-dd}."));
            else if (row.Description.Length > 500 || row.Unit.Length > 10 || (row.RegistrationGroup?.Length ?? 0) > 4 || row.SourceDocument.Length > 200)
                errors.Add($"{label}: a text field is longer than the catalogue allows.");
            else if (AnyPriceOutOfRange(row)) errors.Add($"{label}: a price is negative or too large.");
            rows.Add(row);
            if (errors.Count >= 5) break;
        }
        if (errors.Count > 0)
            throw new InvalidOperationException("Nothing was imported. " + string.Join(" ", errors));
        return rows;
    }

    private static bool AnyPriceOutOfRange(CatalogueImportRowDto r) =>
        new decimal?[]
        {
            r.PriceLimit_ACT, r.PriceLimit_NSW, r.PriceLimit_NT, r.PriceLimit_QLD, r.PriceLimit_SA, r.PriceLimit_TAS, r.PriceLimit_VIC, r.PriceLimit_WA,
            r.PriceLimit_Remote, r.PriceLimit_VeryRemote, r.PriceNational, r.PriceRemote, r.PriceVeryRemote,
        }.Any(p => p is < 0m or > 1_000_000_000m);
}
