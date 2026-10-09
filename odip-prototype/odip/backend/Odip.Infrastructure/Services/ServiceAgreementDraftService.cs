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
    private readonly TimeProvider _clock;

    public ServiceAgreementDraftService(OdipDbContext db, PlanPricingService? pricing = null, TimeProvider? clock = null)
    {
        _db = db;
        _pricing = pricing ?? new PlanPricingService(db);
        _clock = clock ?? TimeProvider.System;
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
    /// N+1, and a revision that did something (approved, rostered or signed) keeps the blocks, lines and answer it was saved with. One that did nothing is replaced: the same
    /// save deletes the participant's older such revisions, so the version is a counter that goes up and may skip numbers.
    /// </summary>
    public async Task<DraftSaveResult> SaveAsync(Guid tenantId, Guid participantId, CreateServiceAgreementDraftDto request, string actor, CancellationToken ct)
    {
        if (request.PlanEndDate < request.PlanStartDate || request.AgreementEndDate < request.AgreementStartDate)
            return DraftSaveResult.Refused("End dates must not precede start dates.");
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (participant == null || participant.TenantId != tenantId) return new DraftSaveResult(null, new[] { "Participant not found." }, NotFound: true);

        // Free text is written into a Postgres text column and onto the PDF: a NUL in it is refused by the database (a 500 with nothing the caller can read), as one in a block id was (review F6). It is
        // said here, in words, and not repeated in the message.
        if (HasControlCharacter(request.Representative))
            return DraftSaveResult.Refused(ControlCharacterRefusal("The representative"));

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

        // The new revision and the removal of the ones it replaces are one SaveChanges, so one transaction: a save that fails, or loses a race for its version number, takes nothing with it.
        _db.ServiceAgreementDrafts.Add(draft.Draft);
        for (var attempt = 1; ; attempt++)
        {
            _db.ServiceAgreementDrafts.RemoveRange(await ReplacedRevisionsAsync(tenantId, participantId, draft.Draft.Version, ct));
            try
            {
                await _db.SaveChangesAsync(ct);
                return draft;
            }
            catch (DbUpdateException ex) when (IsVersionRace(ex))
            {
                // Another save took this version number between the reading of the newest and this insert: the unique index on tenant, participant and version refused ours (it was a 500).
                // Nothing of ours is kept; the caller is told which version is newest now.
                _db.ChangeTracker.Clear();
                return DraftSaveResult.Conflicted(await NewestVersionAsync(participantId, ct));
            }
            catch (DbUpdateConcurrencyException)
            {
                // A revision this save meant to replace is gone: another save for the participant landed first and replaced it too, so a delete found no row. Theirs is the newest now, and nothing of ours is kept.
                _db.ChangeTracker.Clear();
                return DraftSaveResult.Conflicted(await NewestVersionAsync(participantId, ct));
            }
            catch (DbUpdateException ex) when (attempt == 1 && IsForeignKeyViolation(ex))
            {
                // A revision this save meant to replace was approved, or given roster patterns, after it was read and before it was deleted: the restricting key refused the delete and the whole
                // save was rolled back. Put back what was to be deleted and go round once more: the revision has a use now, so it is no longer one of the ones to replace.
                foreach (var entry in _db.ChangeTracker.Entries().Where(e => e.State == EntityState.Deleted).ToList()) entry.State = EntityState.Unchanged;
            }
        }
    }

    /// <summary>
    /// The participant's revisions older than <paramref name="version"/> that never did anything: no approval, no roster pattern made from them, no signing snapshot of them. A save replaces
    /// these. Their blocks and lines are loaded with them, so they are deleted with the revision whichever provider is under it (PostgreSQL cascades, EF InMemory does not). Scoped to the
    /// tenant and the participant here, because the query filter lets a SuperAdmin see every tenant.
    /// </summary>
    private Task<List<ServiceAgreementDraft>> ReplacedRevisionsAsync(Guid tenantId, Guid participantId, int version, CancellationToken ct) =>
        _db.ServiceAgreementDrafts.Include(x => x.Blocks).Include(x => x.Lines).AsSplitQuery()
            .Where(x => x.TenantId == tenantId && x.ParticipantId == participantId && x.Version < version
                && !_db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == x.Id)
                && !_db.ShiftPatterns.Any(p => p.SourceDraftId == x.Id)
                && !_db.ElectronicSigningSnapshots.Any(s => s.DraftId == x.Id && s.DraftVersion == x.Version))
            .ToListAsync(ct);

    /// <summary>A foreign key refused the write: the delete of a revision that something now points at.</summary>
    private static bool IsForeignKeyViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.ForeignKeyViolation };

    /// <summary>A control character (a NUL, a line break, a tab) in free text. Refused in words, and never repeated in the message that says so (review F6, N13, L4).</summary>
    private static bool HasControlCharacter(string? text) => text is not null && text.Any(char.IsControl);

    private static string ControlCharacterRefusal(string what) => $"{what} cannot contain a control character (a line break, a tab, a NUL).";

    // The hand-typed path (a caller that predates the plan builder, which sends blocks) writes the same free text to the same columns and onto the same PDF as the representative, and queries the
    // catalogue with the item code. A service type is a short label; the column that holds all of them is varchar(4000) and JSON writes a character outside ASCII as six or twelve.
    private const int MaxServiceTypes = 20;
    private const int MaxServiceTypeLength = 100;
    private const int ServiceTypesColumnLength = 4000;

    /// <summary>The first reason the free text of a hand-typed save is refused, or null: control characters, and the limits that keep it inside the column.</summary>
    private static string? FreeTextProblem(CreateServiceAgreementDraftDto request)
    {
        if (request.ServiceTypes.Count > MaxServiceTypes) return $"A draft has at most {MaxServiceTypes} service types.";
        if (request.ServiceTypes.Any(type => string.IsNullOrWhiteSpace(type))) return "A service type cannot be empty.";
        if (request.ServiceTypes.Any(type => type.Length > MaxServiceTypeLength)) return $"A service type is at most {MaxServiceTypeLength} characters.";
        if (request.ServiceTypes.Any(HasControlCharacter)) return ControlCharacterRefusal("A service type");
        if (request.Lines.Any(line => HasControlCharacter(line.ServiceType))) return ControlCharacterRefusal("The service type of a line");
        if (request.Lines.Any(line => HasControlCharacter(line.ItemCode))) return ControlCharacterRefusal("The item code of a line");
        if (JsonSerializer.Serialize(request.ServiceTypes).Length > ServiceTypesColumnLength) return "The service types are too long to save.";
        return null;
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
        if (FreeTextProblem(request) is { } problem) return DraftSaveResult.Refused(problem);
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

    /// <summary>Every save is a new row with its own <c>CreatedAt</c>: onboarding's "service needs" confirmation goes stale when a revision is created after it (ParticipantInquiriesController).</summary>
    private ServiceAgreementDraft NewDraft(Guid tenantId, Participant participant, CreateServiceAgreementDraftDto request, string actor) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, PlanStartDate = request.PlanStartDate, PlanEndDate = request.PlanEndDate,
        AgreementStartDate = request.AgreementStartDate, AgreementEndDate = request.AgreementEndDate, State = request.State, Representative = request.Representative?.Trim(),
        ParticipantNameSnapshot = participant.FullName, NdisNumberSnapshot = participant.NdisNumber, DateOfBirthSnapshot = participant.DateOfBirth, CreatedBy = actor,
        CreatedAt = _clock.GetUtcNow().UtcDateTime,
    };

    private async Task<ServiceAgreementDraft> WithNextVersionAsync(ServiceAgreementDraft draft, CancellationToken ct)
    {
        draft.Version = (await _db.ServiceAgreementDrafts.Where(x => x.ParticipantId == draft.ParticipantId).MaxAsync(x => (int?)x.Version, ct) ?? 0) + 1;
        return draft;
    }

    /// <summary>The agreement PDF of a revision and the name it is downloaded as.</summary>
    public sealed record AgreementPdf(byte[] Content, string FileName);

    public async Task<(AgreementPdf? Pdf, string? Error)> RenderPdfAsync(Guid tenantId, Guid participantId, Guid draftId, CancellationToken ct)
    {
        // The blocks too: the PDF prints the weekly schedule from them. Two collections, so two queries and not their cross product.
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery()
            .SingleOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null) return (null, "Draft not found.");
        return (new AgreementPdf(ServiceAgreementDraftPdfRenderer.Render(draft), ServiceAgreementDraftPdfRenderer.FileName(draft)), null);
    }

    private static decimal PriceForState(SupportCatalogueItem item, string state) => state switch
    {
        "ACT" => item.PriceLimit_ACT, "NSW" => item.PriceLimit_NSW, "NT" => item.PriceLimit_NT, "QLD" => item.PriceLimit_QLD,
        "SA" => item.PriceLimit_SA, "TAS" => item.PriceLimit_TAS, "VIC" => item.PriceLimit_VIC, "WA" => item.PriceLimit_WA, _ => 0m
    };
}
