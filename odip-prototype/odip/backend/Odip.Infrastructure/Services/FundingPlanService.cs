using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Application.Funding;
using Odip.Domain.Billing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The outcome of a save of a plan budget: the plan, or exactly one of "not found", the plain-words reasons it was refused (a 400), a stale revision (a 409 carrying
/// the revision the plan is at) or an overlap with another plan of the participant (a 409 naming it).
/// </summary>
public sealed class FundingSaveResult
{
    public FundingPlanDto? Plan { get; init; }
    public bool NotFound { get; init; }
    public string? NotFoundMessage { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = Array.Empty<string>();
    public int? CurrentRevision { get; init; }
    public FundingPlanOverlapDto? Overlap { get; init; }
}

/// <summary>
/// A participant's plan budget (budget feature, phase 1): list, create, replace, delete, the explicit "use this plan's dates on the profile", and the read-only
/// Billing hint. Every method takes the tenant the controller already resolved and re-checks that the participant belongs to it (an id from another organisation is
/// "not found", never a leak). The rules are <see cref="FundingPlanValidator"/>'s; what only the database can answer is here:
/// <list type="bullet">
/// <item><b>Overlap.</b> The plans of one participant must not overlap in dates. A create or replace takes <see cref="FundingPlanLock"/> (the participant's row, held until the
///   save commits) and checks under it, so two requests at once for overlapping plans leave at most one: the second waits, reads the first, and is refused. The unique index on
///   (tenant, participant, plan start) is the backstop for two plans starting the same day, and a unique violation is answered as the same overlap.</item>
/// <item><b>Stale saves.</b> A replace carries the revision it was made from; under the same lock, a mismatch is a 409 carrying the current revision. Revision goes up by one on
///   every replace.</item>
/// <item><b>Every writer takes the lock.</b> A delete and "use this plan's dates" take <see cref="FundingPlanLock"/> too and read under it, so neither races a replace in flight (a delete
///   committing between a replace's read and its UPDATE would have failed the replace with a concurrency error, a 500, instead of "plan not found").</item>
/// <item><b>Replace is a merge.</b> The pools and periods of a replaced plan are matched to the stored ones by what they are (pool: category and management type; period: its first
///   day), so a pool or period that stays keeps its id and an edit is audited as the fields that changed, not as a delete and re-insert of everything.</item>
/// </list>
/// Dates are calendar days (DateOnly); instants come from the injected clock, so tests fix "now".
/// </summary>
public sealed class FundingPlanService
{
    public const string ParticipantNotFound = "Participant not found.";
    public const string PlanNotFound = "Plan not found.";
    public const string StaleMessage = "This plan was changed by someone else since you opened it. Load the latest version, then make your change again.";
    public const string RevisionRequired = "Say which version of the plan this change was made from (revision), so a change made by someone else in the meantime is not lost.";

    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public FundingPlanService(OdipDbContext db, TimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    // ── Reading ─────────────────────────────────────────────────────────────

    /// <summary>Every plan of the participant, newest first, with the plan dates the profile carries. Null when the participant is not in this tenant.</summary>
    public async Task<FundingPlansDto?> ListAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var profile = await FindProfileDatesAsync(tenantId, participantId, ct);
        if (profile is null) return null;

        var plans = await _db.FundingPlans.AsNoTracking()
            .Include(p => p.Pools).ThenInclude(p => p.Periods)
            .AsSplitQuery()
            .Where(p => p.ParticipantId == participantId && p.TenantId == tenantId)
            .OrderByDescending(p => p.PlanStart)
            .ToListAsync(ct);

        return new FundingPlansDto { Plans = plans.Select(ToDto).ToList(), ProfilePlanDates = profile };
    }

    /// <summary>
    /// What the participant's Billing funding sources already say, as a one-off starting point: the active ones on an NDIS route with a budget above zero (the same filter
    /// the plan builder's budget bar uses, minus its agreement window). Read-only: nothing is written and no Billing row is changed. Null when the participant is not in this tenant.
    /// </summary>
    public async Task<BillingSourcesHintDto?> BillingSourcesHintAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        if (await FindProfileDatesAsync(tenantId, participantId, ct) is null) return null;

        var rows = await HintSources(tenantId, participantId).OrderBy(f => f.PlanStartDate).ThenBy(f => f.Id).ToListAsync(ct);
        if (rows.Count == 0) return new BillingSourcesHintDto();

        // The management type of the rows holding most of the money (a Core pool has one management type, so a mixture is reduced to the biggest).
        var biggest = rows.GroupBy(f => f.RouteType).OrderByDescending(g => g.Sum(f => f.Budget ?? 0m)).First().Key;
        return new BillingSourcesHintDto
        {
            Total = rows.Sum(f => f.Budget ?? 0m),
            PlanStart = rows.Where(f => f.PlanStartDate is not null).Min(f => f.PlanStartDate),
            PlanEnd = rows.Where(f => f.PlanEndDate is not null).Max(f => f.PlanEndDate),
            ManagementType = biggest switch
            {
                FundingRouteType.PlanManaged => PlanType.PlanManaged,
                FundingRouteType.SelfManaged => PlanType.SelfManaged,
                _ => PlanType.AgencyManaged,
            },
            Rows = rows.Select(f => new BillingSourceHintRowDto
            {
                Id = f.Id, RouteType = f.RouteType, BudgetCategory = f.BudgetCategory, Budget = f.Budget ?? 0m,
                PlanStartDate = f.PlanStartDate, PlanEndDate = f.PlanEndDate, PayerName = f.PayerName,
            }).ToList(),
        };
    }

    /// <summary>The Billing funding sources the hint reads: the participant's active ones on an NDIS route with a budget above zero. A query of its own so a test can show it translates to SQL.</summary>
    public IQueryable<FundingSource> HintSources(Guid tenantId, Guid participantId) =>
        _db.FundingSources.AsNoTracking()
            .Where(f => f.ParticipantId == participantId && f.TenantId == tenantId && f.IsActive && f.Budget > 0
                && (f.RouteType == FundingRouteType.AgencyManaged || f.RouteType == FundingRouteType.PlanManaged || f.RouteType == FundingRouteType.SelfManaged));

    // ── Writing ─────────────────────────────────────────────────────────────

    public async Task<FundingSaveResult> CreateAsync(Guid tenantId, Guid participantId, SaveFundingPlanDto dto, string actor, CancellationToken ct)
    {
        if (await FindProfileDatesAsync(tenantId, participantId, ct) is null) return Missing(ParticipantNotFound);
        var errors = FundingPlanValidator.Validate(dto);
        if (errors.Count > 0) return Refused(errors);

        var overlapAfterRace = false;
        await using (var gate = await FundingPlanLock.AcquireAsync(_db, participantId, ct))
        {
            if (await FindOverlapAsync(tenantId, participantId, dto.PlanStart!.Value, dto.PlanEnd!.Value, exceptPlanId: null, ct) is { } clash)
                return Clash(dto, clash);

            var now = _clock.GetUtcNow().UtcDateTime;
            var plan = new FundingPlan
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Revision = 1,
                CreatedAt = now, UpdatedAt = now, CreatedBy = actor, UpdatedBy = actor,
            };
            ApplyPlanFields(plan, dto);
            foreach (var (pool, index) in dto.Pools!.Select((p, i) => (p, i)))
            {
                var stored = new FundingPool { Id = Guid.NewGuid(), TenantId = tenantId, FundingPlanId = plan.Id };
                ApplyPoolFields(stored, pool, index);
                foreach (var (period, position) in OrderedPeriods(pool).Select((p, i) => (p, i)))
                {
                    var storedPeriod = new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = stored.Id };
                    ApplyPeriodFields(storedPeriod, period, position);
                    stored.Periods.Add(storedPeriod);
                }
                plan.Pools.Add(stored);
            }

            _db.FundingPlans.Add(plan);
            try
            {
                await _db.SaveChangesAsync(ct);
                await gate.CommitAsync(ct);
                return new FundingSaveResult { Plan = ToDto(plan) };
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                overlapAfterRace = true;
            }
        }

        return await RefuseAfterRaceAsync(tenantId, participantId, dto, exceptPlanId: null, overlapAfterRace, ct);
    }

    public async Task<FundingSaveResult> UpdateAsync(Guid tenantId, Guid participantId, Guid planId, SaveFundingPlanDto dto, string actor, CancellationToken ct)
    {
        if (await FindProfileDatesAsync(tenantId, participantId, ct) is null) return Missing(ParticipantNotFound);
        var errors = FundingPlanValidator.Validate(dto);
        if (dto.Revision is null) errors.Add(RevisionRequired);
        if (errors.Count > 0) return Refused(errors);

        var overlapAfterRace = false;
        await using (var gate = await FundingPlanLock.AcquireAsync(_db, participantId, ct))
        {
            // Read under the lock: whatever the request that held it before this one committed is what is read here.
            var plan = await _db.FundingPlans
                .Include(p => p.Pools).ThenInclude(p => p.Periods)
                .AsSplitQuery()
                .FirstOrDefaultAsync(p => p.Id == planId && p.ParticipantId == participantId && p.TenantId == tenantId, ct);
            if (plan is null) return Missing(PlanNotFound);

            if (plan.Revision != dto.Revision)
                return new FundingSaveResult { CurrentRevision = plan.Revision, Errors = new[] { StaleMessage } };

            if (await FindOverlapAsync(tenantId, participantId, dto.PlanStart!.Value, dto.PlanEnd!.Value, exceptPlanId: plan.Id, ct) is { } clash)
                return Clash(dto, clash);

            ApplyPlanFields(plan, dto);
            plan.Revision += 1;
            plan.UpdatedAt = _clock.GetUtcNow().UtcDateTime;
            plan.UpdatedBy = actor;
            MergePools(plan, dto, tenantId);

            try
            {
                await _db.SaveChangesAsync(ct);
                await gate.CommitAsync(ct);
                return new FundingSaveResult { Plan = ToDto(plan) };
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                overlapAfterRace = true;
            }
        }

        return await RefuseAfterRaceAsync(tenantId, participantId, dto, exceptPlanId: planId, overlapAfterRace, ct);
    }

    /// <summary>
    /// Deletes the plan with its pools and periods, each audited (they are loaded first so the audit sees every row). False when there is no such plan for this participant in this
    /// tenant. Like every other writer it takes <see cref="FundingPlanLock"/> and reads under it: a replace that is in flight holds the participant, so the delete waits for it and then
    /// finds the plan as the replace left it, instead of removing a plan the replace's UPDATE was about to touch (which would fail it with a concurrency error, a 500).
    /// </summary>
    public async Task<bool> DeleteAsync(Guid tenantId, Guid participantId, Guid planId, CancellationToken ct)
    {
        // The participant is checked in this tenant before the lock's raw SQL runs: the lock names a row by id and knows nothing of tenants.
        if (await FindProfileDatesAsync(tenantId, participantId, ct) is null) return false;

        await using var gate = await FundingPlanLock.AcquireAsync(_db, participantId, ct);
        var plan = await _db.FundingPlans
            .Include(p => p.Pools).ThenInclude(p => p.Periods)
            .AsSplitQuery()
            .FirstOrDefaultAsync(p => p.Id == planId && p.ParticipantId == participantId && p.TenantId == tenantId, ct);
        if (plan is null) return false;

        _db.FundingPlans.Remove(plan);
        await _db.SaveChangesAsync(ct);
        await gate.CommitAsync(ct);
        return true;
    }

    /// <summary>
    /// Sets the participant's profile plan dates to the plan's. Explicit and never automatic: the screen offers it when the two differ and the user asks. The audit
    /// interceptor writes the participant's change. Null when there is no such plan; <see cref="ApplyPlanDatesResultDto.Changed"/> is false when the profile already matched.
    /// </summary>
    public async Task<ApplyPlanDatesResultDto?> ApplyDatesToProfileAsync(Guid tenantId, Guid participantId, Guid planId, CancellationToken ct)
    {
        // Checked in this tenant before the lock's raw SQL runs, as in DeleteAsync.
        if (await FindProfileDatesAsync(tenantId, participantId, ct) is null) return null;

        // Under the lock, so the dates copied are those of the plan as an in-flight replace left it, never of a version that replace is about to supersede.
        await using var gate = await FundingPlanLock.AcquireAsync(_db, participantId, ct);
        var plan = await _db.FundingPlans.AsNoTracking()
            .Where(p => p.Id == planId && p.ParticipantId == participantId && p.TenantId == tenantId)
            .Select(p => new { p.PlanStart, p.PlanEnd })
            .FirstOrDefaultAsync(ct);
        if (plan is null) return null;

        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId && p.TenantId == tenantId, ct);
        if (participant is null) return null;

        var changed = participant.PlanStartDate != plan.PlanStart || participant.PlanEndDate != plan.PlanEnd;
        if (changed)
        {
            participant.PlanStartDate = plan.PlanStart;
            participant.PlanEndDate = plan.PlanEnd;
            participant.UpdatedAt = _clock.GetUtcNow().UtcDateTime;
            await _db.SaveChangesAsync(ct);
        }

        await gate.CommitAsync(ct);
        return new ApplyPlanDatesResultDto { Start = plan.PlanStart, End = plan.PlanEnd, Changed = changed };
    }

    // ── Merging a replace into the stored plan ──────────────────────────────

    private void MergePools(FundingPlan plan, SaveFundingPlanDto dto, Guid tenantId)
    {
        var wanted = dto.Pools!;
        var wantedKeys = wanted.Select(w => (w.PaceCategory, w.ManagementType!.Value)).ToHashSet();
        var stored = plan.Pools.ToDictionary(p => (p.PaceCategory, p.ManagementType));

        // A pool the plan no longer has goes with its periods (they are loaded, so the cascade is tracked and audited).
        foreach (var gone in plan.Pools.Where(p => !wantedKeys.Contains((p.PaceCategory, p.ManagementType))).ToList())
            _db.FundingPools.Remove(gone);

        for (var index = 0; index < wanted.Count; index++)
        {
            var pool = wanted[index];
            var key = (pool.PaceCategory, pool.ManagementType!.Value);
            var isNew = !stored.TryGetValue(key, out var target);
            if (isNew)
            {
                target = new FundingPool { Id = Guid.NewGuid(), TenantId = tenantId, FundingPlanId = plan.Id };
                ApplyPoolFields(target, pool, index);
                foreach (var (period, position) in OrderedPeriods(pool).Select((p, i) => (p, i)))
                {
                    var storedPeriod = new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = target.Id };
                    ApplyPeriodFields(storedPeriod, period, position);
                    target.Periods.Add(storedPeriod);
                }
                // Added explicitly: a new row with a preset key reached through a tracked parent's collection would be treated as an existing one (an UPDATE).
                _db.FundingPools.Add(target);
                continue;
            }

            ApplyPoolFields(target!, pool, index);
            MergePeriods(target!, pool, tenantId);
        }
    }

    private void MergePeriods(FundingPool pool, SaveFundingPoolDto wanted, Guid tenantId)
    {
        var periods = OrderedPeriods(wanted);
        var wantedStarts = periods.Select(p => p.PeriodStart!.Value).ToHashSet();
        var stored = pool.Periods.ToDictionary(p => p.PeriodStart);

        foreach (var gone in pool.Periods.Where(p => !wantedStarts.Contains(p.PeriodStart)).ToList())
            _db.FundingPeriods.Remove(gone);

        for (var position = 0; position < periods.Count; position++)
        {
            var period = periods[position];
            if (stored.TryGetValue(period.PeriodStart!.Value, out var target))
            {
                ApplyPeriodFields(target, period, position);
                continue;
            }

            var added = new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = pool.Id };
            ApplyPeriodFields(added, period, position);
            _db.FundingPeriods.Add(added);
        }
    }

    private static void ApplyPlanFields(FundingPlan plan, SaveFundingPlanDto dto)
    {
        plan.PlanStart = dto.PlanStart!.Value;
        plan.PlanEnd = dto.PlanEnd!.Value;
        plan.ReassessmentDate = dto.ReassessmentDate;
        plan.PeriodLengthMonths = dto.PeriodLengthMonths;
        plan.Evidence = dto.Evidence!.Value;
        plan.ConfirmedOn = dto.ConfirmedOn;
        plan.ConfirmedByName = Clean(dto.ConfirmedByName);
        plan.Notes = Clean(dto.Notes);
    }

    private static void ApplyPoolFields(FundingPool pool, SaveFundingPoolDto dto, int position)
    {
        pool.Position = position;
        pool.Kind = dto.Kind!.Value;
        pool.PaceCategory = dto.PaceCategory;
        pool.ManagementType = dto.ManagementType!.Value;
        pool.Name = Clean(dto.Name) ?? (dto.Kind == FundingPoolKind.CoreFlexible ? PaceCategories.CoreFlexibleName : PaceCategories.NameOf(dto.PaceCategory)!);
        pool.Notes = Clean(dto.Notes);
    }

    private static void ApplyPeriodFields(FundingPeriod period, SaveFundingPeriodDto dto, int position)
    {
        period.Position = position;
        period.PeriodStart = dto.PeriodStart!.Value;
        period.PeriodEnd = dto.PeriodEnd!.Value;
        period.PlanAmount = dto.PlanAmount!.Value;
        period.SetAside = dto.SetAside;
    }

    private static List<SaveFundingPeriodDto> OrderedPeriods(SaveFundingPoolDto pool) => pool.Periods!.OrderBy(p => p.PeriodStart).ToList();

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    // ── Overlap, and the answers ────────────────────────────────────────────

    private sealed record Clashing(Guid Id, DateOnly Start, DateOnly End);

    /// <summary>The participant's plans that share a day with start..end (inclusive at both ends), other than <paramref name="exceptPlanId"/>. A query of its own so a test can show it translates to SQL.</summary>
    public IQueryable<FundingPlan> PlansOverlapping(Guid tenantId, Guid participantId, DateOnly start, DateOnly end, Guid? exceptPlanId) =>
        _db.FundingPlans.AsNoTracking()
            .Where(p => p.ParticipantId == participantId && p.TenantId == tenantId && (exceptPlanId == null || p.Id != exceptPlanId) && p.PlanStart <= end && start <= p.PlanEnd);

    private async Task<Clashing?> FindOverlapAsync(Guid tenantId, Guid participantId, DateOnly start, DateOnly end, Guid? exceptPlanId, CancellationToken ct) =>
        await PlansOverlapping(tenantId, participantId, start, end, exceptPlanId)
            .OrderBy(p => p.PlanStart)
            .Select(p => new Clashing(p.Id, p.PlanStart, p.PlanEnd))
            .FirstOrDefaultAsync(ct);

    private static FundingSaveResult Clash(SaveFundingPlanDto dto, Clashing clash) => new()
    {
        Errors = new[]
        {
            string.Create(CultureInfo.InvariantCulture,
                $"This plan ({Say(dto.PlanStart!.Value)} to {Say(dto.PlanEnd!.Value)}) overlaps the plan that runs {Say(clash.Start)} to {Say(clash.End)}. Change the dates, or edit that plan."),
        },
        Overlap = new FundingPlanOverlapDto { ConflictingPlanId = clash.Id, ConflictingPlanStart = clash.Start, ConflictingPlanEnd = clash.End },
    };

    /// <summary>
    /// A unique violation on the save: another request wrote a plan in the gap (the lock narrows this to nothing on PostgreSQL, so it is the backstop for the index on plan
    /// start). Forget what this context tried to write and answer as the overlap it is; with no overlapping plan to name, the failure was something else and is thrown.
    /// </summary>
    private async Task<FundingSaveResult> RefuseAfterRaceAsync(Guid tenantId, Guid participantId, SaveFundingPlanDto dto, Guid? exceptPlanId, bool raced, CancellationToken ct)
    {
        if (!raced) throw new InvalidOperationException("A refused save had no reason.");
        _db.ChangeTracker.Clear();
        var clash = await FindOverlapAsync(tenantId, participantId, dto.PlanStart!.Value, dto.PlanEnd!.Value, exceptPlanId, ct);
        if (clash is null) throw new DbUpdateException("A unique index refused the plan budget and no overlapping plan was found.");
        return Clash(dto, clash);
    }

    private static bool IsUniqueViolation(DbUpdateException ex) => ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static FundingSaveResult Missing(string message) => new() { NotFound = true, NotFoundMessage = message, Errors = new[] { message } };

    private static FundingSaveResult Refused(IReadOnlyList<string> errors) => new() { Errors = errors };

    private async Task<ProfilePlanDatesDto?> FindProfileDatesAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var profile = await _db.Participants.AsNoTracking()
            .Where(p => p.Id == participantId && p.TenantId == tenantId)
            .Select(p => new { p.PlanStartDate, p.PlanEndDate })
            .FirstOrDefaultAsync(ct);
        return profile is null ? null : new ProfilePlanDatesDto { Start = profile.PlanStartDate, End = profile.PlanEndDate };
    }

    // ── The wire shape ──────────────────────────────────────────────────────

    private static FundingPlanDto ToDto(FundingPlan plan) => new()
    {
        Id = plan.Id, ParticipantId = plan.ParticipantId, PlanStart = plan.PlanStart, PlanEnd = plan.PlanEnd, ReassessmentDate = plan.ReassessmentDate,
        PeriodLengthMonths = plan.PeriodLengthMonths, Evidence = plan.Evidence, ConfirmedOn = plan.ConfirmedOn, ConfirmedByName = plan.ConfirmedByName, Notes = plan.Notes,
        Revision = plan.Revision, CreatedAt = plan.CreatedAt, UpdatedAt = plan.UpdatedAt,
        Pools = plan.Pools.OrderBy(p => p.Position).Select(ToDto).ToList(),
    };

    private static FundingPoolDto ToDto(FundingPool pool)
    {
        var periods = pool.Periods.OrderBy(p => p.PeriodStart).ToList();
        return new FundingPoolDto
        {
            Id = pool.Id, Position = pool.Position, Kind = pool.Kind, PaceCategory = pool.PaceCategory, ManagementType = pool.ManagementType, Name = pool.Name, Notes = pool.Notes,
            PlanTotal = periods.Sum(p => p.PlanAmount),
            // A pool's set-aside is on every period or on none: a total only means something when every period has one.
            SetAsideTotal = periods.Count > 0 && periods.All(p => p.SetAside is not null) ? periods.Sum(p => p.SetAside!.Value) : null,
            Periods = periods.Select(p => new FundingPeriodDto
            {
                Id = p.Id, Position = p.Position, PeriodStart = p.PeriodStart, PeriodEnd = p.PeriodEnd, PlanAmount = p.PlanAmount, SetAside = p.SetAside,
            }).ToList(),
        };
    }

    private static string Say(DateOnly day) => day.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
}
