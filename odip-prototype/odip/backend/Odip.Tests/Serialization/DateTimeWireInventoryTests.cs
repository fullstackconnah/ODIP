using System.Text;
using Xunit;

namespace Odip.Tests.Serialization;

/// <summary>
/// The inventory of every DateTime / DateTime? that crosses the API wire, by KIND. There are exactly two kinds:
///
///   INSTANT     - a moment that happened (created, logged in, dose given). Stored as UTC, written with a trailing "Z", and shown
///                 to people in the provider's or the viewer's zone. This is the default and the overwhelming majority.
///   WALL CLOCK  - a provider-local clock reading typed or scheduled by a person ("08:00 on 3 Oct"), or a calendar date that is
///                 stored in a DateTime (midnight). The digits ARE the answer, so it is written with NO zone and is never shifted.
///                 Every such field is marked [WallClock] on its DTO and listed below, each with the reason.
///
/// The test walks every type reachable from a controller action (return type or [FromBody]) plus the DTOs namespace, so a DateTime
/// added tomorrow is an instant unless someone consciously adds it here.
/// </summary>
public class DateTimeWireInventoryTests
{
    internal sealed record WallClockField(string Field, string Kind, string Why);

    private const string Slot = "provider-local dose slot / routine time";
    private const string Typed = "provider-local time typed into a datetime-local input";
    private const string Date = "calendar date held in a DateTime (midnight)";

    /// <summary>Everything NOT in this list is a UTC instant. Keys are "DtoType.Property" (declaring type).</summary>
    internal static readonly WallClockField[] WallClock =
    [
        new("AdministrationDto.ScheduledAt", Slot, "the MAR slot the dose was for; the stored slot key"),
        new("CreateAdministrationDto.ScheduledAt", Slot, "the slot the client says it is recording"),
        new("MarEntryDto.ScheduledAt", Slot, "the MAR row's slot (ScheduledTime is its HH:mm)"),
        new("PortalDoseSlotDto.ScheduledAt", Slot, "shift-package dose slot"),
        new("PortalFinishBlockerDto.ScheduledAt", Slot, "the slot a finish blocker is about"),
        new("PortalShiftRoutineDto.OccursAt", Slot, "when a routine is due, in provider-local time"),

        new("IncidentListDto.IncidentDateTime", Typed, "when the incident happened, as the reporter typed it; stored verbatim"),
        new("CreateIncidentDto.IncidentDateTime", Typed, "posted raw from the datetime-local input"),
        new("IncidentSummaryDto.IncidentDateTime", Typed, "same value, shift-completion summary"),
        new("PortalWitnessRequestDto.IncidentDateTime", Typed, "same value, witness approvals queue"),
        new("IncidentDetailDto.QscReportedAt", Typed, "typed into the compliance step"),
        new("IncidentDetailDto.FamilyNotifiedAt", Typed, "typed into the compliance step"),
        new("IncidentDetailDto.SupportCoordinatorNotifiedAt", Typed, "typed into the compliance step"),
        new("UpdateIncidentDto.QscReportedAt", Typed, "posted raw from the datetime-local input"),
        new("UpdateIncidentDto.FamilyNotifiedAt", Typed, "posted raw from the datetime-local input"),
        new("UpdateIncidentDto.SupportCoordinatorNotifiedAt", Typed, "posted raw from the datetime-local input"),

        new("MedicationListDto.StartDate", Date, "date input; the page reads the date part"),
        new("MedicationListDto.EndDate", Date, "date input; the page reads the date part"),
        new("MedicationListDto.NextReviewDue", Date, "a due DAY, compared by calendar day"),
        new("MedicationDetailDto.ConsentDate", Date, "date input"),
        new("CreateMedicationDto.StartDate", Date, "posted from a date input"),
        new("CreateMedicationDto.EndDate", Date, "posted from a date input"),
        new("CreateMedicationDto.NextReviewDue", Date, "posted from a date input"),
        new("CreateMedicationDto.ConsentDate", Date, "posted from a date input"),

        new("StaffAvailabilityDto.StartDateTime", Date, "start of the first day (the pages slice the date)"),
        new("StaffAvailabilityDto.EndDateTime", Date, "end of the last day (the pages slice the date)"),
        new("CreateStaffAvailabilityDto.StartDateTime", Date, "posted as start of day"),
        new("CreateStaffAvailabilityDto.EndDateTime", Date, "posted as end of day"),
    ];

    private static string Key(WireTypeWalker.Field f) => $"{f.Owner.Name}.{f.Property.Name}";

    [Fact]
    public void EveryDateTimeOnTheWire_IsAUtcInstantWithZ_UnlessItIsADocumentedWallClockField()
    {
        var probe = new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Unspecified);
        var wall = WallClock.Select(w => w.Field).ToHashSet();
        var instantsWithoutZ = new List<string>();
        var wallClockWithZone = new List<string>();

        foreach (var field in WireTypeWalker.DateTimeFields())
        {
            var written = WireTypeWalker.WriteAlone(field, probe) ?? "(not written)";
            var hasZone = written.EndsWith('Z');
            if (wall.Contains(Key(field)))
            {
                if (hasZone) wallClockWithZone.Add($"{Key(field)} -> {written}");
            }
            else if (!hasZone)
            {
                instantsWithoutZ.Add($"{Key(field)} -> {written}");
            }
        }

        Assert.True(instantsWithoutZ.Count == 0,
            $"{instantsWithoutZ.Count} instant field(s) go out with no zone, so a browser reads them as local time:\n  " + string.Join("\n  ", instantsWithoutZ));
        Assert.True(wallClockWithZone.Count == 0,
            $"{wallClockWithZone.Count} wall-clock field(s) are written with a zone, which shifts them:\n  " + string.Join("\n  ", wallClockWithZone));
    }

    [Fact]
    public void EveryWallClockEntry_NamesARealReachableField()
    {
        var reachable = WireTypeWalker.DateTimeFields().Select(Key).ToHashSet();
        var unknown = WallClock.Select(w => w.Field).Where(k => !reachable.Contains(k)).ToList();

        Assert.True(unknown.Count == 0, "Not a DateTime on the wire (typo or a removed field): " + string.Join(", ", unknown));
        Assert.Equal(WallClock.Length, WallClock.Select(w => w.Field).Distinct().Count());
    }

    /// <summary>Set ODIP_TIME_INVENTORY_OUT to a file path to dump the full inventory (one line per field) for the fix report.</summary>
    [Fact]
    public void DumpInventory_WhenAskedFor()
    {
        var path = Environment.GetEnvironmentVariable("ODIP_TIME_INVENTORY_OUT");
        if (string.IsNullOrEmpty(path)) return;

        var wall = WallClock.ToDictionary(w => w.Field);
        var sb = new StringBuilder();
        foreach (var field in WireTypeWalker.DateTimeFields())
        {
            var kind = wall.TryGetValue(Key(field), out var w) ? "WALLCLOCK" : "INSTANT";
            sb.AppendLine($"{kind}\t{Key(field)}{(field.IsNullable ? "?" : "")}\t{w?.Kind}");
        }
        File.WriteAllText(path, sb.ToString());
    }
}
