using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>Who is approving: the user (when the claim is a user id), the name to record, and the roles they act in.</summary>
public sealed record ApprovalCaller(Guid? UserId, string Name, IReadOnlyCollection<string> Roles)
{
    public bool IsSuperAdmin => Roles.Contains("SuperAdmin", StringComparer.Ordinal);
}

public enum ApprovalStatus
{
    /// <summary>A preview: nothing was done.</summary>
    Previewed,
    /// <summary>Approved just now.</summary>
    Approved,
    /// <summary>It had been approved already (or somebody approved it a moment before): the existing approval, unchanged, and nothing written.</summary>
    AlreadyApproved,
    /// <summary>Refused: <see cref="ApprovalOutcome.Errors"/> says every reason.</summary>
    Refused,
    NotFound,
    /// <summary>The caller's role is not one of the organisation's approver roles.</summary>
    NotAnApprover,
    /// <summary>A newer revision exists, so this one cannot be approved.</summary>
    Superseded,
    /// <summary>Another change to the participant's roster held its lock for too long: nothing was changed, and trying again is right.</summary>
    Busy,
}

public sealed record ApprovalOutcome(
    ApprovalStatus Status, ServiceAgreementDraft? Draft = null, ServiceAgreementDraftApproval? Approval = null, OldShiftsRemainingDto? OldShifts = null,
    IReadOnlyList<string>? Errors = null, DraftApprovalPreviewDto? Preview = null, int? NewestVersion = null, IReadOnlyList<string>? ReasonCodes = null);

/// <summary>
/// "Mark approved" (plan builder, phase D). Approving the NEWEST revision of an agreement draft, for a caller whose role the organisation lets approve, in one transaction: records who and when,
/// makes the weekly roster patterns of the revision's blocks (<see cref="AgreementPatternMapper"/>), ends the patterns of the revisions approved before it the day before this one starts, and, when the
/// participant may be rostered, generates open shifts into the weeks already started on the roster (RosterWeek rows), from the provider's today, through <see cref="RosterShiftGenerator"/>. The
/// revisions before it keep their shifts up to the day before this one starts; from that day (or today) their unfilled Draft shifts are removed in the same transaction, unless something is
/// recorded against one, and the rest (a worker on them, published, or recorded against) stay and are listed for a coordinator to move or cancel. No other shift is changed. There is no un-approving: a change is a new revision, approved in its turn.
/// <para>
/// What stops it is read from the revision as it was saved, never from a re-quote: anything the stored pricing flagged (an issue, a line to review, a public holiday nobody has decided), a revision with
/// no blocks, a block that cannot be read, an agreement that has already ended, a delivery state in another time zone than the provider's, and more than a hundred patterns. Being over a budget
/// stops nothing. Overlapping hand-made patterns are listed and need an acknowledgement; they are never ended or changed.
/// </para>
/// <para>
/// Safe to repeat and to race: approving an approved revision answers with the existing approval and writes nothing; the participant's <see cref="RosterGenerationLock"/> makes concurrent
/// approvals take turns (PostgreSQL), the unique approval per revision and the partial unique pattern key are what decide a race that gets past it, and the loser answers with the winner's approval.
/// </para>
/// </summary>
public sealed class ServiceAgreementApprovalService
{
    public const string SupersededMessage = "A newer revision of this agreement draft exists. Approve the latest revision instead.";
    public const string HandTypedMessage = "Rebuild it from blocks to approve it. This revision's lines were typed by hand, so there are no support blocks to make weekly patterns from.";

    private readonly OdipDbContext _db;
    private readonly IRosterPlacementGate _gate;
    private readonly RosterShiftGenerator _generator;
    private readonly PlanPricingService _pricing;
    private readonly TimeProvider _clock;
    private readonly RosterAvailability _availability;
    private readonly ShiftPatternExpander _expander = new();
    // Budget phase 3: what the shifts approval would make do to the participant's budget, shown in the preview as a warning (never a reason to refuse).
    private readonly ShiftBudgetEffect _budget;
    private readonly ILogger<ServiceAgreementApprovalService>? _logger;

    public ServiceAgreementApprovalService(
        OdipDbContext db, IRosterPlacementGate gate, RosterShiftGenerator? generator = null, PlanPricingService? pricing = null, TimeProvider? clock = null,
        ShiftBudgetEffect? budget = null, ILogger<ServiceAgreementApprovalService>? logger = null, RosterAvailability? availability = null)
    {
        _logger = logger;
        _db = db;
        _gate = gate;
        _generator = generator ?? new RosterShiftGenerator();
        _pricing = pricing ?? new PlanPricingService(db);
        _clock = clock ?? TimeProvider.System;
        _availability = availability ?? new RosterAvailability(db, new StaffUnavailabilityQuery(db));
        _budget = budget ?? new ShiftBudgetEffect(db, new BudgetLedgerService(db, _clock));
    }

    // ── Preview ───────────────────────────────────────────────────────────────────

    /// <summary>What approving would do, with nothing done. Not found for another organisation's participant or revision; not an approver when the caller's role may not approve.</summary>
    public async Task<ApprovalOutcome> PreviewAsync(Guid tenantId, Guid participantId, Guid draftId, ApprovalCaller caller, CancellationToken ct)
    {
        var found = await FindAsync(tenantId, participantId, draftId, ct);
        if (found is null) return await NotThereAsync(tenantId, participantId, caller, preview: true, ct);
        if (!await MayApproveAsync(_pricing, tenantId, caller, ct)) return NotAnApprover();

        var (draft, participant) = found.Value;
        var plan = await PlanAsync(tenantId, draft, participant, ct, includeBudget: true);
        return new ApprovalOutcome(ApprovalStatus.Previewed, draft, plan.Existing, Preview: plan.ToPreview(), NewestVersion: plan.NewestVersion);
    }

    // ── Approve ───────────────────────────────────────────────────────────────────

