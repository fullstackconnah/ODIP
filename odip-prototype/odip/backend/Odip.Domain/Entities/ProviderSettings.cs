using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

public class ProviderSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string RegistrationNumber { get; set; } = string.Empty;
    public string ABN { get; set; } = string.Empty;
    public string OrganisationName { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string State { get; set; } = "VIC";
    public bool GSTRegistered { get; set; }
    public bool IsPaceProvider { get; set; }

    public string? BankAccountName { get; set; }
    public string? BSB { get; set; }
    public string? AccountNumber { get; set; }
    public string? InvoiceFooterNotes { get; set; }
}
