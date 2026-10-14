namespace Odip.Application.DTOs;

/// <summary>GET /api/v1/data-export/last: the organisation's newest completed full export, read from its audit row. Null when there is none.</summary>
public class DataExportLastDto
{
    /// <summary>An instant: UTC, written with a trailing Z.</summary>
    public DateTime ExportedAt { get; set; }
    public string? ExportedByName { get; set; }
}
