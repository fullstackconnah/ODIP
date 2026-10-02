using Odip.Domain.Billing.Pricing;

namespace Odip.Application.DTOs;

/// <summary>
/// Internal: the plan builder's quote request (phase C is its only caller). The blocks are the engine's own input model; the settings and the
/// catalogue and holidays are the caller's tenant's, read on the server, so the client never sends a price or a policy.
/// </summary>
public record PlanQuoteRequestDto
{
    public List<PlanBlock>? Blocks { get; init; }
    /// <summary>The agreement period, first and last day included.</summary>
    public DateOnly PeriodFrom { get; init; }
    public DateOnly PeriodTo { get; init; }
    /// <summary>False leaves the per-occurrence lines out of the answer and keeps the totals, issues, notices and holiday exposure: a running budget only needs those.</summary>
    public bool IncludeLines { get; init; } = true;
}

/// <summary>The provider's pricing settings as the builder reads them. <see cref="IsDefault"/> says nothing is stored yet and these are the owner-approved defaults.</summary>
public record PlanPricingSettingsDto
{
    public List<string> RegistrationGroupsHeld { get; init; } = new();
    public bool RegistrationGroupsConfirmed { get; init; }
    public CrossingPolicy CrossingPolicy { get; init; }
    public bool ClaimProviderTravel { get; init; }
    public decimal TravelKmRateStandard { get; init; }
    public decimal TravelKmRateAccessible { get; init; }
    public bool TravelRatesProvisional { get; init; }
    public GroupOutingFamily GroupOutings { get; init; }
    public bool StaUsesHourlyAndAccommodation { get; init; }
    public List<string> ApproverRoles { get; init; } = new();
    public bool IsDefault { get; init; }
}

/// <summary>
/// A change to the pricing settings. Each setting changes ONLY when the request carries it, so a stale client can never revert one it does not know
/// about. Sending the registration groups confirms them unless the request says otherwise.
/// </summary>
public record UpdatePlanPricingSettingsDto
{
    public List<string>? RegistrationGroupsHeld { get; init; }
    public bool? RegistrationGroupsConfirmed { get; init; }
    public CrossingPolicy? CrossingPolicy { get; init; }
    public bool? ClaimProviderTravel { get; init; }
    public decimal? TravelKmRateStandard { get; init; }
    public decimal? TravelKmRateAccessible { get; init; }
    public bool? TravelRatesProvisional { get; init; }
    public GroupOutingFamily? GroupOutings { get; init; }
    public bool? StaUsesHourlyAndAccommodation { get; init; }
    public List<string>? ApproverRoles { get; init; }
}
