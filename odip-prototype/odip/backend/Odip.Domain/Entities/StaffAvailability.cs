using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Staff availability windows.
/// </summary>
public class StaffAvailability
{
    public Guid Id { get; set; }
    public Guid StaffId { get; set; }
    public Staff Staff { get; set; } = null!;
    public DateTime StartDateTime { get; set; }
    public DateTime EndDateTime { get; set; }
    public AvailabilityType AvailabilityType { get; set; }
    public bool IsRecurring { get; set; }
    public string? RecurrenceNotes { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
