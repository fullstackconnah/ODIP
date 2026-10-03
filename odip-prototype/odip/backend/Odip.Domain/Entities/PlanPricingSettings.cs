using Odip.Domain.Billing.Pricing;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// One organisation's settings for the plan builder's pricing engine (phase B): which registration groups it holds, the crossing policy, whether it
/// claims provider travel and at which per-kilometre rates, where group outings are billed, how short-term accommodation is planned, and who may
/// approve an agreement for rostering (read by the approval, phase D). One row per tenant; an organisation with no row prices with the owner-approved defaults, which are also
/// the defaults of every column here (constant database defaults, so a row written by an older build reads back as the defaults).
/// <see cref="PlanPricingPolicy.From"/> turns the row into the value the engine reads. It is a table of its own, not columns on
/// <see cref="ProviderSettings"/>: that row holds bank details and has its own audited editing rules.
/// </summary>
public class PlanPricingSettings : ITenantEntity
{
    public const string DefaultRegistrationGroups = "0107,0104,0125,0136,0115,0108";
    public const string DefaultApproverRoles = "Admin,Coordinator";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    /// <summary>The registration groups held, comma separated ("0107,0104,0125,0136,0115,0108"): all six until somebody sets it. An empty list holds none.</summary>
    public string RegistrationGroupsHeld { get; set; } = DefaultRegistrationGroups;
    /// <summary>False until somebody confirms the groups: the builder shows a notice while the groups are the default.</summary>
    public bool RegistrationGroupsConfirmed { get; set; }
    public CrossingPolicy CrossingPolicy { get; set; } = CrossingPolicy.Split;
    public bool ClaimProviderTravel { get; set; } = true;
    /// <summary>Dollars per kilometre, standard vehicle: 0.99, the 2025-26 value, until NDIA publishes 2026-27.</summary>
    public decimal TravelKmRateStandard { get; set; } = 0.99m;
    /// <summary>Dollars per kilometre, accessible vehicle or bus: 2.76, the 2025-26 value.</summary>
    public decimal TravelKmRateAccessible { get; set; } = 2.76m;
    /// <summary>The per-kilometre rates and the travel time caps are 2025-26 values: lines that use them carry the Provisional flag while this is set.</summary>
    public bool TravelRatesProvisional { get; set; } = true;
    public GroupOutingFamily GroupOutings { get; set; } = GroupOutingFamily.GroupActivities;
    /// <summary>STA uses the hourly support items plus accommodation nights; the legacy per-day items are not offered (they end on 30 June 2027).</summary>
    public bool StaUsesHourlyAndAccommodation { get; set; } = true;
    /// <summary>The roles that may mark an agreement revision approved for rostering, comma separated (the approval reads this, and so does the screen; the pricing engine does not).</summary>
    public string ApproverRoles { get; set; } = DefaultApproverRoles;
}
