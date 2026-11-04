namespace Odip.Application.DTOs;

/// <summary>One saved place on the organisation's list (GET /service-locations): hidden ones too, so a shift keeps its place's name.</summary>
public record ServiceLocationDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Address { get; init; }
    public decimal Latitude { get; init; }
    public decimal Longitude { get; init; }
    public int RadiusMetres { get; init; }
    /// <summary>Null follows the organisation's zone.</summary>
    public string? TimeZoneId { get; init; }
    public bool IsActive { get; init; }
}

/// <summary>The body of POST and PUT /service-locations: the whole place (a PUT replaces every field; hiding one is POST /{id}/archive).</summary>
public record SaveServiceLocationDto
{
    public string Name { get; init; } = string.Empty;
    public string? Address { get; init; }
    public decimal Latitude { get; init; }
    public decimal Longitude { get; init; }
    /// <summary>50 to 2000; defaults to 200.</summary>
    public int RadiusMetres { get; init; } = 200;
    public string? TimeZoneId { get; init; }
}

/// <summary>The place a shift is at, as the worker sees it on the shift detail: name and address only (the pin and radius are PR2's check, not the worker's to read).</summary>
public record PortalServiceLocationDto(string Name, string? Address);
