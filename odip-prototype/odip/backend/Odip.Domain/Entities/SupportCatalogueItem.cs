using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class SupportCatalogueItem
{
    public Guid Id { get; set; }
    public Guid ActivityGroupId { get; set; }
    public SupportActivityGroup ActivityGroup { get; set; } = null!;

    public string ItemNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Unit { get; set; } = "H";
    public ClaimDayType DayType { get; set; }
    public bool IsIntensive { get; set; }

    public decimal PriceLimit_ACT { get; set; }
    public decimal PriceLimit_NSW { get; set; }
    public decimal PriceLimit_NT { get; set; }
    public decimal PriceLimit_QLD { get; set; }
    public decimal PriceLimit_SA { get; set; }
    public decimal PriceLimit_TAS { get; set; }
    public decimal PriceLimit_VIC { get; set; }
    public decimal PriceLimit_WA { get; set; }
    public decimal PriceLimit_Remote { get; set; }
    public decimal PriceLimit_VeryRemote { get; set; }

    public string CatalogueVersion { get; set; } = string.Empty;
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public bool IsActive { get; set; } = true;
}
