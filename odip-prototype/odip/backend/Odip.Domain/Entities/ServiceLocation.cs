using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A place an organisation's team works (Settings > Organisation > Service locations): a day centre, a hub. A shift points at one by id. The pin is the venue's own
/// (typed by an admin), never a worker's. "Remove" is <see cref="IsActive"/> = false, never a delete, so old shifts keep the place and its time zone.
/// </summary>
public class ServiceLocation : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>Free text shown to the support worker on their shift; never geocoded.</summary>
    public string? Address { get; set; }
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    /// <summary>How far from the pin counts as at the place (50 to 2000 m); PR2 reads it for the start check.</summary>
    public int RadiusMetres { get; set; } = 200;
    /// <summary>An IANA id from <c>StateTimeZoneMap.Zones</c>; null follows the organisation's zone.</summary>
    public string? TimeZoneId { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
