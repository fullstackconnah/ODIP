using Odip.Domain.Entities;

namespace Odip.Tests.Support;

/// <summary>Data that satisfies the onboarding checklist's derived items, for tests that need a participant the strict readiness predicate accepts.</summary>
internal static class OnboardingSeeds
{
    /// <summary>A line that makes a 2026 draft's "Service needs" item done: hours, a price, an item code and a catalogue row valid from the plan's start.</summary>
    public static ServiceAgreementDraftLine PricedLine() => new()
    {
        Id = Guid.NewGuid(), ServiceType = "Community access", Hours = 10, ItemCode = "04_104_0125_6_1", CatalogueVersion = "2025-26",
        CatalogueEffectiveFrom = new DateOnly(2025, 7, 1), UnitPrice = 70m,
    };

    /// <summary>Fills what "Profile details" asks for when it is missing (date of birth, and an NDIS number in case the participant is NDIS-funded).</summary>
    public static void CompleteProfile(Participant participant)
    {
        participant.DateOfBirth ??= new DateOnly(1990, 1, 1);
        participant.NdisNumber ??= "430000000";
    }
}
