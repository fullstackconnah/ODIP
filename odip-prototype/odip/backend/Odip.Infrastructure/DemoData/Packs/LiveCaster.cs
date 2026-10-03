using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Chooses who works a live-set shift (see <see cref="LiveSetCatalog"/>) by asking the roster's own rule engine, <see cref="RosterConflictService"/>,
/// the same question the roster board asks of every shift it shows: for each candidate in the story's order, build the shift and the context the
/// board would (that worker's other shifts that week including the live shifts cast a moment ago, the participant's shifts that day, trip
/// assignments, leave and unavailability, the compatibility matrix, public holidays) and take the first worker the engine finds nothing wrong with.
/// So a live shift can never double-book anyone, run anyone past the weekly hours, land on approved or pending leave, put an excluded pair together
/// or ask for a competency the worker does not hold. Two codes are let through: PUBLIC_HOLIDAY (information for the coordinator) and
/// CREDENTIAL_EXPIRED (the plan's near credentials lapse on purpose, and holding the live set hostage to them would empty it within weeks).
/// An expired worker screening is the one hard stop and is never let through. When nobody fits, the story is skipped for the day.
///
/// The week's data is read once per week per tick (a handful of queries), and only when a live shift has to be cast, which is the first tick of
/// a day: later ticks find the shifts by id and never come here.
/// </summary>
internal sealed class LiveCaster
{
    private static readonly HashSet<string> Tolerated = new() { RosterConflictService.PublicHoliday, RosterConflictService.CredentialExpired };

    private sealed record WeekData(
        List<Shift> Shifts, IReadOnlyList<UnavailabilityWindow> Windows, Dictionary<(Guid User, Guid Participant), CompatibilityLevel> Compatibility,
        List<PublicHolidayRef> Holidays, List<StaffAssignment> Assignments);

    private readonly DemoRun _run;
    private readonly RosterConflictService _engine = new();
    private readonly Dictionary<DateOnly, WeekData> _weeks = new();
    private readonly List<Shift> _cast = new();
    private Dictionary<Guid, Participant>? _participants;
    private string? _state;

    public LiveCaster(DemoRun run) => _run = run;

    /// <summary>The shift for <paramref name="story"/> on <paramref name="date"/>, Published, with the first worker the roster engine accepts; null when nobody fits.</summary>
    public async Task<Shift?> CastAsync(LiveStory story, DateOnly date, CancellationToken ct)
    {
        var staff = await _run.FreshStaffAsync(ct);
        var directory = _run.Directory.Participant(story.Participant);
        if (directory is null)
        {
            _run.Skipped($"live shift {story.Key} on {date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}", $"{story.Participant} is missing");
            return null;
        }

        var participants = await ParticipantsAsync(ct);
        if (!participants.TryGetValue(directory.Id, out var participant)) return null;
        var week = await WeekAsync(date, ct);

        var rejected = new List<string>();
        foreach (var key in story.Workers)
        {
            if (!staff.TryGetValue(key, out var user)) continue;

            var candidate = new Shift
            {
                Id = LiveSetCatalog.ShiftId(story, date),
                TenantId = _run.TenantId,
                ParticipantId = participant.Id,
                UserId = user.Id,
                ServiceDate = date,
                StartTime = story.Start,
                EndTime = story.End,
                Ratio = SupportRatio.OneToOne,
                NightType = SleepoverType.None,
                Status = ShiftStatus.Published,
            };

            var all = week.Shifts.Concat(_cast.Where(c => DemoAnchors.MondayOf(c.ServiceDate) == DemoAnchors.MondayOf(date))).ToList();
            var level = week.Compatibility.GetValueOrDefault((user.Id, participant.Id), CompatibilityLevel.Allowed);
            var context = new RosterCheckContext(
                user, participant,
                all.Where(s => s.UserId == user.Id && s.Id != candidate.Id).ToList(),
                all.Where(s => s.ParticipantId == participant.Id && s.ServiceDate == date && s.Id != candidate.Id).ToList(),
                week.Assignments.Where(a => a.UserId == user.Id).ToList(),
                week.Windows.Where(w => w.UserId == user.Id).ToList(),
                level, RosterConflictService.DefaultWeeklyHoursThreshold, week.Holidays);

            var findings = _engine.Check(candidate, context);
            if (findings.All(f => Tolerated.Contains(f.Code)))
            {
                _cast.Add(candidate);
                return candidate;
            }
            rejected.Add($"{key}: {string.Join("+", findings.Where(f => !Tolerated.Contains(f.Code)).Select(f => f.Code).Distinct())}");
        }

        _run.Skipped($"live shift {story.Key} on {date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}", "nobody on the roster is free for it without a finding (" + string.Join("; ", rejected) + ")");
        return null;
    }

    private async Task<Dictionary<Guid, Participant>> ParticipantsAsync(CancellationToken ct)
    {
        if (_participants is not null) return _participants;
        var ids = LiveSetCatalog.Stories.Select(s => _run.Directory.Participant(s.Participant)?.Id).OfType<Guid>().Distinct().ToList();
        _participants = (await DemoQueries.ParticipantsByIds(_run.Db, ids).ToListAsync(ct)).ToDictionary(p => p.Id);
        return _participants;
    }

    private async Task<WeekData> WeekAsync(DateOnly date, CancellationToken ct)
    {
        var from = DemoAnchors.MondayOf(date);
        if (_weeks.TryGetValue(from, out var cached)) return cached;
        var to = from.AddDays(6);

        var staffIds = LiveSetCatalog.Stories.SelectMany(s => s.Workers).Distinct()
            .Select(k => _run.Directory.Staff(k)?.Id).OfType<Guid>().ToList();      // ids only: what is read of each person comes from FreshStaffAsync
        _state ??= await DemoQueries.ProviderState(_run.Db).FirstOrDefaultAsync(ct) ?? "VIC";

        var shifts = await DemoQueries.WeekShifts(_run.Db, from, to).ToListAsync(ct);
        var windows = await new StaffUnavailabilityQuery(_run.Db).GetWindowsAsync(staffIds, from, to, ct);
        var compatibility = (await DemoQueries.CompatibilityLevels(_run.Db, staffIds).ToListAsync(ct))
            .ToDictionary(c => (c.UserId, c.ParticipantId), c => c.Level);
        var holidays = (await DemoQueries.HolidaysOf(_run.Db, _state, from, to).ToListAsync(ct)).Select(h => new PublicHolidayRef(h.Date, h.Name)).ToList();
        var assignments = await DemoQueries.TripAssignmentsOf(_run.Db, staffIds, from, to).ToListAsync(ct);

        return _weeks[from] = new WeekData(shifts, windows, compatibility, holidays, assignments);
    }
}
