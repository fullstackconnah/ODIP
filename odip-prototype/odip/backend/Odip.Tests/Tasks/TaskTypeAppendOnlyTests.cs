using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Tasks;

/// <summary>
/// <see cref="TaskType"/> is persisted as an integer (no string conversion, no migration per member), so a member is only ever APPENDED: renumbering one would silently turn every stored task into a
/// different kind of task. This pins every name to its position, and the one added for budget phase 3 (an Admin's review of an emergency booking past a budget) to 19.
/// </summary>
public class TaskTypeAppendOnlyTests
{
    [Fact]
    public void EveryMemberKeepsItsPosition_AndTheBudgetReviewIsAppendedAtTheEnd()
    {
        var expected = new[]
        {
            "AccommodationRequest", "AccommodationConfirmation", "VehicleRequest", "VehicleConfirmation", "ParticipantConfirmation", "FamilyContact", "InvoiceOop", "StaffingAllocation",
            "RiskReview", "MedicationCheck", "PreDeparture", "PostTrip", "InsuranceConfirmation", "GenerateNdisClaims", "Other",
            "LeaveCoverage", "IncidentQscReport", "MedicationWitness", "FlaggedNoteFollowUp",
            "BudgetEmergencyReview",
        };

        Assert.Equal(expected, Enum.GetNames<TaskType>());
        Assert.Equal(Enumerable.Range(0, expected.Length), Enum.GetValues<TaskType>().Select(v => (int)v));
        Assert.Equal(19, (int)TaskType.BudgetEmergencyReview);
    }
}
