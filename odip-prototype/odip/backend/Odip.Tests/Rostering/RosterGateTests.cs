using Odip.Api.Rostering;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Pure unit tests for RosterGate.ComputeOverride — no DB, no controller. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §3: HasConflict means "a hard
/// finding was overridden", so a reason typed against soft-only findings (none with
/// RequiresReason) must be discarded rather than persisted.
/// </summary>
public class RosterGateTests
{
    private static RosterFinding Hard(string code) =>
        new(code, RosterFindingSeverity.Warning, "hard message", RequiresReason: true);

    private static RosterFinding Soft(string code) =>
        new(code, RosterFindingSeverity.Warning, "soft message", RequiresReason: false);

    [Fact]
    public void EmptyFindings_ReturnsNullReasonAndNullCodes()
    {
        var (reason, codes) = RosterGate.ComputeOverride(new List<RosterFinding>(), "some reason", null);

        Assert.Null(reason);
        Assert.Null(codes);
    }

    [Fact]
    public void OneRequiresReasonFinding_WithReason_ReasonIsTrimmedAndKept()
    {
        var findings = new List<RosterFinding> { Hard("STAFF_ON_LEAVE") };

        var (reason, codes) = RosterGate.ComputeOverride(findings, " go ahead ", null);

        Assert.Equal("go ahead", reason);
        Assert.Equal("STAFF_ON_LEAVE", codes);
    }

    [Fact]
    public void SoftOnlyFinding_WithReason_ReasonDiscarded_CodeStillAcknowledged()
    {
        var findings = new List<RosterFinding> { Soft("STAFF_LEAVE_PENDING") };

        var (reason, codes) = RosterGate.ComputeOverride(findings, "not needed", null);

        Assert.Null(reason);
        Assert.Equal("STAFF_LEAVE_PENDING", codes);
    }

    [Fact]
    public void MixedSoftAndHard_NoAcknowledgedCodes_CodesAreBothDistinctJoinedByComma()
    {
        var findings = new List<RosterFinding> { Hard("STAFF_ON_LEAVE"), Soft("STAFF_LEAVE_PENDING") };

        var (reason, codes) = RosterGate.ComputeOverride(findings, "reason", null);

        Assert.Equal("reason", reason);
        Assert.Equal("STAFF_ON_LEAVE,STAFF_LEAVE_PENDING", codes);
    }

    [Fact]
    public void AcknowledgedCodesSupplied_UsedVerbatimInPlaceOfDerivedCodes()
    {
        var findings = new List<RosterFinding> { Hard("STAFF_ON_LEAVE"), Soft("STAFF_LEAVE_PENDING") };
        var acknowledged = new List<string> { "STAFF_LEAVE_PENDING" };

        var (reason, codes) = RosterGate.ComputeOverride(findings, "reason", acknowledged);

        Assert.Equal("reason", reason);
        Assert.Equal("STAFF_LEAVE_PENDING", codes);
    }
}
