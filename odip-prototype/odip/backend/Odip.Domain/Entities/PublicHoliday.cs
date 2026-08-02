namespace Odip.Domain.Entities;

public class PublicHoliday
{
    public Guid Id { get; set; }
    public DateOnly Date { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? State { get; set; }
}
