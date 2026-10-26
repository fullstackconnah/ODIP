using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.Services;

/// <summary>The Upcoming shifts form fields: what the file holds, and for a pattern where it starts and how many weeks it runs.</summary>
public sealed record ImportShiftOptions(ImportShiftShape Shape, DateOnly? From, int? Weeks);

/// <summary>
/// The Upcoming shifts import: a dated list or a weekly pattern becomes Draft shifts, every one checked against the roster rules, and each week they
/// fall in is started through the same code as the roster's Start week. Undo takes back the shifts nobody has touched.
/// </summary>
public sealed partial class OnboardingImportService
{
    public const int MaxShifts = 5000;
    public const string ChooseShape = "Choose what's in your file first.";
    public const string ChoosePatternStart = "Choose the date the pattern starts from.";
    public const string NothingToUndo = "Nothing to undo: every shift from this import has been published or changed since.";

    private static DateOnly MondayOf(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
    private static string SayDay(DateOnly day) => day.ToString("ddd d MMM", CultureInfo.InvariantCulture);

    private static ImportShiftOptions RequireShape(ImportKind kind, ImportShiftOptions? options) =>
        kind == ImportKind.UpcomingShifts ? options ?? throw new ImportException(ChooseShape) : options!;

    /// <summary>The server's side of the horizon: a pattern starts from today up to 28 days ahead and runs 1 to 12 weeks; dated rows are judged row by row.</summary>
    private static (DateOnly From, int Weeks) ValidateShiftOptions(ImportShiftOptions options, DateOnly today)
    {
        if (options.Shape == ImportShiftShape.Dated) return (today, 1);
        if (options.From is not { } from) throw new ImportException(ChoosePatternStart);
        var weeks = options.Weeks ?? ImportShiftRows.MaxWeeks;
        if (from < today || from > today.AddDays(ImportShiftRows.PatternStartDays) || weeks is < 1 or > ImportShiftRows.MaxWeeks)
            throw new ImportException($"The pattern can start from today up to {SayDay(today.AddDays(ImportShiftRows.PatternStartDays))}.");
        return (from, weeks);
    }

    private async Task<RosterGenerationLock> AcquireBoardLockAsync(Guid tenantId, CancellationToken ct)
    {
        // shortcut: the board lock is held for the whole import, so roster drag and drop answers busy for up to a minute; take it per week if imports grow.
        try { return await RosterGenerationLock.AcquireAsync(_db, tenantId, ct, RosterGenerationLock.DefaultWait, scope: "roster-board"); }
        catch (RosterBusyException) { throw new ImportException(RosterGenerationLock.RosterBoardBusyMessage, 409); }
    }

    public async Task<bool> ReadinessEnforcedAsync(CancellationToken ct) =>
        await _db.ProviderSettings.AsNoTracking().Select(s => (ParticipantReadinessMode?)s.ParticipantReadinessMode).FirstOrDefaultAsync(ct) == ParticipantReadinessMode.Enforce;

    /// <summary>What the ready rows will make: the span, the weeks they touch and the shifts with nobody on them.</summary>
    private static (int Count, DateOnly? First, DateOnly? Last, int Weeks, int Unfilled) Summarise(IEnumerable<ImportRowPlan> plans)
    {
        var made = plans.Where(p => p.Status == ImportRowStatus.Ready).SelectMany(p => p.Shifts).ToList();
        return (made.Count, made.Count == 0 ? null : made.Min(s => s.ServiceDate), made.Count == 0 ? null : made.Max(s => s.ServiceDate),
            made.Select(s => MondayOf(s.ServiceDate)).Distinct().Count(), made.Count(s => s.UserId is null));
    }

    private async Task<List<ImportRowPlan>> PlanShiftsAsync(ImportTable table, IReadOnlyList<string?> mapping, ImportShiftOptions options, string fileName, CancellationToken ct)
    {
        var tenantId = TenantId();
        var availability = _availability ?? throw new InvalidOperationException("The upcoming-shifts import needs the roster services.");
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var (from, weeks) = ValidateShiftOptions(options, today);
        var plans = ImportShiftRows.Build(table, mapping, options.Shape, today, from, weeks);

        // The cap comes before any load, so a huge file costs one pass.
        var total = plans.Where(p => p.Status == ImportRowStatus.Ready).Sum(p => p.Shift!.Dates.Count);
        if (total > MaxShifts)
            throw new ImportException($"This makes {total.ToString("N0", CultureInfo.InvariantCulture)} shifts, more than 5,000 at once. Import fewer weeks, or split the file.");

        // Participants, by the funding import's lookup; an NDIS number never falls back to the name.
        var lookup = new ImportParticipantLookup(await LoadParticipantMatchesAsync(ct));
        var participantOf = new Dictionary<int, ImportParticipantMatch>();
        foreach (var plan in plans.Where(p => p.Status == ImportRowStatus.Ready))
        {
            var line = plan.Shift!;
            var found = lookup.Find(line.NdisKey, line.FullName, line.DateOfBirth);
            if (found.Count == 1)
            {
                participantOf[plan.RowNumber] = found[0];
                plan.Name = $"{found[0].FirstName} {found[0].LastName}".Trim();
            }
            else if (line.NdisKey is { } ndis)
                plan.Refuse(found.Count == 0
                    ? $"No participant with NDIS number {ndis[..3]} {ndis[3..6]} {ndis[6..]}. Import participants first, or check the number."
                    : $"More than one participant has NDIS number {ndis[..3]} {ndis[3..6]} {ndis[6..]}. Correct it on their profiles first.");
            else
            {
                var born = line.DateOfBirth is { } dob ? dob.ToString("d MMM yyyy", CultureInfo.InvariantCulture) : "";
                plan.Refuse(found.Count == 0
                    ? $"No participant named {line.FullName} born {born}."
                    : $"More than one participant is named {line.FullName} born {born}: add their NDIS number.");
            }
        }

        // Readiness runs in every mode; the mode decides what it refuses.
        foreach (var group in plans.Where(p => participantOf.ContainsKey(p.RowNumber) && p.Status == ImportRowStatus.Ready).GroupBy(p => participantOf[p.RowNumber].Id))
        {
            var readiness = await ParticipantReadiness.CheckAsync(_db, group.Key, ct);
            if (!readiness.Allowed) foreach (var plan in group) plan.Refuse(ParticipantReadinessGate.NotReadyMessage);
        }

        // Staff: an email, else a unique full name, else unfilled. Explicitly this organisation's active staff.
        var staff = await _db.Users.AsNoTracking().Where(u => u.TenantId == tenantId && u.IsActive)
            .Select(u => new { u.Id, u.Email, u.FirstName, u.LastName }).ToListAsync(ct);
        var staffOf = new Dictionary<int, Guid>();
        foreach (var plan in plans.Where(p => p.Status == ImportRowStatus.Ready))
        {
            var line = plan.Shift!;
            var email = line.StaffEmail.Trim();
            var name = line.StaffName.Trim();
            if (email.Length > 0)
            {
                var byEmail = staff.Where(u => string.Equals(u.Email.Trim(), email, StringComparison.OrdinalIgnoreCase)).Take(2).ToList();
                if (byEmail.Count == 1) staffOf[plan.RowNumber] = byEmail[0].Id;
                else plan.Warnings.Add($"No staff member with the email {email}, so the shift imports unfilled.");
            }
            else if (name.Length > 0)
            {
                var key = ImportParticipantLookup.NameKey(name);
                var byName = staff.Where(u => ImportParticipantLookup.NameKey($"{u.FirstName} {u.LastName}") == key).Take(2).ToList();
                if (byName.Count == 1) staffOf[plan.RowNumber] = byName[0].Id;
                else plan.Warnings.Add(byName.Count == 0
                    ? $"No staff member named {name}, so the shift imports unfilled."
                    : $"More than one staff member is named {name}, so the shift imports unfilled: add their email.");
            }
            else plan.Notes.Add("No staff given: imports unfilled.");
        }

        var ready = plans.Where(p => p.Status == ImportRowStatus.Ready).ToList();
        if (ready.Count == 0) return plans;
        var participantIds = ready.Select(p => participantOf[p.RowNumber].Id).Distinct().ToList();
        var first = ready.Min(p => p.Shift!.Dates.DefaultIfEmpty(DateOnly.MaxValue).Min());
        var last = ready.Max(p => p.Shift!.Dates.DefaultIfEmpty(DateOnly.MinValue).Max());
        if (first > last) return plans;

        // What is already on the roster (not cancelled) is skipped, and so is a repeat earlier in the file.
        var onRoster = (await _db.Shifts.AsNoTracking()
                .Where(s => participantIds.Contains(s.ParticipantId) && s.Status != ShiftStatus.Cancelled && s.ServiceDate >= first && s.ServiceDate <= last)
                .Select(s => new { s.ParticipantId, s.ServiceDate, s.StartTime, s.EndTime }).ToListAsync(ct))
            .Select(s => (s.ParticipantId, s.ServiceDate, s.StartTime, s.EndTime)).ToHashSet();
        var seen = new Dictionary<(Guid, DateOnly, TimeOnly, TimeOnly), int>();

        var snapshot = await availability.LoadAsync(staffOf.Values.Distinct().ToList(), participantIds, first, last, ct);
        var reason = $"Imported from {Path.GetFileName(fileName)}";
        var importedAt = DateTime.UtcNow;
        var perParticipant = new Dictionary<Guid, List<(ImportRowPlan Plan, Shift Shift, List<RosterFinding> Findings)>>();

        foreach (var plan in ready)
        {
            var line = plan.Shift!;
            var participantId = participantOf[plan.RowNumber].Id;
            staffOf.TryGetValue(plan.RowNumber, out var staffId);
            int skipped = 0, repeatOf = 0;
            var refused = new List<(DateOnly Date, string Message)>();
            var made = new List<(Shift, List<RosterFinding>)>();
            foreach (var date in line.Dates)
            {
                var key = (participantId, date, line.Start, line.End);
                if (seen.TryGetValue(key, out var earlier)) { skipped++; repeatOf = earlier; continue; }
                if (onRoster.Contains(key)) { skipped++; continue; }
                // The id is final before Check and Add: the rules skip a shift by id, so a shared empty id would hide every overlap inside the file.
                var shift = new Shift
                {
                    Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, UserId = staffOf.ContainsKey(plan.RowNumber) ? staffId : null,
                    ServiceDate = date, StartTime = line.Start, EndTime = line.End, EndsNextDay = line.EndsNextDay, Notes = line.Notes,
                    Status = ShiftStatus.Draft, CreatedAt = importedAt, UpdatedAt = importedAt,
                };
                var findings = snapshot.Check(shift);
                if (findings.FirstOrDefault(f => f.Severity == RosterFindingSeverity.Blocking) is { } blocking) { refused.Add((date, blocking.Message)); continue; }
                snapshot.Add(shift);
                made.Add((shift, findings));
                seen[key] = plan.RowNumber;   // after the refusal check: a refused row leaves the slot open for a later row
                if (!perParticipant.TryGetValue(participantId, out var list)) perParticipant[participantId] = list = [];
                list.Add((plan, shift, findings));
            }

            if (made.Count == 0 && refused.Count == 0)
                plan.Skip(repeatOf > 0 ? $"Repeats row {repeatOf}." : "Already on the roster.");
            else if (made.Count == 0)
                plan.Refuse(string.Join(" ", refused.Select(r => r.Message).Distinct()));
            else
            {
                if (skipped > 0) plan.Notes.Add($"{skipped} of {line.Dates.Count} already on the roster.");
                if (refused.Count > 0)
                    plan.Warnings.Add($"{refused.Count} of {line.Dates.Count} shifts can't be imported ({string.Join(", ", refused.Select(r => SayDay(r.Date)))}): {string.Join(" ", refused.Select(r => r.Message).Distinct())}");
            }
        }

        await AddBudgetFindingsAsync(tenantId, perParticipant, ct);

        foreach (var (plan, shift, findings) in perParticipant.Values.SelectMany(v => v))
        {
            if (plan.Status != ImportRowStatus.Ready) continue;
            var gate = ShiftBudgetGate.Resolve(findings, false, reason);
            (shift.OverrideReason, shift.AcknowledgedFindingCodes) = ShiftBudgetGate.ToStore(findings, gate, reason, null, null, null);
            plan.Shifts.Add(shift);
        }
        foreach (var plan in plans.Where(p => p.Status == ImportRowStatus.Ready && p.Shifts.Count > 0))
            DescribeShifts(plan, perParticipant[participantOf[plan.RowNumber].Id].Where(x => x.Plan == plan).ToList(), staff.ToDictionary(u => u.Id, u => $"{u.FirstName} {u.LastName}".Trim()), reason);
        return plans;
    }

    /// <summary>
    /// Over budget is a warning. It asks for a reason only under a hard limit, and the importer is an Admin (ImportsController), so it imports with the file's reason:
    /// that is right only because (a) imported shifts are one-offs that raise cost, (b) the caller is an Admin and (c) ShiftBudgetAssessor decides hard, admin and raises.
    /// </summary>
    private async Task AddBudgetFindingsAsync(Guid tenantId, Dictionary<Guid, List<(ImportRowPlan Plan, Shift Shift, List<RosterFinding> Findings)>> byParticipant, CancellationToken ct)
    {
        if (byParticipant.Count == 0 || _budget is null || _ledgers is null) return;
        var hard = (await _db.BudgetSettings.AsNoTracking().Where(b => b.TenantId == tenantId).Select(b => (BudgetLimitMode?)b.Mode).FirstOrDefaultAsync(ct) ?? BudgetSettings.DefaultMode) == BudgetLimitMode.HardLimit;
        var ledgers = await _ledgers.ComputeAsync(tenantId, byParticipant.Keys.ToList(), ct);
        foreach (var (participantId, shifts) in byParticipant)
        {
            var specs = shifts.Select(x => new ShiftSpec(x.Shift.ServiceDate, x.Shift.StartTime, x.Shift.EndTime, x.Shift.EndsNextDay, x.Shift.Ratio, x.Shift.NightType)).ToList();
            var over = await _budget.ForecastOverAsync(tenantId, participantId, specs, ledgers.GetValueOrDefault(participantId), ct);
            for (var i = 0; i < shifts.Count; i++)
                if (over[i] is { } o)
                    shifts[i].Findings.Add(new RosterFinding(BudgetFindingCodes.ForecastOver, RosterFindingSeverity.Warning,
                        o.AlreadyOver ? $"The {o.PoolName} budget is already over; these shifts add {ShiftBudgetAssessor.Money(o.Added)}."
                                      : $"Puts the {o.PoolName} budget over by {ShiftBudgetAssessor.Money(o.OverBy)}.", RequiresReason: hard));
        }
    }

    /// <summary>The row's Detail, and its Checks: roster warnings grouped by code with the dates they fall on.</summary>
    private static void DescribeShifts(ImportRowPlan plan, List<(ImportRowPlan Plan, Shift Shift, List<RosterFinding> Findings)> made, Dictionary<Guid, string> staffNames, string reason)
    {
        var line = plan.Shift!;
        var who = made[0].Shift.UserId is { } id && staffNames.TryGetValue(id, out var name) ? $"with {name}" : "with nobody yet";
        var times = $"{Clock12(line.Start)} to {Clock12(line.End)}";
        plan.Detail = line.Weekday is { } day
            ? $"{day}s, {times}, {who}: {made.Count} {(made.Count == 1 ? "shift" : "shifts")}"
            : $"{SayDay(made[0].Shift.ServiceDate)}, {times}, {who}";
        foreach (var group in made.SelectMany(m => m.Findings.Select(f => (f, m.Shift.ServiceDate))).GroupBy(x => x.f.Code))
        {
            var dates = group.Select(x => x.ServiceDate).Distinct().Order().ToList();
            var text = group.First().f.Message;
            if (dates.Count > 1 && line.Weekday is not null) text += $" ({dates.Count} shifts: {string.Join(", ", dates.Select(SayDay))})";
            if (group.Any(x => x.f.RequiresReason)) text += $" Imports with the reason \"{reason}\".";
            plan.Warnings.Add(text);
        }
    }

    private static string Clock12(TimeOnly time) => time.ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant();

    /// <summary>Saves the accepted shifts, then starts every week they fall in (a week already started is left alone), saving after each so the next sees it.</summary>
    private async Task<List<ImportBatchItem>> AddShiftsAsync(List<ImportRowPlan> plans, ImportBatch batch, System.Security.Claims.ClaimsPrincipal? caller, CancellationToken ct)
    {
        var starter = _weekStarter ?? throw new InvalidOperationException("The upcoming-shifts import needs the roster week starter.");
        var shifts = plans.Where(p => p.Status == ImportRowStatus.Ready).SelectMany(p => p.Shifts).ToList();
        _db.Shifts.AddRange(shifts);
        await _db.SaveChangesAsync(ct);
        var now = DateTime.UtcNow;
        foreach (var monday in shifts.Select(s => MondayOf(s.ServiceDate)).Distinct().Order())
            if (await starter.StartAsync(_db, batch.TenantId, monday, ActorId(caller), now, ct) is not null)
                await _db.SaveChangesAsync(ct);
        return shifts.Select(s => new ImportBatchItem { Id = Guid.NewGuid(), BatchId = batch.Id, EntityType = nameof(Shift), EntityId = s.Id }).ToList();
    }

    /// <summary>
    /// Undo for upcoming shifts is partial: it removes the shifts that are still drafts nobody has touched (UpdatedAt still equals CreatedAt) and nothing
    /// refers to, and leaves the rest. Weeks stay started, and the agreement shifts Start made are not in the batch.
    /// </summary>
    private async Task<ImportBatchDto> UndoShiftsAsync(ImportBatch batch, Guid tenantId, List<Guid> ids, System.Security.Claims.ClaimsPrincipal? caller, CancellationToken ct)
    {
        // The rows are locked first, so a publish or edit in flight is waited for and then seen by the fresh read below. Raw SQL skips the tenant filter: name it.
        if (_db.Database.IsNpgsql())
            await _db.Database.ExecuteSqlRawAsync("SELECT 1 FROM \"Shifts\" WHERE \"Id\" = ANY({0}) AND \"TenantId\" = {1} ORDER BY \"Id\" FOR UPDATE", new object[] { ids.ToArray(), tenantId }, ct);
        var rows = await _db.Shifts.AsNoTracking().Where(s => ids.Contains(s.Id)).Select(s => new { s.Id, s.Status, s.CreatedAt, s.UpdatedAt }).ToListAsync(ct);
        var untouched = rows.Where(s => s.Status == ShiftStatus.Draft && s.UpdatedAt == s.CreatedAt).Select(s => s.Id).ToList();
        var used = new HashSet<Guid>();
        used.UnionWith(await _db.ShiftNotes.Where(x => untouched.Contains(x.ShiftId)).Select(x => x.ShiftId).ToListAsync(ct));
        used.UnionWith(await _db.ShiftCompletions.Where(x => untouched.Contains(x.ShiftId)).Select(x => x.ShiftId).ToListAsync(ct));
        used.UnionWith(await _db.HandoverAcknowledgements.Where(x => untouched.Contains(x.ShiftId)).Select(x => x.ShiftId).ToListAsync(ct));
        used.UnionWith(await _db.ClaimLineItems.Where(x => x.ShiftId != null && untouched.Contains(x.ShiftId.Value)).Select(x => x.ShiftId!.Value).ToListAsync(ct));
        used.UnionWith(await _db.BookingTasks.Where(x => x.ShiftId != null && untouched.Contains(x.ShiftId.Value)).Select(x => x.ShiftId!.Value).ToListAsync(ct));
        used.UnionWith(await _db.IncidentReports.Where(x => x.ShiftId != null && untouched.Contains(x.ShiftId.Value)).Select(x => x.ShiftId!.Value).ToListAsync(ct));
        var removable = untouched.Where(id => !used.Contains(id)).ToList();
        if (removable.Count == 0) throw new ImportException(NothingToUndo, 409);

        // The rows are locked above, so the read cannot be stale; the guard is repeated in this load query anyway (the DELETE EF emits is by Id).
        _db.Shifts.RemoveRange(await _db.Shifts.Where(s => removable.Contains(s.Id) && s.Status == ShiftStatus.Draft && s.UpdatedAt == s.CreatedAt).ToListAsync(ct));
        batch.KeptCount = rows.Count - removable.Count;
        batch.UndoneAt = DateTime.UtcNow;
        batch.UndoneById = ActorId(caller);
        batch.UndoneByName = ActorName(caller);
        await _db.SaveChangesAsync(ct);
        return ToDto(batch);
    }
}
