using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The outcome of saving a draft revision: the saved draft, or every reason it was refused. <see cref="NotFound"/> means the participant is not the caller's.</summary>
public sealed record DraftSaveResult(ServiceAgreementDraft? Draft, IReadOnlyList<string> Errors, bool NotFound = false, int? ConflictVersion = null)
{
    public static DraftSaveResult Saved(ServiceAgreementDraft draft) => new(draft, Array.Empty<string>());
    public static DraftSaveResult Refused(params string[] errors) => new(null, errors);
    public static DraftSaveResult Refused(IReadOnlyList<string> errors) => new(null, errors);
    /// <summary>Somebody else saved a newer version than the one this plan started from (or took the same version number a moment ago): <paramref name="newestVersion"/> is the participant's newest now.</summary>
    public static DraftSaveResult Conflicted(int newestVersion) => new(null,
        new[] { string.Create(System.Globalization.CultureInfo.InvariantCulture, $"Version {newestVersion} was saved after the version this plan started from. Load version {newestVersion} to see what changed, then make your changes again.") },
        ConflictVersion: newestVersion);
}

/// <summary>Creates quote-only snapshots. This service never produces billable events or signed status.</summary>
public sealed class ServiceAgreementDraftService
{
    /// <summary>The refusals that mean the engine priced nothing from a block (a rule it breaks, a registration group the provider does not hold, the STA legacy items). They stop a save: a revision whose lines left a block out would claim a total that is not the plan's. Everything else the engine flags (an unpriced band, a holiday nobody has ruled on, a provisional rate) is saved and shown.</summary>
    private static readonly PlanFailureReason[] SaveRefusals = { PlanFailureReason.InvalidInput, PlanFailureReason.RegistrationGroupNotHeld, PlanFailureReason.StaLegacyNotSupported };

    private readonly OdipDbContext _db;
    private readonly PlanPricingService _pricing;

    public ServiceAgreementDraftService(OdipDbContext db, PlanPricingService? pricing = null)
    {
        _db = db;
        _pricing = pricing ?? new PlanPricingService(db);
    }

    /// <summary>The legacy entry point: the first reason a save was refused, or the draft. Prefer <see cref="SaveAsync"/>, which says every reason.</summary>
    public async Task<(ServiceAgreementDraft? Draft, string? Error)> CreateAsync(Guid tenantId, Guid participantId, CreateServiceAgreementDraftDto request, string actor, CancellationToken ct)
    {
        var result = await SaveAsync(tenantId, participantId, request, actor, ct);
        return (result.Draft, result.Errors.FirstOrDefault());
    }

    /// <summary>
    /// Saves a new revision of the participant's draft: from <see cref="CreateServiceAgreementDraftDto.Blocks"/> (priced here, by the engine, with the tenant's settings,
    /// the catalogue valid on each service date and the delivery state's holidays) or from the older hand-typed lines. A revision is never edited: this is always version
    /// N+1, and the earlier ones keep the blocks, lines and answer they were saved with.
    /// </summary>
    public async Task<DraftSaveResult> SaveAsync(Guid tenantId, Guid participantId, CreateServiceAgreementDraftDto request, string actor, CancellationToken ct)
    {
        if (request.PlanEndDate < request.PlanStartDate || request.AgreementEndDate < request.AgreementStartDate)
            return DraftSaveResult.Refused("End dates must not precede start dates.");
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (participant == null || participant.TenantId != tenantId) return new DraftSaveResult(null, new[] { "Participant not found." }, NotFound: true);

        var blocks = request.Blocks ?? [];
        if (blocks.Count > 0 && request.Lines.Count > 0)
            return DraftSaveResult.Refused("Send the support blocks or the hand-typed lines, not both.");
        if (blocks.Count == 0 && request.Lines.Count == 0)
            return DraftSaveResult.Refused("Add at least one support block.");

        // The version this plan started from is checked before the work of pricing it, and again once it is priced and has its number (a save can land while the engine is working):
        // a second coordinator's save must not quietly become the newest version over the first one's work.
        if (request.BaseVersion is int baseVersion && await NewestVersionAsync(participantId, ct) is var newest && newest != baseVersion)
            return DraftSaveResult.Conflicted(newest);

        var draft = blocks.Count > 0
            ? await BuildFromBlocksAsync(tenantId, participant, request, blocks, actor, ct)
            : await BuildFromLinesAsync(tenantId, participant, request, actor, ct);
        if (draft.Draft is null) return draft;
        if (request.BaseVersion is int started && draft.Draft.Version - 1 != started) return DraftSaveResult.Conflicted(draft.Draft.Version - 1);

        _db.ServiceAgreementDrafts.Add(draft.Draft);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (IsVersionRace(ex))
        {
            // Another save took this version number between the reading of the newest and this insert: the unique index on tenant, participant and version refused ours (it was a 500).
            // Nothing of ours is kept; the caller is told which version is newest now.
            _db.ChangeTracker.Clear();
            return DraftSaveResult.Conflicted(await NewestVersionAsync(participantId, ct));
        }
        return draft;
    }

