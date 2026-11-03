using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>Answers the auto-roster planner from the real roster rules: the same <see cref="RosterAvailability.Snapshot"/> and <see cref="RosterGate"/> that apply and Start rostering read, so a draft row passes the gate it will meet.</summary>
public sealed class SnapshotAutoRosterOracle(RosterAvailability.Snapshot snapshot) : IAutoRosterOracle
{
    public string? Away(Shift probe) => snapshot.AwayReason(probe);

    // Never as an Admin: double-booking is then Blocking, the strictest reading (D6).
    public List<RosterFinding> Check(Shift probe) => snapshot.Check(probe, callerIsAdmin: false);

    public bool NeedsOverride(IReadOnlyList<RosterFinding> findings) => RosterGate.EvaluateFindings(findings.ToList(), null) is not null;

    public void Book(Shift probe) => snapshot.Add(probe);
}
