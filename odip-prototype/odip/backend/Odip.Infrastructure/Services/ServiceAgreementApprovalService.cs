using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
    IReadOnlyList<string>? Errors = null, DraftApprovalPreviewDto? Preview = null, int? NewestVersion = null);

/// <summary>
/// "Mark approved" (plan builder, phase D). Approving the NEWEST revision of an agreement draft, for a caller whose role the organisation lets approve, in one transaction: records who and when,
/// makes the weekly roster patterns of the revision's blocks (<see cref="AgreementPatternMapper"/>), ends the patterns of the revisions approved before it the day before this one starts, and, when the
/// participant may be rostered, generates open shifts from the provider's today up to the horizon (56 days; <see cref="RosterTopUpOptions"/>) through <see cref="RosterShiftGenerator"/>. No shift that
/// exists is changed, cancelled or deleted: the old revision's shifts are counted for a coordinator to tidy by hand. There is no un-approving: a change is a new revision, approved in its turn.
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
    private readonly RosterTopUpOptions _options;
    private readonly ShiftPatternExpander _expander = new();

    public ServiceAgreementApprovalService(OdipDbContext db, IRosterPlacementGate gate, RosterShiftGenerator? generator = null, PlanPricingService? pricing = null, TimeProvider? clock = null, IConfiguration? configuration = null)
    {
        _db = db;
        _gate = gate;
        _generator = generator ?? new RosterShiftGenerator();
        _pricing = pricing ?? new PlanPricingService(db);
        _clock = clock ?? TimeProvider.System;
        _options = RosterTopUpOptions.From(configuration);
    }

    // ── Preview ───────────────────────────────────────────────────────────────────

    /// <summary>What approving would do, with nothing done. Not found for another organisation's participant or revision; not an approver when the caller's role may not approve.</summary>
    public async Task<ApprovalOutcome> PreviewAsync(Guid tenantId, Guid participantId, Guid draftId, ApprovalCaller caller, CancellationToken ct)
    {
        var found = await FindAsync(tenantId, participantId, draftId, ct);
        if (found is null) return new ApprovalOutcome(ApprovalStatus.NotFound, Errors: new[] { "Draft not found." });
        if (!await MayApproveAsync(tenantId, caller, ct)) return NotAnApprover();

        var (draft, participant) = found.Value;
        var plan = await PlanAsync(tenantId, draft, participant, ct);
        return new ApprovalOutcome(ApprovalStatus.Previewed, draft, plan.Existing, Preview: plan.ToPreview(), NewestVersion: plan.NewestVersion);
    }

    // ── Approve ───────────────────────────────────────────────────────────────────

    public async Task<ApprovalOutcome> ApproveAsync(Guid tenantId, Guid participantId, Guid draftId, bool acknowledgeOverlaps, ApprovalCaller caller, CancellationToken ct)
    {
        var found = await FindAsync(tenantId, participantId, draftId, ct);
        if (found is null) return new ApprovalOutcome(ApprovalStatus.NotFound, Errors: new[] { "Draft not found." });
        if (!await MayApproveAsync(tenantId, caller, ct)) return NotAnApprover();

        try
        {
            return await ApproveCoreAsync(tenantId, found.Value.Draft, found.Value.Participant, acknowledgeOverlaps, caller, ct);
        }
        // Another change to the participant's roster held the lock for too long: nothing was changed.
        catch (RosterBusyException busy)
        {
            return new ApprovalOutcome(ApprovalStatus.Busy, Errors: new[] { busy.Message });
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
    }

    private async Task<ApprovalOutcome> ApproveCoreAsync(Guid tenantId, ServiceAgreementDraft draft, Participant participant, bool acknowledgeOverlaps, ApprovalCaller caller, CancellationToken ct)
    {
        // Approved already: the same answer again, nothing written.
        if (await _db.ServiceAgreementDraftApprovals.AsNoTracking().AnyAsync(a => a.DraftId == draft.Id, ct))
            return await ReadAsync(ApprovalStatus.AlreadyApproved, tenantId, draft, null, ct);

        // Everything below is read and written holding the participant's roster lock (PostgreSQL): a generation, or another approval, that is under way finishes first, and what this one reads is
        // what it commits. The lock also makes a second approval of the same revision wait, and find the first one's approval.
        await using var held = await RosterGenerationLock.AcquireAsync(_db, draft.ParticipantId, ct, _generator.LockWait);
        if (await _db.ServiceAgreementDraftApprovals.AsNoTracking().AnyAsync(a => a.DraftId == draft.Id, ct))
            return await ReadAsync(ApprovalStatus.AlreadyApproved, tenantId, draft, null, ct);

        var plan = await PlanAsync(tenantId, draft, participant, ct);
        if (plan.Superseded) return new ApprovalOutcome(ApprovalStatus.Superseded, Errors: new[] { SupersededMessage }, NewestVersion: plan.NewestVersion);
        if (plan.Reasons.Count > 0) return new ApprovalOutcome(ApprovalStatus.Refused, Errors: plan.Reasons.Select(r => r.Message).ToList());
        if (plan.Overlaps.Count > 0 && !acknowledgeOverlaps)
            return new ApprovalOutcome(ApprovalStatus.Refused, Errors: new[] { OverlapMessage(plan.Overlaps.Count) });

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

        if (plan.Ready && plan.From <= plan.HorizonEnd)
        {
            var generated = await _generator.AddAsync(_db, plan.NewPatterns, plan.From, plan.HorizonEnd, ct);
            approval.ShiftsCreated = generated.Created;
            approval.FirstShiftDate = generated.FirstDate;
            approval.HorizonEnd = plan.HorizonEnd;
        }

        _db.ServiceAgreementDraftApprovals.Add(approval);
        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
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
        public bool Ready { get; set; }
        public DateOnly From { get; set; }
        public DateOnly HorizonEnd { get; set; }
        public int ShiftsToCreate { get; set; }
        public string? ShiftsNote { get; set; }
        /// <summary>Whether the daily top-up is on: what the confirm screen may promise about shifts after the horizon.</summary>
        public bool TopUpEnabled { get; set; } = true;

        public DraftApprovalPreviewDto ToPreview() => new()
        {
            CanApprove = Existing is null && !Superseded && Reasons.Count == 0,
            AlreadyApproved = Existing is not null,
            Reasons = Reasons.ToList(),
            PatternsToCreate = NewPatterns.Count, PatternsToEnd = ToEnd.Count, EndsFromVersion = EndsFromVersion, EndsOn = ToEnd.Count > 0 ? EndsOn : null,
            ShiftsToCreate = ShiftsToCreate, ShiftsNote = ShiftsNote,
            OldShiftsRemaining = OldShifts,
            OverlappingPatterns = Overlaps.OrderBy(p => p.DayOfWeek).ThenBy(p => p.StartTime).Select(p => new OverlappingPatternDto
            {
                Id = p.Id, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, Notes = p.Notes,
            }).ToList(),
            HorizonEnd = HorizonEnd,
            TopUpEnabled = TopUpEnabled,
        };
    }

    private async Task<Plan> PlanAsync(Guid tenantId, ServiceAgreementDraft draft, Participant participant, CancellationToken ct)
    {
        var plan = new Plan { Draft = draft, EndsOn = draft.AgreementStartDate.AddDays(-1) };

        // The provider's zone and today. Read by the organisation asked about, never by "the first settings row": a SuperAdmin's context sees every organisation's.
        var provider = ProviderTimeZoneResolver.FromState(await _db.ProviderSettings.Where(p => p.TenantId == tenantId).Select(p => p.State).FirstOrDefaultAsync(ct));
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, provider.Zone);
        plan.Today = today;
        plan.From = draft.AgreementStartDate > today ? draft.AgreementStartDate : today;
        plan.HorizonEnd = Earlier(draft.AgreementEndDate, today.AddDays(_options.HorizonDays));
        plan.TopUpEnabled = _options.Enabled;

        plan.Existing = await _db.ServiceAgreementDraftApprovals.AsNoTracking().FirstOrDefaultAsync(a => a.DraftId == draft.Id, ct);
        plan.NewestVersion = await _db.ServiceAgreementDrafts.Where(x => x.TenantId == tenantId && x.ParticipantId == draft.ParticipantId).MaxAsync(x => (int?)x.Version, ct) ?? draft.Version;
        if (plan.Existing is not null)
        {
            plan.Reasons.Add(new ApprovalReasonDto { Code = "AlreadyApproved", Message = string.Create(CultureInfo.InvariantCulture, $"This revision was approved for rostering by {plan.Existing.ApprovedByName} on {plan.Existing.ApprovedAt:yyyy-MM-dd}.") });
            plan.OldShifts = await OldShiftsAsync(tenantId, draft, today, ct);
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
        if (!string.Equals(deliveryZone, provider.Id, StringComparison.Ordinal))
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

        await ReadRosterAsync(tenantId, draft, plan, ct);

        plan.Ready = await _gate.MayPlaceAsync(_db, draft.ParticipantId, ct);
        if (!plan.Ready)
        {
            var who = string.IsNullOrWhiteSpace(participant.FirstName) ? "the participant" : participant.FirstName;
            // "Created once they are active" is the daily top-up's work: with it switched off nothing creates them, and the note must not promise it.
            plan.ShiftsNote = _options.Enabled
                ? $"Unfilled shifts are created once {who} is active."
                : $"No shifts are made now, because {who} is not active yet. The daily top-up is off, so make them with Generate on their shift patterns once they are.";
        }
        else if (quote is not null && plan.From <= plan.HorizonEnd)
        {
            var skipped = quote.HolidayOccurrences.Where(h => h.Skipped).Select(h => (h.BlockId, h.Date)).ToHashSet();
            plan.ShiftsToCreate = plan.NewPatterns.Sum(pattern => _expander.Occurrences(pattern, plan.From, plan.HorizonEnd).Count(date => !skipped.Contains((pattern.SourceBlockKey!, date))));
        }

        return plan;
    }

    /// <summary>The roster as it stands: the patterns this approval would end, the old shifts it leaves, and the hand-made patterns that overlap the new ones.</summary>
    private async Task ReadRosterAsync(Guid tenantId, ServiceAgreementDraft draft, Plan plan, CancellationToken ct)
    {
        var earlier = await _db.ServiceAgreementDraftApprovals.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.ParticipantId == draft.ParticipantId && a.DraftVersion < draft.Version)
            .Select(a => new { a.DraftId, a.DraftVersion }).ToListAsync(ct);
        if (earlier.Count > 0)
        {
            var versionOf = earlier.ToDictionary(a => a.DraftId, a => a.DraftVersion);
            var earlierIds = versionOf.Keys.ToList();
            var old = await _db.ShiftPatterns.Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId != null && earlierIds.Contains(p.SourceDraftId.Value)).ToListAsync(ct);
            plan.ToEnd = old.Where(p => p.EffectiveTo is null || p.EffectiveTo > plan.EndsOn).ToList();
            plan.EndsFromVersion = plan.ToEnd.Count > 0 ? plan.ToEnd.Max(p => versionOf[p.SourceDraftId!.Value]) : null;
            plan.OldShifts = await OldShiftsAsync(tenantId, draft, plan.Today, ct);
        }

        if (plan.NewPatterns.Count > 0)
        {
            var handMade = await _db.ShiftPatterns.AsNoTracking()
                .Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId == null && p.IsActive).ToListAsync(ct);
            plan.Overlaps = handMade.Where(p => plan.NewPatterns.Any(made => Overlap(p, made))).ToList();
        }
    }

    /// <summary>
    /// The shifts of the participant's earlier approved revisions dated from the day this one starts (or today, when that is later) that a coordinator can still tidy: drafts and published shifts, not one
    /// that is under way, handed in for review, finished or cancelled. Open when nobody is assigned.
    /// </summary>
    private async Task<OldShiftsRemainingDto> OldShiftsAsync(Guid tenantId, ServiceAgreementDraft draft, DateOnly today, CancellationToken ct)
    {
        var earlier = await _db.ServiceAgreementDraftApprovals.AsNoTracking()
            .Where(a => a.TenantId == tenantId && a.ParticipantId == draft.ParticipantId && a.DraftVersion < draft.Version)
            .Select(a => new { a.DraftId, a.DraftVersion }).ToListAsync(ct);
        if (earlier.Count == 0) return new OldShiftsRemainingDto();

        var earlierIds = earlier.Select(a => a.DraftId).ToList();
        var patternIds = await _db.ShiftPatterns.AsNoTracking().Where(p => p.TenantId == tenantId && p.ParticipantId == draft.ParticipantId && p.SourceDraftId != null && earlierIds.Contains(p.SourceDraftId.Value)).Select(p => p.Id).ToListAsync(ct);
        // What a coordinator can still tidy by hand: a shift nobody has started, handed in or finished, on a day that is not past. (The new revision may start in the past.)
        var from = draft.AgreementStartDate > today ? draft.AgreementStartDate : today;
        var shifts = patternIds.Count == 0 ? new() : await _db.Shifts.AsNoTracking()
            .Where(s => s.ShiftPatternId != null && patternIds.Contains(s.ShiftPatternId.Value) && s.ServiceDate >= from && (s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.Published))
            .Select(s => new { s.UserId, s.ServiceDate }).ToListAsync(ct);
        return new OldShiftsRemainingDto
        {
            Open = shifts.Count(s => s.UserId is null), Assigned = shifts.Count(s => s.UserId is not null),
            FirstDate = shifts.Count == 0 ? null : shifts.Min(s => s.ServiceDate), FromVersion = earlier.Max(a => a.DraftVersion),
        };
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

    /// <summary>The caller's role is one of the organisation's approver roles (Admin and Coordinator until it says otherwise), or the caller is a SuperAdmin acting for the organisation.</summary>
    private async Task<bool> MayApproveAsync(Guid tenantId, ApprovalCaller caller, CancellationToken ct)
    {
        if (caller.IsSuperAdmin) return true;
        var allowed = PlanPricingPolicy.From(await _pricing.FindSettingsAsync(tenantId, ct)).ApproverRoles;
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
        return new ApprovalOutcome(status, fresh, approval, oldShifts ?? await OldShiftsAsync(tenantId, draft, await ProviderTodayAsync(tenantId, ct), ct));
    }

    // ── Small rules ───────────────────────────────────────────────────────────────

    private static DateOnly Earlier(DateOnly a, DateOnly b) => a < b ? a : b;

    private async Task<DateOnly> ProviderTodayAsync(Guid tenantId, CancellationToken ct)
    {
        var provider = ProviderTimeZoneResolver.FromState(await _db.ProviderSettings.Where(p => p.TenantId == tenantId).Select(p => p.State).FirstOrDefaultAsync(ct));
        return ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, provider.Zone);
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
