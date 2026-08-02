namespace Odip.Application.Models;

public record SyncResult(
    int YearsProcessed,
    int HolidaysAdded,
    int HolidaysUpdated,
    string[] Errors
);
