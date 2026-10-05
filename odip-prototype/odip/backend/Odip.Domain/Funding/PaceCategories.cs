using Odip.Domain.Entities;

namespace Odip.Domain.Funding;

/// <summary>The four support budgets of an NDIS plan.</summary>
public enum PaceBudget
{
    Core = 0,
    CapacityBuilding = 1,
    Capital = 2,
    Recurring = 3,
}

/// <summary>One NDIS support category as the NDIA lists it (PACE numbering, 1 to 21).</summary>
/// <param name="Number">The category number, 1 to 21.</param>
/// <param name="Name">The name as the plan prints it.</param>
/// <param name="Budget">The support budget the category sits in.</param>
/// <param name="Flexible">Flexible: the participant may spend it across the other flexible categories of the same component. Stated: the plan names the support.</param>
public sealed record PaceCategory(int Number, string Name, PaceBudget Budget, bool Flexible)
{
    /// <summary>Categories 01 to 04 pay for each other, so a plan holds them as one Core (flexible) pool for each management type.</summary>
    public bool InCoreFlexiblePool => Number is >= 1 and <= 4;

    /// <summary>
    /// Whether a plan can hold this category as a stated pool of its own. Not 01 to 04 (they are Core flexible), and not 18: Recurring Transport is paid to the
    /// participant and is never claimed by a provider, so it is listed but never offered.
    /// </summary>
    public bool OfferedAsStatedPool => !InCoreFlexiblePool && Budget != PaceBudget.Recurring;
}

/// <summary>
/// The NDIS support categories as data, served to the screens by <c>GET api/v1/funding/pace-categories</c> so no screen keeps a second copy. Source: the NDIA
/// plan structure (four support budgets, 21 categories) as researched for ODIP's budget feature, section 1.2. The plan builder's pricing engine keeps its own
/// four-name table for the categories it totals; this list is the complete one.
/// </summary>
public static class PaceCategories
{
    /// <summary>Every category, in number order.</summary>
    public static readonly IReadOnlyList<PaceCategory> All = new PaceCategory[]
    {
        new(1, "Assistance with Daily Life", PaceBudget.Core, true),
        new(2, "Transport", PaceBudget.Core, true),
        new(3, "Consumables", PaceBudget.Core, true),
        new(4, "Assistance with Social, Economic and Community Participation", PaceBudget.Core, true),
        new(5, "Assistive Technology", PaceBudget.Capital, false),
        new(6, "Home Modifications", PaceBudget.Capital, false),
        new(7, "Support Coordination and Psychosocial Recovery Coaches", PaceBudget.CapacityBuilding, false),
        new(8, "Improved Living Arrangements", PaceBudget.CapacityBuilding, false),
        new(9, "Increased Social and Community Participation", PaceBudget.CapacityBuilding, false),
        new(10, "Finding and Keeping a Job", PaceBudget.CapacityBuilding, false),
        new(11, "Relationships", PaceBudget.CapacityBuilding, false),
        new(12, "Health and Wellbeing", PaceBudget.CapacityBuilding, false),
        new(13, "Lifelong Learning", PaceBudget.CapacityBuilding, false),
        new(14, "Choice and Control", PaceBudget.CapacityBuilding, false),
        new(15, "Improved Daily Living Skills", PaceBudget.CapacityBuilding, false),
        new(16, "Home and Living", PaceBudget.Core, false),
        new(17, "Specialist Disability Accommodation", PaceBudget.Capital, false),
        new(18, "Recurring Transport", PaceBudget.Recurring, true),
        new(19, "Assistive Technology Maintenance, Repair and Rental", PaceBudget.Capital, false),
        new(20, "Behaviour Support", PaceBudget.CapacityBuilding, false),
        new(21, "Young People in Residential Aged Care", PaceBudget.Core, false),
    };

    public static PaceCategory? Find(int number) => All.FirstOrDefault(c => c.Number == number);

    /// <summary>
    /// The PACE category a catalogue row sits in, which is where the money for it comes from: its PACE number, else the legacy support category the older rows carry (the same rule the plan
    /// pricing engine uses). Null when the row carries neither.
    /// </summary>
    public static int? Of(SupportCatalogueItem row) => row.PaceSupportCategoryNumber ?? row.SupportCategoryNumber;

    /// <summary>The name a Stated pool of this category carries when the plan does not give one; null for a number that is not a category.</summary>
    public static string? NameOf(int number) => Find(number)?.Name;

    /// <summary>The name a Core (flexible) pool carries when nobody gives it one.</summary>
    public const string CoreFlexibleName = "Core (flexible)";
}
