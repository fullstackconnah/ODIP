using Odip.Domain.Entities;

namespace Odip.Domain.Billing.Pricing;

/// <summary>How a support that crosses a time-of-day or day-of-week boundary is billed (NDIS-CODES 5.2). Every line records which policy produced it.</summary>
public enum CrossingPolicy
{
    /// <summary>A, the default and the conservative one: split at each boundary and price each part at its own item.</summary>
    Split = 0,
    /// <summary>B: when one worker delivers the whole support, the higher of the amounts applies to all of it. Never across a sleepover, and not when the headcount changes.</summary>
    HigherOf = 1,
}

/// <summary>Which family a group outing is priced under (NDIS-CODES 11.3 question 2). Both accept groups and carry the same hourly prices.</summary>
public enum GroupOutingFamily
{
    /// <summary>Group and centre based activities, registration group 0136 (the default).</summary>
    GroupActivities = 0,
    /// <summary>Access community, social and recreational activities, registration group 0125, with the group fraction.</summary>
    CommunityAccess = 1,
}

/// <summary>
/// What the engine reads of the provider's settings: the owner-approved defaults of the plan builder brief when nothing has been stored. It is a
/// value, built from the stored row by <c>PlanPricingSettings.ToPolicy</c>, so the engine stays pure.
/// </summary>
public sealed record PlanPricingPolicy
{
    /// <summary>The six registration groups the builder knows: daily personal activities, high intensity, community, group and centre based, STA / shared living, and travel / transport arrangements.</summary>
    public static IReadOnlyList<string> AllRegistrationGroups { get; } = new[] { "0107", "0104", "0125", "0136", "0115", "0108" };

    /// <summary>The settings of a provider that has stored none.</summary>
    public static PlanPricingPolicy Default { get; } = new();

    /// <summary>The registration groups the provider holds. A support family whose group is not here is refused with a reason.</summary>
    public IReadOnlyList<string> RegistrationGroupsHeld { get; init; } = AllRegistrationGroups;
    /// <summary>False until somebody confirms the groups: every quote then carries a notice (question 1), because the default is "all six" and nobody has said so.</summary>
    public bool RegistrationGroupsConfirmed { get; init; }
    public CrossingPolicy Crossing { get; init; } = CrossingPolicy.Split;
    /// <summary>Claim provider travel at all. Off, no block gets a travel line whatever it asks for.</summary>
    public bool ClaimProviderTravel { get; init; } = true;
    /// <summary>Dollars per kilometre for a standard vehicle: the 2025-26 value, until NDIA publishes 2026-27.</summary>
    public decimal KmRateStandard { get; init; } = 0.99m;
    /// <summary>Dollars per kilometre for an accessible vehicle or bus: the 2025-26 value.</summary>
    public decimal KmRateAccessible { get; init; } = 2.76m;
    /// <summary>The per-kilometre rates and the travel time caps are 2025-26 values: lines that use them carry the Provisional flag while this is set.</summary>
    public bool TravelRatesProvisional { get; init; } = true;
    public GroupOutingFamily GroupOutings { get; init; } = GroupOutingFamily.GroupActivities;
    /// <summary>STA is planned with the hourly support items plus accommodation nights. The legacy per-day items are not offered (they end on 30 June 2027).</summary>
    public bool StaUsesHourlyAndAccommodation { get; init; } = true;
    /// <summary>Who may mark an agreement approved (phase D). Stored with the settings; the pricing engine does not read it.</summary>
    public IReadOnlyList<string> ApproverRoles { get; init; } = new[] { "Admin", "Coordinator" };

    /// <summary>The policy of a stored settings row; no row is <see cref="Default"/>. An unknown registration group is dropped, a repeat counts once, and an empty list holds none.</summary>
    public static PlanPricingPolicy From(PlanPricingSettings? settings)
    {
        if (settings is null) return Default;

        static List<string> Split(string? list) =>
            (list ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.Ordinal).ToList();

        return new PlanPricingPolicy
        {
            RegistrationGroupsHeld = Split(settings.RegistrationGroupsHeld).Where(group => AllRegistrationGroups.Contains(group)).ToList(),
            RegistrationGroupsConfirmed = settings.RegistrationGroupsConfirmed,
            Crossing = settings.CrossingPolicy,
            ClaimProviderTravel = settings.ClaimProviderTravel,
            KmRateStandard = settings.TravelKmRateStandard,
            KmRateAccessible = settings.TravelKmRateAccessible,
            TravelRatesProvisional = settings.TravelRatesProvisional,
            GroupOutings = settings.GroupOutings,
            StaUsesHourlyAndAccommodation = settings.StaUsesHourlyAndAccommodation,
            ApproverRoles = Split(settings.ApproverRoles),
        };
    }

    public bool Holds(string? registrationGroup) =>
        !string.IsNullOrWhiteSpace(registrationGroup) && RegistrationGroupsHeld.Contains(registrationGroup.Trim(), StringComparer.Ordinal);
}
