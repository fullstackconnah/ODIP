using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// An organisation's link to one Microsoft Entra directory (ms-sso spec 2026-10-26). <see cref="TenantId"/> is the ODIP organisation;
/// <see cref="MicrosoftTenantId"/> is the Entra tid. One link per organisation and one organisation per Entra tid.
/// </summary>
public class MicrosoftTenantLink : ITenantEntity
{
    public const string OrganisationIndexName = "IX_MicrosoftTenantLinks_TenantId";
    public const string MicrosoftTenantIdIndexName = "IX_MicrosoftTenantLinks_MicrosoftTenantId";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public Guid MicrosoftTenantId { get; set; }

    /// <summary>The role a person first signing in through this directory gets: Coordinator, SupportWorker or ReadOnly, never Admin.</summary>
    public UserRole DefaultRole { get; set; } = UserRole.ReadOnly;
    public Guid LinkedByUserId { get; set; }
    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;

    /// <summary>The row's version, held in whole microseconds as PostgreSQL stores it (as on ProviderSettings), so the value a GET sends matches on the next PUT.</summary>
    public DateTime UpdatedAt { get => _updatedAt; set => _updatedAt = Micro(value); }
    private DateTime _updatedAt = Micro(DateTime.UtcNow);
    private static DateTime Micro(DateTime value) => new(value.Ticks - value.Ticks % 10, value.Kind);
}
