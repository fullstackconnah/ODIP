using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

/// <summary>The referral sources every organisation starts with, in the order the Settings list shows them by name. Setting an organisation up copies them in; the AddReferralSources migration gave the organisations that already existed the same nine.</summary>
public static class StarterReferralSources
{
    public static readonly string[] Names =
    [
        "Support Coordinator", "Local Area Coordinator (LAC)", "NDIA planner", "GP or health professional", "Hospital",
        "Another provider", "Family or friend", "Self-referral", "Website or search",
    ];

    public static List<ReferralSource> For(Guid tenantId) =>
        Names.Select(name => new ReferralSource { Id = Guid.NewGuid(), TenantId = tenantId, Name = name }).ToList();
}