    private async Task<int> NewestVersionAsync(Guid participantId, CancellationToken ct) =>
        await _db.ServiceAgreementDrafts.Where(x => x.ParticipantId == participantId).MaxAsync(x => (int?)x.Version, ct) ?? 0;

    /// <summary>A unique violation on the draft version index: the one insert in a save that another save can beat.</summary>
    private static bool IsVersionRace(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation } pg
        && (pg.ConstraintName ?? string.Empty).Contains("ServiceAgreementDrafts_TenantId_ParticipantId_Version", StringComparison.Ordinal);

    // ── From blocks (the plan builder) ────────────────────────────────────────────

    private async Task<DraftSaveResult> BuildFromBlocksAsync(Guid tenantId, Participant participant, CreateServiceAgreementDraftDto request, List<DraftBlockDto> blocks, string actor, CancellationToken ct)
    {
        var problems = new List<string>();
        var from = request.AgreementStartDate;
        var to = request.AgreementEndDate;
        if (from.Year < PlanPricingEngine.FirstYear || to.Year > PlanPricingEngine.LastYear)
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"The agreement period must fall between the years {PlanPricingEngine.FirstYear} and {PlanPricingEngine.LastYear}."));
        else if (to.DayNumber - from.DayNumber + 1 > PlanPricingEngine.MaxPeriodDays)
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"The agreement period is longer than {PlanPricingEngine.MaxPeriodDays} days."));
        if (blocks.Count > PlanPricingEngine.MaxBlocks)
            problems.Add(string.Create(CultureInfo.InvariantCulture, $"A plan has at most {PlanPricingEngine.MaxBlocks} blocks."));
        if (problems.Count > 0) return DraftSaveResult.Refused(problems);

        for (var i = 0; i < blocks.Count; i++)
        {
            var entry = blocks[i];
            if (entry?.Block is null) { problems.Add(string.Create(CultureInfo.InvariantCulture, $"Block {i + 1} is empty.")); continue; }
            var who = string.IsNullOrWhiteSpace(entry.Block.Id) ? string.Create(CultureInfo.InvariantCulture, $"Block {i + 1}") : $"Block '{PlanBlock.ShortId(entry.Block.Id)}'";
            if (!string.Equals(entry.Block.Location?.State?.Trim(), request.State, StringComparison.OrdinalIgnoreCase))
                problems.Add($"{who}: the delivery state must be {request.State}, the state of the agreement.");
            problems.AddRange(RequirementProblems(who, entry.Requirements));
        }
        if (problems.Count > 0) return DraftSaveResult.Refused(problems);

        var planBlocks = blocks.Select(b => b.Block).ToList();
        var quote = await _pricing.QuoteAsync(tenantId, planBlocks, from, to, ct);
        var refusals = quote.Issues.Where(i => SaveRefusals.Contains(i.Reason)).Select(i => i.Message).Distinct().ToList();
        if (refusals.Count > 0) return DraftSaveResult.Refused(refusals);

        var draft = NewDraft(tenantId, participant, request, actor);
        draft.ServiceTypesJson = JsonSerializer.Serialize(planBlocks.Select(b => SupportTypeLabel(b.SupportType)).Distinct().ToList());
        draft.PricingJson = DraftJson.Write(quote);

        for (var i = 0; i < blocks.Count; i++)
            draft.Blocks.Add(new ServiceAgreementDraftBlock
            {
                Id = Guid.NewGuid(), DraftId = draft.Id, Position = i, BlockKey = planBlocks[i].Id,
                BlockJson = DraftJson.Write(planBlocks[i]), RequirementsJson = DraftJson.Write(Normalised(blocks[i].Requirements)),
            });

        var position = 0;
        foreach (var line in GroupLines(quote, planBlocks))
        {
            line.Id = Guid.NewGuid();
            line.DraftId = draft.Id;
            line.Position = position++;
            draft.Lines.Add(line);
        }

        return DraftSaveResult.Saved(await WithNextVersionAsync(draft, ct));
    }

    /// <summary>
    /// The agreement's lines from the engine's per-occurrence lines: one line for each block, item, band, price (and the catalogue row it came from) and set of flags, summed
    /// over the period. A line that could not be priced is not a line of the agreement: it is an issue, kept in the revision's own answer. The total of a line is the sum of the
    /// occurrences' own totals (each already floored to the cent), never hours times unit price.
    /// </summary>
    public static IEnumerable<ServiceAgreementDraftLine> GroupLines(PlanQuote quote, IReadOnlyList<PlanBlock> blocks)
    {
        var order = blocks.Select((b, i) => (b.Id, i)).ToDictionary(x => x.Id, x => x.i, StringComparer.Ordinal);
        var types = blocks.ToDictionary(b => b.Id, b => SupportTypeLabel(b.SupportType), StringComparer.Ordinal);

        return quote.Lines.Where(l => l.IsPriced)
            .GroupBy(l => (l.BlockId, l.Kind, l.ItemCode, l.Band, l.Unit, l.UnitPrice, l.Trace.CatalogueVersion, l.Trace.PriceBasisFrom, l.Flags))
            .OrderBy(g => order.GetValueOrDefault(g.Key.BlockId, int.MaxValue)).ThenBy(g => g.Min(l => l.ServiceDate)).ThenBy(g => g.Key.Kind).ThenBy(g => g.Key.ItemCode, StringComparer.Ordinal)
            .Select(g => new ServiceAgreementDraftLine
            {
                ServiceType = types.GetValueOrDefault(g.Key.BlockId, "Support"), BlockKey = g.Key.BlockId, Band = g.Key.Band,
                ItemCode = g.Key.ItemCode!, Unit = g.Key.Unit, UnitPrice = g.Key.UnitPrice,
                Hours = decimal.Round(g.Sum(l => l.Qty), 2, MidpointRounding.AwayFromZero), Total = g.Sum(l => l.Total),
                Occurrences = g.Count(), Flags = (int)g.Key.Flags,
                CatalogueVersion = g.Key.CatalogueVersion ?? string.Empty, CatalogueEffectiveFrom = g.Key.PriceBasisFrom ?? g.Min(l => l.ServiceDate),
            });
    }

    public static string SupportTypeLabel(PlanSupportType type) => type switch
    {
        PlanSupportType.PersonalCare => "Personal care",
        PlanSupportType.CommunityAccess => "Community access",
        PlanSupportType.GroupActivity => "Group activity",
        PlanSupportType.StaSupport => "Short-term accommodation support",
        _ => "Support",
    };

    private static IEnumerable<string> RequirementProblems(string who, DraftBlockRequirementsDto? requirements)
    {
        if (requirements is null) yield break;
        if (!DraftBlockRequirementsDto.WorkerGenders.Contains(requirements.WorkerGender))
            yield return $"{who}: the worker gender must be {string.Join(", ", DraftBlockRequirementsDto.WorkerGenders)}.";
        if (requirements.Skills is null) yield break;
        if (requirements.Skills.Any(s => !DraftBlockRequirementsDto.KnownSkills.Contains(s)))
            yield return $"{who}: a skill is not one of {string.Join(", ", DraftBlockRequirementsDto.KnownSkills)}.";
    }

    /// <summary>The requirements as they are kept: known values only, each skill once, in a fixed order.</summary>
    private static DraftBlockRequirementsDto Normalised(DraftBlockRequirementsDto? requirements) => new()
    {
        WorkerGender = requirements?.WorkerGender ?? DraftBlockRequirementsDto.NoPreference,
        Driver = requirements?.Driver ?? false,
        Skills = DraftBlockRequirementsDto.KnownSkills.Where(s => requirements?.Skills?.Contains(s) == true).ToList(),
    };

    // ── From hand-typed lines (before the builder) ────────────────────────────────

    private async Task<DraftSaveResult> BuildFromLinesAsync(Guid tenantId, Participant participant, CreateServiceAgreementDraftDto request, string actor, CancellationToken ct)
    {
        var effectiveDate = request.AgreementStartDate;
        var lines = new List<ServiceAgreementDraftLine>();
        foreach (var requested in request.Lines)
        {
            // A line is hours at a WEEKDAY price, so only a per-hour weekday item can be quoted. The catalogue now holds every item, and the importer
            // stores an item the classifier does not band by day as Weekday: sleepovers and accommodation nights are Each / Day, but a hundred hourly
            // Evening, Night, Saturday, Sunday and Public Holiday items of other families (SIL, ICBS, nurses...) would pass the Weekday and hourly tests and
            // quote "weekday" lines at their holiday rates. The draft stays scoped to the community access group, the set it always accepted.
            var valid = await _db.SupportCatalogueItems
                .Where(x => x.ItemNumber == requested.ItemCode && x.ActivityGroup.GroupCode == CatalogueGroups.CommunityAccessGroupCode
                    && x.DayType == Odip.Domain.Enums.ClaimDayType.Weekday && x.Unit == "H")
                .Where(EffectiveCatalogueResolver.ValidOn(effectiveDate))   // valid on the agreement's start date, not "current": see EffectiveCatalogueResolver.IsValidOn
                .ToListAsync(ct);
            // On a day two versions overlap (the previous importer ended a row on the day it started its replacement) the newer wins, as the claim engines
            // and the lookup pick; only rows that start on the same day, duplicates of one version, are ambiguous.
            var candidates = EffectiveCatalogueResolver.NewestVersion(valid);
            if (candidates.Count != 1) return DraftSaveResult.Refused(candidates.Count == 0
                ? $"No active effective weekday catalogue price exists for {requested.ItemCode}."
                : $"Ambiguous active effective catalogue prices exist for {requested.ItemCode}.");
            var item = candidates[0];
            var price = PriceForState(item, request.State);
            if (price <= 0) return DraftSaveResult.Refused($"No available {request.State} price exists for {requested.ItemCode}.");
            lines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = requested.ServiceType.Trim(), Hours = requested.Hours, ItemCode = item.ItemNumber, UnitPrice = price, CatalogueVersion = item.CatalogueVersion, CatalogueEffectiveFrom = item.EffectiveFrom, CatalogueEffectiveTo = item.EffectiveTo });
        }

        var draft = NewDraft(tenantId, participant, request, actor);
        draft.ServiceTypesJson = JsonSerializer.Serialize(request.ServiceTypes);
        foreach (var line in lines) { line.DraftId = draft.Id; draft.Lines.Add(line); }
        return DraftSaveResult.Saved(await WithNextVersionAsync(draft, ct));
    }

    // ── Shared ────────────────────────────────────────────────────────────────────

    private static ServiceAgreementDraft NewDraft(Guid tenantId, Participant participant, CreateServiceAgreementDraftDto request, string actor) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, PlanStartDate = request.PlanStartDate, PlanEndDate = request.PlanEndDate,
        AgreementStartDate = request.AgreementStartDate, AgreementEndDate = request.AgreementEndDate, State = request.State, Representative = request.Representative?.Trim(),
        ParticipantNameSnapshot = participant.FullName, NdisNumberSnapshot = participant.NdisNumber, DateOfBirthSnapshot = participant.DateOfBirth, CreatedBy = actor,
    };

    private async Task<ServiceAgreementDraft> WithNextVersionAsync(ServiceAgreementDraft draft, CancellationToken ct)
    {
        draft.Version = (await _db.ServiceAgreementDrafts.Where(x => x.ParticipantId == draft.ParticipantId).MaxAsync(x => (int?)x.Version, ct) ?? 0) + 1;
        return draft;
    }

    public async Task<(byte[]? Pdf, string? Error)> RenderPdfAsync(Guid tenantId, Guid participantId, Guid draftId, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines)
            .SingleOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null) return (null, "Draft not found.");
        return (ServiceAgreementDraftPdfRenderer.Render(draft), null);
    }

    private static decimal PriceForState(SupportCatalogueItem item, string state) => state switch
    {
        "ACT" => item.PriceLimit_ACT, "NSW" => item.PriceLimit_NSW, "NT" => item.PriceLimit_NT, "QLD" => item.PriceLimit_QLD,
        "SA" => item.PriceLimit_SA, "TAS" => item.PriceLimit_TAS, "VIC" => item.PriceLimit_VIC, "WA" => item.PriceLimit_WA, _ => 0m
    };
}