    public async Task<ApprovalOutcome> ApproveAsync(Guid tenantId, Guid participantId, Guid draftId, bool acknowledgeOverlaps, ApprovalCaller caller, CancellationToken ct)
    {
        var found = await FindAsync(tenantId, participantId, draftId, ct);
        if (found is null) return await NotThereAsync(tenantId, participantId, caller, preview: false, ct);
        if (!await MayApproveAsync(_pricing, tenantId, caller, ct)) return NotAnApprover();

        try
        {
            return await ApproveCoreAsync(tenantId, found.Value.Draft, found.Value.Participant, acknowledgeOverlaps, caller, ct);
        }
        // Another change to the participant's roster held the lock for too long: nothing was changed.
        catch (RosterBusyException busy)
        {
            return new ApprovalOutcome(ApprovalStatus.Busy, Errors: new[] { busy.Message });
        }
        // A shift this approval moves to a new pattern was deleted by another request before the save: nothing of this one is kept, and it is the busy answer (try again), not a 500.
        catch (DbUpdateConcurrencyException)
        {
            _db.ChangeTracker.Clear();
            return new ApprovalOutcome(ApprovalStatus.Busy, Errors: new[] { RosterBusyException.Words });
        }
        // A request that got past the lock and the checks at the same moment as another lost to the unique approval per revision (or to the unique pattern key): the transaction has been rolled back,
        // nothing of this one is kept, and the answer is the winner's approval, as if this had been the second request to arrive.
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            _db.ChangeTracker.Clear();
            if (await _db.ServiceAgreementDraftApprovals.AsNoTracking().AnyAsync(a => a.DraftId == draftId, ct))
                return await ReadAsync(ApprovalStatus.AlreadyApproved, tenantId, found.Value.Draft, null, ct);
            throw;
        }
        // A save landed while this approval was being made: it deleted this revision (the participant's earlier unapproved one), and the patterns and the approval row this approval wrote point at a row that
        // has gone, so a restricting key refused them and the transaction has been rolled back. Nothing of this one is kept; the answer is the one a newer revision always got.
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation })
        {
            _db.ChangeTracker.Clear();
            // Only when the revision really is gone: a key can refuse a write for another reason, and that is not hidden as "superseded".
            if (await NewestVersionAsync(tenantId, participantId, ct) is { } newest && !await _db.ServiceAgreementDrafts.AsNoTracking().AnyAsync(x => x.Id == draftId && x.TenantId == tenantId, ct))
                return Superseded(newest);
            throw;
        }
    }

    // ── A revision that is not there ──────────────────────────────────────────────

    /// <summary>
    /// A revision that cannot be found. Usually it never existed (another organisation's, or a made-up id): not found. But a save deletes the participant's earlier unapproved revision, so a page that
    /// still holds one asks about a revision that was there a moment ago. When the participant is the caller's organisation's and has revisions, the answer is the one that page was given before a save
    /// could delete anything: superseded, with the newest version (a preview says it cannot be approved; an approval is the 409 <c>draft-superseded</c>). A made-up id of such a participant gets the same
    /// answer, because it cannot be told from one a save has replaced; it tells nothing the revisions list does not.
    /// </summary>
    private async Task<ApprovalOutcome> NotThereAsync(Guid tenantId, Guid participantId, ApprovalCaller caller, bool preview, CancellationToken ct)
    {
        if (await NewestVersionAsync(tenantId, participantId, ct) is not { } newest) return new ApprovalOutcome(ApprovalStatus.NotFound, Errors: new[] { "Draft not found." });
        if (!await MayApproveAsync(_pricing, tenantId, caller, ct)) return NotAnApprover();
        return Superseded(newest, preview);
    }

    /// <summary>The newest version of the participant's revisions in this organisation; null when it has none (or the participant is not this organisation's).</summary>
    private async Task<int?> NewestVersionAsync(Guid tenantId, Guid participantId, CancellationToken ct) =>
        await _db.ServiceAgreementDrafts.Where(x => x.TenantId == tenantId && x.ParticipantId == participantId).MaxAsync(x => (int?)x.Version, ct);

    private static ApprovalOutcome Superseded(int newestVersion, bool preview = false) => new(ApprovalStatus.Superseded, Errors: new[] { SupersededMessage }, NewestVersion: newestVersion,
        Preview: preview ? new DraftApprovalPreviewDto { CanApprove = false, Reasons = [new ApprovalReasonDto { Code = "Superseded", Message = SupersededMessage }] } : null);

    private async Task<ApprovalOutcome> ApproveCoreAsync(Guid tenantId, ServiceAgreementDraft draft, Participant participant, bool acknowledgeOverlaps, ApprovalCaller caller, CancellationToken ct)
    {
        // Approved already: the same answer again, nothing written.
        if (await _db.ServiceAgreementDraftApprovals.AsNoTracking().AnyAsync(a => a.DraftId == draft.Id, ct))
            return await ReadAsync(ApprovalStatus.AlreadyApproved, tenantId, draft, null, ct);

        // Everything below is read and written holding the participant's roster lock (PostgreSQL): a generation, or another approval, that is under way finishes first, and what this one reads is
        // what it commits. The lock also makes a second approval of the same revision wait, and find the first one's approval.
        // R6: the organisation's board lock first, as Start and Publish week take it; then the participant's, which joins its transaction. A first approval racing a Start
        // waits for it, and then sees the week it started.
        await using var board = await RosterGenerationLock.AcquireAsync(_db, tenantId, ct, _generator.LockWait, scope: "roster-board");
        await using var held = await RosterGenerationLock.AcquireAsync(_db, draft.ParticipantId, ct, _generator.LockWait);
        if (await _db.ServiceAgreementDraftApprovals.AsNoTracking().AnyAsync(a => a.DraftId == draft.Id, ct))
            return await ReadAsync(ApprovalStatus.AlreadyApproved, tenantId, draft, null, ct);

        var plan = await PlanAsync(tenantId, draft, participant, ct, approving: true);
        if (plan.Superseded) return new ApprovalOutcome(ApprovalStatus.Superseded, Errors: new[] { SupersededMessage }, NewestVersion: plan.NewestVersion);
        if (plan.Reasons.Count > 0) return new ApprovalOutcome(ApprovalStatus.Refused, Errors: plan.Reasons.Select(r => r.Message).ToList(), ReasonCodes: plan.Reasons.Select(r => r.Code).ToList());
        if (plan.Overlaps.Count > 0 && !acknowledgeOverlaps)
            return new ApprovalOutcome(ApprovalStatus.Refused, Errors: new[] { OverlapMessage(plan.Overlaps.Count) }, ReasonCodes: new[] { "Overlaps" });

        var approval = new ServiceAgreementDraftApproval
        {
            Id = Guid.NewGuid(), TenantId = draft.TenantId, DraftId = draft.Id, ParticipantId = draft.ParticipantId, DraftVersion = draft.Version,
            ApprovedAt = _clock.GetUtcNow().UtcDateTime, ApprovedByUserId = caller.UserId, ApprovedByName = caller.Name,
            PatternsCreated = plan.NewPatterns.Count, PatternsEnded = plan.ToEnd.Count,
        };

        _db.ShiftPatterns.AddRange(plan.NewPatterns);
        foreach (var old in plan.ToEnd)
        {
            old.EffectiveTo = plan.EndsOn;
            // A revision that starts on or before the old pattern did leaves it ending before it begins: it is switched off as well, so nothing reads it as live.
            if (plan.EndsOn < old.EffectiveFrom) old.IsActive = false;
        }
        // The revisions before's unfilled Draft shifts from this one's start go in this same save, so the roster does not hold them beside the new ones. Shifts with a worker, published ones and
        // ones something is recorded against stay; the answer lists them.
        _db.Shifts.RemoveRange(plan.ToRemove);

        // Carry-over: an unchanged support's shifts move to its new pattern as they are; generation then makes none on their days.
        foreach (var shift in plan.ToCarry) shift.ShiftPatternId = plan.CarryTo[shift.ShiftPatternId!.Value].Id;

        if (plan.Ready && plan.Windows.Count > 0)
        {
            var made = new List<Shift>();
            foreach (var (from, to) in plan.Windows)
                made.AddRange((await _generator.AddAsync(_db, plan.NewPatterns, from, to, ct, carried: plan.Carried)).MadeShifts);
            await _availability.MarkRegularsAwayAsync(made, ct);
            approval.ShiftsCreated = made.Count;
            approval.FirstShiftDate = made.Count > 0 ? made.Min(s => s.ServiceDate) : null;
            approval.HorizonEnd = plan.HorizonEnd;
        }

        _db.ServiceAgreementDraftApprovals.Add(approval);
        await _db.SaveChangesAsync(ct);
        // The board lock began the transaction and the participant's joined it: committing it commits both.
        await board.CommitAsync(ct);
        return await ReadAsync(ApprovalStatus.Approved, tenantId, draft, plan.OldShifts, ct);
    }

    // ── The plan: what approving would do, read once and used by both the preview and the approval ──

    private sealed class Plan
    {
        public required ServiceAgreementDraft Draft { get; init; }
        public ServiceAgreementDraftApproval? Existing { get; set; }
        public int NewestVersion { get; set; }
        /// <summary>The provider's calendar date now.</summary>
        public DateOnly Today { get; set; }
        public bool Superseded { get; set; }
        public List<ApprovalReasonDto> Reasons { get; } = new();
        public IReadOnlyList<ShiftPattern> NewPatterns { get; set; } = Array.Empty<ShiftPattern>();
        public List<ShiftPattern> ToEnd { get; set; } = new();
        public int? EndsFromVersion { get; set; }
        public DateOnly EndsOn { get; set; }
        public List<ShiftPattern> Overlaps { get; set; } = new();
        public OldShiftsRemainingDto OldShifts { get; set; } = new();
        /// <summary>The unfilled Draft shifts of the revisions before that approval removes (tracked, so its own save deletes them).</summary>
        public List<Shift> ToRemove { get; set; } = new();
        /// <summary>The ended patterns whose new pattern is the same support, by the ended pattern's id: their shifts move to it.</summary>
        public Dictionary<Guid, ShiftPattern> CarryTo { get; set; } = new();
        /// <summary>The new patterns a renewal's approval matched to a pattern ending the day before it starts (D12): like CarryTo's, they are not changed supports.</summary>
        public HashSet<ShiftPattern> HandedOn { get; } = new();
        /// <summary>The shifts that move (tracked: the approval's own save moves them).</summary>
        public List<Shift> ToCarry { get; set; } = new();
        /// <summary>The (new pattern, day) pairs the moved shifts cover: generation makes nothing there.</summary>
        public HashSet<(Guid PatternId, DateOnly Date)> Carried { get; set; } = new();
        /// <summary>Ended patterns edited by hand that approving puts back to the agreement's times (preview only).</summary>
        public int HandEdited { get; set; }
        public bool Ready { get; set; }
        public DateOnly From { get; set; }
        /// <summary>The last day of the started weeks it fills; null when it fills none.</summary>
        public DateOnly? HorizonEnd { get; set; }
        /// <summary>The started weeks from <see cref="From"/> to the agreement's end, each held to them (L6): where an approval generates.</summary>
        public List<(DateOnly From, DateOnly To)> Windows { get; set; } = new();
        public int ShiftsToCreate { get; set; }
        public string? ShiftsNote { get; set; }
        /// <summary>Where the shifts this approval would make take a pool past its funding (preview only; null when there are none to say).</summary>
        public List<BudgetWarningDto>? BudgetWarnings { get; set; }

        public DraftApprovalPreviewDto ToPreview() => new()
        {
            CanApprove = Existing is null && !Superseded && Reasons.Count == 0,
            AlreadyApproved = Existing is not null,
            Reasons = Reasons.ToList(),
            PatternsToCreate = NewPatterns.Count, PatternsToEnd = ToEnd.Count, EndsFromVersion = EndsFromVersion, EndsOn = ToEnd.Count > 0 ? EndsOn : null,
            // A new pattern no ended one matches, or for a renewal no pattern ending the day before it (D12), is a changed support: it starts with no default staff. A first approval has none to count.
            ChangedPatterns = ToEnd.Count > 0 || HandedOn.Count > 0 ? NewPatterns.Count - CarryTo.Values.Union(HandedOn).Count() : 0,
            HandEditedPatterns = HandEdited,
            ShiftsToCreate = ShiftsToCreate, ShiftsNote = ShiftsNote,
            OldShiftsRemaining = OldShifts,
            OverlappingPatterns = Overlaps.OrderBy(p => p.DayOfWeek).ThenBy(p => p.StartTime).Select(p => new OverlappingPatternDto
            {
                Id = p.Id, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, Notes = p.Notes,
            }).ToList(),
            HorizonEnd = HorizonEnd,
            BudgetWarnings = BudgetWarnings is { Count: > 0 } ? BudgetWarnings : null,
        };
    }

    private async Task<Plan> PlanAsync(Guid tenantId, ServiceAgreementDraft draft, Participant participant, CancellationToken ct, bool includeBudget = false, bool approving = false)
    {
        var plan = new Plan { Draft = draft, EndsOn = draft.AgreementStartDate.AddDays(-1) };

        // The provider's zone and today. Read by the organisation asked about, never by "the first settings row": a SuperAdmin's context sees every organisation's.
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct);
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, provider.Zone);
        plan.Today = today;
        plan.From = draft.AgreementStartDate > today ? draft.AgreementStartDate : today;
        // Start rostering (2026-10-16, L6): approval fills only the weeks already started; the others get their shifts when someone starts them.
        plan.Windows = await StartedWindowsAsync(tenantId, plan.From, draft.AgreementEndDate, ct);
        plan.HorizonEnd = plan.Windows.Count > 0 ? plan.Windows[^1].To : null;

        plan.Existing = await _db.ServiceAgreementDraftApprovals.AsNoTracking().FirstOrDefaultAsync(a => a.DraftId == draft.Id, ct);
        plan.NewestVersion = await _db.ServiceAgreementDrafts.Where(x => x.TenantId == tenantId && x.ParticipantId == draft.ParticipantId).MaxAsync(x => (int?)x.Version, ct) ?? draft.Version;
        if (plan.Existing is not null)
        {
            plan.Reasons.Add(new ApprovalReasonDto { Code = "AlreadyApproved", Message = string.Create(CultureInfo.InvariantCulture, $"This revision was approved for rostering by {plan.Existing.ApprovedByName} on {plan.Existing.ApprovedAt:yyyy-MM-dd}.") });
            plan.OldShifts = (await OldShiftsAsync(tenantId, draft, today, ct)).Remaining;
            return plan;
        }

        if (draft.Version < plan.NewestVersion)
        {
            plan.Superseded = true;
            plan.Reasons.Add(new ApprovalReasonDto { Code = "Superseded", Message = SupersededMessage });
            return plan;
        }

        // What the stored revision says. A revision with no blocks or no stored answer was typed by hand: it has nothing to make patterns from.
        var blocks = draft.Blocks.OrderBy(b => b.Position).Select(DraftJson.ToDto).ToList();
        var quote = DraftJson.ReadQuote(draft.PricingJson);
        var mappable = false;
        if (blocks.Count == 0 || quote is null)
        {
            plan.Reasons.Add(new ApprovalReasonDto { Code = "HandTyped", Message = HandTypedMessage });
        }
        else
        {
            mappable = true;
            for (var i = 0; i < blocks.Count; i++)
            {
                if (blocks[i].Unreadable)
                {
                    mappable = false;
                    plan.Reasons.Add(new ApprovalReasonDto { Code = "BlockUnreadable", Message = string.Create(CultureInfo.InvariantCulture, $"Block {i + 1} could not be read, so its weekly patterns cannot be made. Build the plan again and save it as a new revision.") });
                }
                else if (blocks[i].Block.Validate() is { Count: > 0 } problems)
                {
                    mappable = false;
                    plan.Reasons.AddRange(problems.Select(message => new ApprovalReasonDto { Code = "BlockInvalid", Message = message, BlockId = blocks[i].Block.Id }));
                }
            }

            plan.Reasons.AddRange(PricingReasons(quote, draft));
        }

        if (draft.AgreementEndDate < today)
            plan.Reasons.Add(new ApprovalReasonDto { Code = "AgreementEnded", Message = string.Create(CultureInfo.InvariantCulture, $"This agreement ended on {draft.AgreementEndDate:yyyy-MM-dd}, before today ({today:yyyy-MM-dd}): there is nothing left to roster.") });

        // Block times are the delivery state's wall clock and pattern times are the provider's: the same clock only while the two states share a zone.
        var deliveryZone = StateTimeZoneMap.Resolve(draft.State);
        // Compare clocks, not ids: Melbourne and Hobart run on Sydney's clock, so VIC-NSW and ACT-TAS stay allowed.
        if (!string.Equals(StateTimeZoneMap.Clock(deliveryZone), StateTimeZoneMap.Clock(provider.Id), StringComparison.Ordinal))
            plan.Reasons.Add(new ApprovalReasonDto
            {
                Code = "TimeZoneMismatch",
                Message = $"This agreement is delivered in {draft.State} ({deliveryZone}), but your organisation's roster runs on {provider.Id} time. Block times are read on the delivery state's clock, so the weekly patterns would land at a different real time. Rostering across time zones is not supported yet.",
            });

        if (mappable)
        {
            var count = AgreementPatternMapper.Count(blocks.Select(b => b.Block));
            if (count > AgreementPatternMapper.MaxPatternsPerApproval)
                plan.Reasons.Add(new ApprovalReasonDto
                {
                    Code = "TooManyPatterns",
                    Message = string.Create(CultureInfo.InvariantCulture, $"Approving would make {count} weekly patterns, and one approval makes at most {AgreementPatternMapper.MaxPatternsPerApproval}. Remove blocks or split the plan, then save a new revision."),
                });
            else
                plan.NewPatterns = AgreementPatternMapper.Map(draft, blocks);
        }

        await ReadRosterAsync(tenantId, draft, plan, ct, approving);

        plan.Ready = await _gate.MayPlaceAsync(_db, draft.ParticipantId, ct);
        if (!plan.Ready)
        {
            var who = string.IsNullOrWhiteSpace(participant.FirstName) ? "the participant" : participant.FirstName;
            plan.ShiftsNote = $"No shifts are made now, because {who} is not active yet. Once they are, each week started on the roster includes them; use Generate on their shift patterns for weeks already started.";
        }
        else if (quote is not null && plan.Windows.Count > 0)
        {
            var skipped = quote.HolidayOccurrences.Where(h => h.Skipped).Select(h => (h.BlockId, h.Date)).ToHashSet();
            var occurrences = plan.NewPatterns
                .SelectMany(pattern => plan.Windows.SelectMany(w => _expander.Occurrences(pattern, w.From, w.To))
                    .Where(date => !skipped.Contains((pattern.SourceBlockKey!, date)) && !plan.Carried.Contains((pattern.Id, date)))
                    .Select(date => (Pattern: pattern, Date: date)))
                .ToList();
            plan.ShiftsToCreate = occurrences.Count;

            // Budget phase 3: what those shifts do to the participant's budget, as a warning on the preview. Only the preview asks (an approval does not need it), and a failure to work it out
            // must never stop the preview, so it says nothing rather than fail.
            if (includeBudget && occurrences.Count > 0)
            {
                try
                {
                    var planned = occurrences.Select(o => new PlannedShift(null, o.Date, o.Pattern.StartTime, o.Pattern.EndTime, o.Pattern.EndsNextDay, o.Pattern.Ratio, o.Pattern.NightType)).ToList();
                    plan.BudgetWarnings = await _budget.ForShiftsAsync(tenantId, draft.ParticipantId, planned, ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger?.LogWarning(ex, "The budget warnings for the approval preview of draft {DraftId} could not be worked out; the preview is shown without them", draft.Id);
                    plan.BudgetWarnings = null;
                }
            }
        }

        return plan;
    }

    /// <summary>The roster as it stands: the patterns this approval would end, the old shifts it leaves, and the hand-made patterns that overlap the new ones.</summary>
    private async Task ReadRosterAsync(Guid tenantId, ServiceAgreementDraft draft, Plan plan, CancellationToken ct, bool approving)
    {
        var earlier = await _db.ServiceAgreementDraftApprovals.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.ParticipantId == draft.ParticipantId && a.DraftVersion < draft.Version)
            .Select(a => new { a.DraftId, a.DraftVersion }).ToListAsync(ct);
        if (earlier.Count > 0)
        {
            var versionOf = earlier.ToDictionary(a => a.DraftId, a => a.DraftVersion);
            var earlierIds = versionOf.Keys.ToList();
            var old = await _db.ShiftPatterns.Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId != null && earlierIds.Contains(p.SourceDraftId.Value)).ToListAsync(ct);
            plan.ToEnd = old.Where(p => p.EffectiveTo is null || p.EffectiveTo > plan.EndsOn).OrderBy(p => versionOf[p.SourceDraftId!.Value]).ToList();
            plan.EndsFromVersion = plan.ToEnd.Count > 0 ? plan.ToEnd.Max(p => versionOf[p.SourceDraftId!.Value]) : null;
            // An approval locks the old shifts before it reads any of them: the carry-over and the removal then both decide on what is committed.
            if (approving) await LockOldShiftsAsync(old.Select(p => p.Id).ToArray(), draft.AgreementStartDate > plan.Today ? draft.AgreementStartDate : plan.Today, ct);
            await CarryOverAsync(draft, plan, ct);
            // A renewal ends no dated pattern: only the newest revision is approved, each approval ends every earlier pattern past its start, and the roster cannot move an agreement pattern's dates.
            // So when the carry-over ended nothing, or only open patterns (a legacy pattern with no end, fix round 2), the patterns ending the day before hand on their default workers (D12).
            if (plan.ToEnd.All(p => p.EffectiveTo is null)) await CarryDefaultsIntoRenewalAsync(plan, old, versionOf, ct);
            if (!approving) plan.HandEdited = await HandEditedAsync(plan, ct);
            (plan.OldShifts, plan.ToRemove) = await OldShiftsAsync(tenantId, draft, plan.Today, ct, plan.ToCarry.Select(s => s.Id).ToHashSet());
            plan.OldShifts = plan.OldShifts with { Carried = plan.ToCarry.Count };
        }

        if (plan.NewPatterns.Count > 0)
        {
            var handMade = await _db.ShiftPatterns.AsNoTracking()
                .Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId == null && p.IsActive).ToListAsync(ct);
            plan.Overlaps = handMade.Where(p => plan.NewPatterns.Any(made => Overlap(p, made))).ToList();
        }
    }

    /// <summary>
    /// Locks the rows of the earlier revisions' shifts from <paramref name="from"/> on, inside the approval's transaction and before any of them is read (PostgreSQL; EF InMemory has no row locks). An
    /// assignment, a publish or a note another request is making waits for this approval, or has committed and is read: a shift is never carried or removed on a stale "nobody is on it". In id order, so two
    /// lockers of the same rows queue instead of deadlocking, and bounded as the roster lock is: a long wait or a deadlock is the busy answer, never a 500.
    /// </summary>
    private async Task LockOldShiftsAsync(Guid[] patternIds, DateOnly from, CancellationToken ct)
    {
        if (patternIds.Length == 0 || !_db.Database.IsNpgsql()) return;
        var sql = string.Create(CultureInfo.InvariantCulture,
            $@"SET LOCAL lock_timeout = {(int)_generator.LockWait.TotalMilliseconds}; SELECT 1 FROM ""Shifts"" WHERE ""ShiftPatternId"" = ANY({{0}}) AND ""ServiceDate"" >= {{1}} ORDER BY ""Id"" FOR UPDATE; SET LOCAL lock_timeout TO DEFAULT");
        try
        {
            await _db.Database.ExecuteSqlRawAsync(sql, new object[] { patternIds, from }, ct);
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.LockNotAvailable or PostgresErrorCodes.DeadlockDetected)
        {
            throw new RosterBusyException();
        }
    }

    /// <summary>
    /// Carry-over: an ended pattern whose new pattern is the same support hands on its default worker, and its shifts from this revision's start (or today) to its end, in whatever state they are in (a worker stays on, a
    /// cancelled day stays cancelled), and the new pattern makes none on their days. Only what is left over is removed or listed. Approving a revision ends every pattern of the one before and makes them
    /// all again, so without this every shift of a support that did not change would get a second, open one beside it.
    /// </summary>
    private async Task CarryOverAsync(ServiceAgreementDraft draft, Plan plan, CancellationToken ct)
    {
        // A default worker is carried only while that user is active: an archived one leaves the support with no default staff.
        var active = await ActiveUsersAsync(plan.ToEnd, ct);
        // plan.ToEnd runs oldest revision first, so when two ended generations are the same support, the newest revision's default worker and switch are the ones kept. Within one generation each new
        // pattern is matched once: the block ids are not compared (the agreement builder renumbers them on every save), so the day, worker slot, times and asks are what pair them.
        var taken = new HashSet<(Guid Made, Guid Source)>();
        foreach (var old in plan.ToEnd)
        {
            if (plan.NewPatterns.FirstOrDefault(made => !taken.Contains((made.Id, old.SourceDraftId!.Value)) && SameSupport(old, made)) is not { } same) continue;
            taken.Add((same.Id, old.SourceDraftId!.Value));
            plan.CarryTo[old.Id] = same;
            // The same support keeps its default worker too (a coordinator's own choice, not the agreement's); only a changed support starts with none.
            same.DefaultUserId = old.DefaultUserId is { } user && active.Contains(user) ? user : null;
            // And stays switched off when a coordinator switched it off (the delete refusal tells them to). A pattern an approval switched off because it ended before it began is not that choice.
            if (old.EffectiveTo is not { } to || to >= old.EffectiveFrom) same.IsActive = old.IsActive;
        }
        if (plan.CarryTo.Count == 0) return;

        var from = draft.AgreementStartDate > plan.Today ? draft.AgreementStartDate : plan.Today;
        var carriedFrom = plan.CarryTo.Keys.ToList();
        // A day the new revision's plan skips for a public holiday is not carried: its new pattern makes no shift that day, so the old one is removed or listed like any other.
        var skipped = DraftJson.ReadQuote(draft.PricingJson)?.HolidayOccurrences.Where(h => h.Skipped).Select(h => (h.BlockId, h.Date)).ToHashSet() ?? new();
        plan.ToCarry = (await _db.Shifts
            .Where(s => s.ShiftPatternId != null && carriedFrom.Contains(s.ShiftPatternId.Value) && s.ServiceDate >= from && s.ServiceDate <= draft.AgreementEndDate)
            .ToListAsync(ct))
            .Where(s => !skipped.Contains((plan.CarryTo[s.ShiftPatternId!.Value].SourceBlockKey!, s.ServiceDate))).ToList();
        plan.Carried = plan.ToCarry.Select(s => (plan.CarryTo[s.ShiftPatternId!.Value].Id, s.ServiceDate)).ToHashSet();
    }

    /// <summary>The default workers of these patterns who are active users: a default worker is handed on only while that user is (an archived one leaves the support with none).</summary>
    private async Task<HashSet<Guid>> ActiveUsersAsync(IEnumerable<ShiftPattern> patterns, CancellationToken ct)
    {
        var ids = patterns.Where(p => p.DefaultUserId is not null).Select(p => p.DefaultUserId!.Value).Distinct().ToList();
        return ids.Count == 0 ? new HashSet<Guid>() : (await _db.Users.Where(u => ids.Contains(u.Id) && u.IsActive).Select(u => u.Id).ToListAsync(ct)).ToHashSet();
    }

    /// <summary>
    /// Agreement PR 2 (D12): a renewal starts the day after the agreement before it ends, so approving it ends none of that agreement's patterns and the carry-over above never meets them. The same
    /// support keeps its default worker all the same, while that user is active, and stays switched off when a coordinator switched it off: the patterns that end the day before this revision starts
    /// hand both on, oldest revision first so the newest wins, each new pattern matched once per revision as the carry-over matches them. The matched ones are recorded, so the preview counts only
    /// the changed supports as starting with no default staff. No shift moves: theirs all end before this revision starts.
    /// </summary>
    private async Task CarryDefaultsIntoRenewalAsync(Plan plan, List<ShiftPattern> old, Dictionary<Guid, int> versionOf, CancellationToken ct)
    {
        // Only the generation being ended, or for a renewal (nothing ended) the one ending the day before: an older generation that a same-start approval ended that day is superseded and hands on nothing.
        var endingBefore = old.Where(p => p.EffectiveTo == plan.EndsOn && (plan.EndsFromVersion is not int from || versionOf[p.SourceDraftId!.Value] >= from))
            .OrderBy(p => versionOf[p.SourceDraftId!.Value]).ToList();
        if (endingBefore.Count == 0) return;
        var active = await ActiveUsersAsync(endingBefore, ct);
        var taken = new HashSet<(Guid Made, Guid Source)>();
        foreach (var ended in endingBefore)
        {
            // A new pattern the carry-over already gave an open pattern's worker keeps it.
            if (plan.NewPatterns.FirstOrDefault(made => !taken.Contains((made.Id, ended.SourceDraftId!.Value)) && !plan.CarryTo.ContainsValue(made) && SameSupport(ended, made)) is not { } same) continue;
            taken.Add((same.Id, ended.SourceDraftId!.Value));
            plan.HandedOn.Add(same);
            same.DefaultUserId = ended.DefaultUserId is { } user && active.Contains(user) ? user : null;
            // The carry-over's own guard: a pattern an approval switched off because it ended before it began is not a coordinator's choice.
            if (ended.EffectiveTo is not { } to || to >= ended.EffectiveFrom) same.IsActive = ended.IsActive;
        }
    }

    /// <summary>
    /// The ended patterns a coordinator edited by hand before agreement PR 1 (their own times, ratio or night type are not what their block says) whose support the new revision has as the agreement
    /// says it: approving puts them back to the agreement's times, so the preview says how many. Read against each pattern's own source revision, mapped as its approval mapped it.
    /// </summary>
    private async Task<int> HandEditedAsync(Plan plan, CancellationToken ct)
    {
        var unmatched = plan.ToEnd.Where(p => !plan.CarryTo.ContainsKey(p.Id)).ToList();
        if (unmatched.Count == 0) return 0;
        var sourceIds = unmatched.Select(p => p.SourceDraftId!.Value).Distinct().ToList();
        var sources = await _db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).Where(d => sourceIds.Contains(d.Id)).ToListAsync(ct);
        var agreed = sources.SelectMany(d => AgreementPatternMapper.Map(d, d.Blocks.OrderBy(b => b.Position).Select(DraftJson.ToDto).Where(b => !b.Unreadable).ToList()))
            .ToDictionary(p => (p.SourceDraftId!.Value, p.SourceBlockKey!, p.DayOfWeek, p.WorkerSlot));
        return unmatched.Count(p => agreed.TryGetValue((p.SourceDraftId!.Value, p.SourceBlockKey!, p.DayOfWeek, p.WorkerSlot), out var said)
            && (p.StartTime, p.EndTime, p.EndsNextDay, p.Ratio, p.NightType) != (said.StartTime, said.EndTime, said.EndsNextDay, said.Ratio, said.NightType)
            && plan.NewPatterns.Any(made => SameSupport(said, made)));
    }

    /// <summary>The same weekly support: the same weekday and worker slot, the same times, ratio and kind of night, and the same asks of a worker. A shift of the one is a shift of the other. The block id is not
    /// compared: the builder renumbers blocks on every save, and two blocks on one day at the same times would overlap, which the engine refuses.</summary>
    public static bool SameSupport(ShiftPattern a, ShiftPattern b) =>
        a.DayOfWeek == b.DayOfWeek && a.WorkerSlot == b.WorkerSlot && a.StartTime == b.StartTime && a.EndTime == b.EndTime
        && a.EndsNextDay == b.EndsNextDay && a.Ratio == b.Ratio && a.NightType == b.NightType && SameAsks(a.RequirementsJson, b.RequirementsJson);

    /// <summary>The same asks of a worker, read as what they mean: PostgreSQL stores them as jsonb, which reads back with its own key order and spacing, so the stored text never equals the mapper's.</summary>
    public static bool SameAsks(string? a, string? b) =>
        a == b || (a is not null && b is not null && DraftJson.Write(DraftJson.ReadRequirements(a)) == DraftJson.Write(DraftJson.ReadRequirements(b)));

    /// <summary>
    /// The shifts of the participant's earlier approved revisions dated from the day this one starts (or today, when that is later) that a coordinator can still tidy: drafts and published shifts, not one
    /// that is under way, handed in for review, finished or cancelled. The unfilled Draft ones are what approval removes, unless something is recorded against one; the rest are kept, counted (open when
    /// nobody is assigned) and listed. Tracked: an approval removes the removable ones in its own save, after <see cref="LockOldShiftsAsync"/> has locked them.
    /// </summary>
    private async Task<(OldShiftsRemainingDto Remaining, List<Shift> Removable)> OldShiftsAsync(Guid tenantId, ServiceAgreementDraft draft, DateOnly today, CancellationToken ct, IReadOnlySet<Guid>? carried = null)
    {
        var earlier = await _db.ServiceAgreementDraftApprovals.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.ParticipantId == draft.ParticipantId && a.DraftVersion < draft.Version)
            .Select(a => new { a.DraftId, a.DraftVersion }).ToListAsync(ct);
        if (earlier.Count == 0) return (new OldShiftsRemainingDto(), new List<Shift>());

        var earlierIds = earlier.Select(a => a.DraftId).ToList();
        var patternIds = await _db.ShiftPatterns.AsNoTracking().Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId != null && earlierIds.Contains(p.SourceDraftId.Value)).Select(p => p.Id).ToListAsync(ct);
        // What a coordinator can still tidy by hand: a shift nobody has started, handed in or finished, on a day that is not past. (The new revision may start in the past.)
        var from = draft.AgreementStartDate > today ? draft.AgreementStartDate : today;
        var shifts = patternIds.Count == 0 ? new List<Shift>() : await _db.Shifts.Include(s => s.User)
            .Where(s => s.ShiftPatternId != null && patternIds.Contains(s.ShiftPatternId.Value) && s.ServiceDate >= from && (s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.Published))
            .ToListAsync(ct);
        // A shift that moves to the new revision's pattern is neither removed nor listed.
        if (carried is { Count: > 0 }) shifts = shifts.Where(s => !carried.Contains(s.Id)).ToList();
        var recorded = await RecordedAgainstAsync(shifts.Where(Unfilled).Select(s => s.Id).ToList(), ct);
        var removable = shifts.Where(s => Unfilled(s) && !recorded.Contains(s.Id)).ToList();
        var kept = shifts.Except(removable).OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ThenBy(s => s.Id).ToList();
        return (new OldShiftsRemainingDto
        {
            Open = kept.Count(s => s.UserId is null), Assigned = kept.Count(s => s.UserId is not null), Removed = removable.Count,
            FirstDate = shifts.Count == 0 ? null : shifts.Min(s => s.ServiceDate), FromVersion = earlier.Max(a => a.DraftVersion),
            Shifts = kept.Take(OldShiftsRemainingDto.MaxListed).Select(s => new OldShiftDto
            {
                Id = s.Id, ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime, EndsNextDay = s.EndsNextDay, Status = s.Status, WorkerName = s.User?.FullName,
            }).ToList(),
        }, removable);
    }

    /// <summary>A Draft nobody is on and nobody wrote on: nobody has been given it or shown it, and a coordinator's own notes on it are not thrown away.</summary>
    private static bool Unfilled(Shift shift) => shift.Status == ShiftStatus.Draft && shift.UserId is null && string.IsNullOrWhiteSpace(shift.Notes);

    /// <summary>
    /// The shifts among <paramref name="ids"/> that something is recorded against: a note, a completion, a handover read or a claim line. Each of those keys restricts a delete, and one refused delete rolls
    /// the whole approval back on PostgreSQL, so such a shift is kept and listed, never removed. Read past the query filters: a row a filter hides still holds its key.
    /// </summary>
    private async Task<HashSet<Guid>> RecordedAgainstAsync(List<Guid> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return new HashSet<Guid>();
        var recorded = new HashSet<Guid>(await _db.ShiftNotes.IgnoreQueryFilters([TenantFilter.Name]).Where(n => ids.Contains(n.ShiftId)).Select(n => n.ShiftId).ToListAsync(ct));
        recorded.UnionWith(await _db.ShiftCompletions.IgnoreQueryFilters([TenantFilter.Name]).Where(c => ids.Contains(c.ShiftId)).Select(c => c.ShiftId).ToListAsync(ct));
        recorded.UnionWith(await _db.HandoverAcknowledgements.IgnoreQueryFilters([TenantFilter.Name]).Where(a => ids.Contains(a.ShiftId)).Select(a => a.ShiftId).ToListAsync(ct));
        recorded.UnionWith(await _db.ClaimLineItems.IgnoreQueryFilters([TenantFilter.Name]).Where(l => l.ShiftId != null && ids.Contains(l.ShiftId.Value)).Select(l => l.ShiftId!.Value).ToListAsync(ct));
        return recorded;
    }

    // ── What stops it: the stored pricing, read as the screen reads it ────────────

    /// <summary>
    /// Why the revision's stored pricing needs a person before it is approved (<see cref="PlanQuote.NeedsReview"/>): each issue the engine kept (merged for a block and reason, as the screen shows them),
    /// each block with a public holiday nobody has decided, and any other line flagged for review. A revision that needs review always has at least one.
    /// </summary>
    private static List<ApprovalReasonDto> PricingReasons(PlanQuote quote, ServiceAgreementDraft draft)
    {
        var reasons = new List<ApprovalReasonDto>();
        if (!quote.NeedsReview) return reasons;

        // One entry for each block and reason, with the most shifts it was met on and the first day: a block with two items missing has two issues that count the same shifts. A rule that names the
        // field or the pair of blocks (InvalidInput, BlocksOverlap) stays one for each message.
        foreach (var group in quote.Issues.GroupBy(i => (i.BlockId, i.Reason, Message: i.Reason is PlanFailureReason.InvalidInput or PlanFailureReason.BlocksOverlap ? i.Message : string.Empty)))
            reasons.Add(new ApprovalReasonDto
            {
                Code = group.Key.Reason.ToString(), Message = group.First().Message, BlockId = group.Key.BlockId, Count = group.Max(i => i.Count),
                FirstDate = group.Where(i => i.FirstDate is not null).Select(i => i.FirstDate).DefaultIfEmpty().Min(),
            });

        foreach (var block in quote.HolidayOccurrences.Where(h => h.Decision == HolidayDecision.Review).GroupBy(h => h.BlockId))
        {
            var first = block.OrderBy(h => h.Date).First();
            var many = block.Count() > 1;
            var what = many ? string.Create(CultureInfo.InvariantCulture, $"{block.Count()} public holidays have no decision yet (the first is {first.HolidayName} on {first.Date:yyyy-MM-dd})")
                : string.Create(CultureInfo.InvariantCulture, $"a public holiday has no decision yet ({first.HolidayName} on {first.Date:yyyy-MM-dd})");
            reasons.Add(new ApprovalReasonDto
            {
                Code = "HolidayUndecided", BlockId = block.Key, Count = block.Count(), FirstDate = first.Date,
                Message = $"Block '{block.Key}': {what}. Choose Charge or Skip for {(many ? "each" : "it")}, then save a new revision.",
            });
        }

        var reasoned = reasons.Select(r => r.BlockId).ToHashSet();
        foreach (var blockKey in draft.Lines.Where(l => (l.Flags & (int)PlannedLineFlags.Review) != 0 && l.BlockKey is not null).Select(l => l.BlockKey!).Distinct().Where(key => !reasoned.Contains(key)))
            reasons.Add(new ApprovalReasonDto { Code = "ReviewFlag", BlockId = blockKey, Message = $"Block '{blockKey}': some of its lines are flagged for review. Decide them in the block's Review step, then save a new revision." });

        if (reasons.Count == 0)
            reasons.Add(new ApprovalReasonDto { Code = "ReviewFlag", Message = "Some lines of this plan are flagged for review. Decide them in each block's Review step, then save a new revision." });
        return reasons;
    }

    // ── Who may approve ───────────────────────────────────────────────────────────

    /// <summary>The caller's role is one of the organisation's approver roles (Admin and Coordinator until it says otherwise), or the caller is a SuperAdmin acting for the organisation. Renewing asks the same (agreement PR 2).</summary>
    public static async Task<bool> MayApproveAsync(PlanPricingService pricing, Guid tenantId, ApprovalCaller caller, CancellationToken ct)
    {
        if (caller.IsSuperAdmin) return true;
        var allowed = PlanPricingPolicy.From(await pricing.FindSettingsAsync(tenantId, ct)).ApproverRoles;
        return caller.Roles.Any(role => allowed.Contains(role, StringComparer.OrdinalIgnoreCase));
    }

    private static ApprovalOutcome NotAnApprover() => new(ApprovalStatus.NotAnApprover, Errors: new[] { "Your role cannot approve agreements in your organisation. An Admin can change who may in Settings, Plan pricing." });

    // ── Reading ───────────────────────────────────────────────────────────────────

    private async Task<(ServiceAgreementDraft Draft, Participant Participant)?> FindAsync(Guid tenantId, Guid participantId, Guid draftId, CancellationToken ct)
    {
        var participant = await _db.Participants.AsNoTracking().FirstOrDefaultAsync(p => p.Id == participantId, ct);
        if (participant is null || participant.TenantId != tenantId) return null;
        var draft = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery()
            .FirstOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        return draft is null ? null : (draft, participant);
    }

    /// <summary>The outcome as it stands in the database now: the revision in full with its approval and the old shifts that remain (counted again when not given).</summary>
    private async Task<ApprovalOutcome> ReadAsync(ApprovalStatus status, Guid tenantId, ServiceAgreementDraft draft, OldShiftsRemainingDto? oldShifts, CancellationToken ct)
    {
        var fresh = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery().FirstAsync(x => x.Id == draft.Id, ct);
        var approval = await _db.ServiceAgreementDraftApprovals.AsNoTracking().FirstAsync(a => a.DraftId == draft.Id, ct);
        return new ApprovalOutcome(status, fresh, approval, oldShifts ?? (await OldShiftsAsync(tenantId, draft, await ProviderTodayAsync(tenantId, ct), ct)).Remaining);
    }

    // ── Small rules ───────────────────────────────────────────────────────────────

    private static DateOnly Earlier(DateOnly a, DateOnly b) => a < b ? a : b;

    /// <summary>The started weeks (StartedWeeks, the board's and Start's rule) from <paramref name="from"/>'s week to the agreement's end, each held to [from, agreement end]: the windows an approval generates into (L6).</summary>
    private async Task<List<(DateOnly From, DateOnly To)>> StartedWindowsAsync(Guid tenantId, DateOnly from, DateOnly agreementEnd, CancellationToken ct)
    {
        if (agreementEnd < from) return new();
        var weeks = await StartedWeeks.MondaysAsync(_db, tenantId, from, agreementEnd, ct);
        return weeks.Order().Select(w => (From: w < from ? from : w, To: Earlier(w.AddDays(6), agreementEnd))).Where(x => x.From <= x.To).ToList();
    }

    private Task<DateOnly> ProviderTodayAsync(Guid tenantId, CancellationToken ct) => ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);

    private const string IntakeNotComplete = "Complete the participant's intake before making them active.";

    /// <summary>"Make active" for a tracked participant: finalises a DRAFT whose intake is complete (open checklist items do not stop it), under the
    /// organisation's activation rule, and fills the started weeks in their own lock pair. Null when done or nothing to do (not a draft); otherwise
    /// the refusal, and nothing is changed. Throws RosterBusyException as PopulateStartedWeeksAsync does. Never call it while holding the roster locks.</summary>
    public async Task<string?> MakeActiveAsync(Participant participant, CancellationToken ct, TimeSpan? lockWait = null)
    {
        if (!participant.IsDraft) return null;
        if (!participant.IntakeCompletedAt.HasValue) return IntakeNotComplete;
        // Warn (the default) activates, Enforce needs evidence. A draft whose services started is active already but has never been
        // through this rule, so it is asked too.
        if ((!participant.IsActive || participant.ServicesStartedAt != null) && await ParticipantReadiness.ActivationBlockAsync(_db, participant, _clock, ct) is var block && block != ActivationBlock.None)
            return ParticipantReadiness.ActivationRefusal(block);
        participant.IsDraft = false;
        participant.UpdatedAt = DateTime.UtcNow;
        participant.IsActive = true;
        await PopulateStartedWeeksAsync(participant.TenantId, participant.Id, ct, lockWait);
        await _db.SaveChangesAsync(ct);
        return null;
    }

    public const string ActivationAuditReason = "Agreement approved";
    public const string ActivationBusyReason = "the roster was busy. Use Make active on their onboarding checklist";
    public const string ActivationFailedReason = "it could not be done just now. Use Make active on their onboarding checklist";
    /// <summary>Short, so a single approve answers inside its client timeout and a batch keeps moving.</summary>
    public static readonly TimeSpan ActivationLockWait = TimeSpan.FromSeconds(3);

    /// <summary>After an approval has COMMITTED (its locks released): moves the participant to Active when the organisation's setting says so,
    /// by MakeActiveAsync. Never throws except on cancellation: the approval stands whatever happens here, and a failure is NotActivated.</summary>
    public async Task<ApprovalActivationDto> ActivateAfterApprovalAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        try
        {
            if (!PlanPricingPolicy.From(await _pricing.FindSettingsAsync(tenantId, ct)).ApprovalActivatesParticipant) return new() { Result = ActivationResults.Off };
            var p = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId && x.TenantId == tenantId, ct);
            if (p is null) return NotMoved("they're no longer on the participant list");
            if (!p.IsDraft) return p.IsActive ? new() { Result = ActivationResults.AlreadyActive, Reason = "already active" } : NotMoved("they're archived");   // never restored
            if (!p.IntakeCompletedAt.HasValue) return NotMoved("intake not finished");
            return await MakeActiveAsync(p, ct, ActivationLockWait) is { } refused ? NotMoved(ReasonWords(refused)) : new() { Result = ActivationResults.Activated };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _db.ChangeTracker.Clear();
            _logger?.LogWarning(ex, "Activating participant {ParticipantId} after an approval failed", participantId);
            return NotMoved(ex is RosterBusyException ? ActivationBusyReason : ActivationFailedReason);
        }
        // The refusal reads after "Not moved to Active: ". ParticipantReadiness's own words stay as they are: Make active's 409 uses them.
        static string ReasonWords(string refusal) => refusal == ParticipantReadiness.ActivationEvidenceRequired ? "their signed agreement isn't recorded yet"
            : refusal == ParticipantReadiness.ActivationFundingRequired ? "their plan budget isn't on the Funding tab yet"
            : char.ToLowerInvariant(refusal[0]) + refusal[1..];
        static ApprovalActivationDto NotMoved(string why) => new() { Result = ActivationResults.NotActivated, Reason = why };
    }

    /// <summary>Fills only approved agreement patterns into roster weeks that are already started after a participant becomes service-eligible.</summary>
    public async Task PopulateStartedWeeksAsync(Guid tenantId, Guid participantId, CancellationToken ct, TimeSpan? lockWait = null)
    {
        var wait = lockWait ?? _generator.LockWait;
        await using var board = await RosterGenerationLock.AcquireAsync(_db, tenantId, ct, wait, scope: "roster-board");
        await using var held = await RosterGenerationLock.AcquireAsync(_db, participantId, ct, wait);

        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId && p.TenantId == tenantId, ct);
        // The lifecycle endpoint has already applied its readiness policy before entering this
        // lock. EF returns that tracked transition here, allowing its shifts and state to save
        // together; infrastructure must not depend on the API-only readiness implementation.
        if (participant is null || !participant.IsActive)
            return;

        var today = await ProviderTodayAsync(tenantId, ct);
        var patterns = await _db.ShiftPatterns
            .Where(p => p.ParticipantId == participantId && p.TenantId == tenantId && p.IsActive && p.SourceDraftId != null
                && _db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == p.SourceDraftId))
            .ToListAsync(ct);
        // Commit the tracked lifecycle transition while the board lock is still held even when
        // approval has not produced patterns yet. A concurrent approval then observes the
        // participant as eligible and fills its started weeks itself.
        if (patterns.Count == 0)
        {
            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            await board.CommitAsync(ct);
            return;
        }

        var made = new List<Shift>();
        foreach (var group in patterns.GroupBy(p => p.EffectiveTo))
        {
            var end = group.Key;
            if (end is null || end < today) continue;
            foreach (var (from, to) in await StartedWindowsAsync(tenantId, today, end.Value, ct))
                made.AddRange((await _generator.AddAsync(_db, group.ToList(), from, to, ct)).MadeShifts);
        }
        await _availability.MarkRegularsAwayAsync(made, ct);
        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        await board.CommitAsync(ct);
    }

    private static string OverlapMessage(int count) => count == 1
        ? "A hand-made pattern of this participant overlaps one this approval makes. It is not changed or ended. Tick the box to confirm that, then approve."
        : string.Create(CultureInfo.InvariantCulture, $"{count} hand-made patterns of this participant overlap ones this approval makes. They are not changed or ended. Tick the box to confirm that, then approve.");

    private const int MinutesInWeek = 7 * 1440;

    /// <summary>
    /// Two patterns whose dates and weekly times overlap. A weekly window is minutes from midnight at the start of Sunday, so a night that runs into the next day is the minutes it really covers (a
    /// Friday 20:00 to Saturday 06:00 meets a Saturday 02:00 to 04:00), and windows are also compared a week apart so one that runs past Saturday night meets a Sunday morning. Windows that only touch
    /// (one ends when the other starts) do not overlap. A pattern is on from its first to its last date, a day longer when its last night runs on into the next day.
    /// </summary>
    private static bool Overlap(ShiftPattern a, ShiftPattern b)
    {
        if (!DatesMeet(a, b)) return false;
        var (aStart, aEnd) = Window(a);
        var (bStart, bEnd) = Window(b);
        for (var week = -1; week <= 1; week++)
        {
            var offset = week * MinutesInWeek;
            if (aStart < bEnd + offset && bStart + offset < aEnd) return true;
        }
        return false;
    }

    private static bool DatesMeet(ShiftPattern a, ShiftPattern b)
    {
        var aLast = a.EffectiveTo is { } aTo ? aTo.AddDays(a.EndsNextDay ? 1 : 0) : (DateOnly?)null;
        var bLast = b.EffectiveTo is { } bTo ? bTo.AddDays(b.EndsNextDay ? 1 : 0) : (DateOnly?)null;
        return (aLast is null || b.EffectiveFrom <= aLast) && (bLast is null || a.EffectiveFrom <= bLast);
    }

    /// <summary>The minutes from the start of Sunday a pattern's weekly window begins and ends: its weekday's midnight plus its times, running on past midnight when it ends the next day.</summary>
    private static (int Start, int End) Window(ShiftPattern pattern)
    {
        var dayStart = (int)pattern.DayOfWeek * 1440;
        var start = dayStart + pattern.StartTime.Hour * 60 + pattern.StartTime.Minute;
        var end = dayStart + pattern.EndTime.Hour * 60 + pattern.EndTime.Minute + (pattern.EndsNextDay ? 1440 : 0);
        return (start, end);
    }
}
