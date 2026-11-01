using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Catalogue;

/// <summary>An activity group the catalogue importer files items under. <see cref="SupportCategory"/> is the group's usual category (0 where it mixes several).</summary>
public sealed record CatalogueGroupDefinition(string GroupCode, string DisplayName, int SupportCategory);

/// <summary>
/// Which activity group an imported item lives in: one per family, so a lookup that asks for "personal care" or "sleepover" can never land on
/// an item of another kind. <c>GRP_COMMUNITY_ACCESS</c> is the only group that existed before the catalogue grew, and the trip claims and shift
/// claims price from it; it keeps holding exactly the RG 0125 standard and ICBS community access items, so the high intensity community
/// access items (RG 0104) get a group of their own.
/// </summary>
public static class CatalogueGroups
{
    public const string CommunityAccessGroupCode = "GRP_COMMUNITY_ACCESS";
    public const string PersonalCareGroupCode = "GRP_PERSONAL_CARE";
    public const string SleepoverGroupCode = "GRP_SLEEPOVER";

    /// <summary>Every short-term accommodation group starts with this; a shift in one is a sleepover in short-term accommodation (RG 0115).</summary>
    public const string StaGroupPrefix = "GRP_STA_";

    /// <summary>The flat sleepover items a shift claim takes (shift billing PR3): the short-term accommodation sleepover (RG 0115) for a STA group, the non-SIL personal care sleepover (RG 0107) for every other shift.</summary>
    public const string StaSleepoverItemNumber = "01_206_0115_1_1", SleepoverItemNumber = "01_010_0107_1_1";

    private static readonly CatalogueGroupDefinition CommunityAccess = new(CommunityAccessGroupCode, "Group Community Access", 4);
    private static readonly CatalogueGroupDefinition CommunityAccessHighIntensity = new("GRP_COMMUNITY_ACCESS_HI", "Community Access - High Intensity", 4);
    private static readonly CatalogueGroupDefinition PersonalCare = new(PersonalCareGroupCode, "Personal Care", 1);
    private static readonly CatalogueGroupDefinition GroupActivities = new("GRP_GROUP_ACTIVITIES", "Group Activities", 4);
    private static readonly CatalogueGroupDefinition StaSupport = new("GRP_STA_SUPPORT", "Short-Term Accommodation - Support Hours", 1);
    private static readonly CatalogueGroupDefinition StaAccommodation = new("GRP_STA_ACCOMMODATION", "Short-Term Accommodation - Overnight Stays", 1);
    private static readonly CatalogueGroupDefinition Sleepover = new(SleepoverGroupCode, "Sleepover", 1);
    private static readonly CatalogueGroupDefinition ProviderTravel = new("GRP_PROVIDER_TRAVEL", "Provider Travel (non-labour costs)", 1);
    private static readonly CatalogueGroupDefinition ActivityBasedTransport = new("GRP_ACTIVITY_BASED_TRANSPORT", "Activity Based Transport", 4);
    private static readonly CatalogueGroupDefinition CentreCapital = new("GRP_CENTRE_CAPITAL", "Centre Capital Cost", 4);
    private static readonly CatalogueGroupDefinition Other = new("GRP_OTHER", "Other Supports", 0);

    public static IReadOnlyList<CatalogueGroupDefinition> All { get; } = new[]
    {
        CommunityAccess, CommunityAccessHighIntensity, PersonalCare, GroupActivities, StaSupport, StaAccommodation,
        Sleepover, ProviderTravel, ActivityBasedTransport, CentreCapital, Other,
    };

    /// <summary>The group an item of this classification is filed under.</summary>
    public static CatalogueGroupDefinition For(CatalogueClassification classification) => classification.Family switch
    {
        // The map names community access items only as standard / ICBS (RG 0125) and high intensity (RG 0104).
        SupportFamily.CommunityAccess => classification.Intensity == SupportIntensity.HighIntensity ? CommunityAccessHighIntensity : CommunityAccess,
        SupportFamily.PersonalCare => PersonalCare,
        SupportFamily.GroupActivity => GroupActivities,
        SupportFamily.StaSupport => StaSupport,
        SupportFamily.StaAccommodation => StaAccommodation,
        SupportFamily.Sleepover => Sleepover,
        SupportFamily.ProviderTravel => ProviderTravel,
        SupportFamily.ActivityBasedTransport => ActivityBasedTransport,
        SupportFamily.CentreCapital => CentreCapital,
        _ => Other,
    };
}
