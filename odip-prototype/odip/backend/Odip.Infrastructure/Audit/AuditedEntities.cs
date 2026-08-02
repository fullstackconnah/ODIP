using Odip.Domain.Entities;

namespace Odip.Infrastructure.Audit;

public static class AuditedEntities
{
    public static readonly HashSet<Type> Types = new()
    {
        typeof(TripInstance),
        typeof(Participant),
        typeof(ParticipantBooking),
        typeof(IncidentReport),
        typeof(Staff),
        typeof(StaffAssignment),
        typeof(VehicleAssignment),
    };

    private static readonly HashSet<string> ExcludedProperties = new()
    {
        "CreatedAt", "UpdatedAt"
    };

    public static bool IsExcluded(string propertyName) =>
        ExcludedProperties.Contains(propertyName);
}
