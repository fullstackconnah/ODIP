namespace Odip.Domain.Entities;

public class SupportActivityGroup
{
    public Guid Id { get; set; }
    public string GroupCode { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int SupportCategory { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<SupportCatalogueItem> Items { get; set; } = new List<SupportCatalogueItem>();
}
