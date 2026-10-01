using Odip.Domain.Enums;
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

    /// <summary>
    /// MED-02: primary manager contact shown first in MED-01's missed-medication guidance (not
    /// yet built — this is the setting CRUD/display only). Nullable — unset until an Admin fills
    /// it in.
    /// </summary>
    public string? ManagerName { get; set; }
    public string? ManagerPhone { get; set; }

    /// <summary>
    /// How strictly this organisation applies participant readiness before rostering, booking or
    /// activating a participant. Defaults to <see cref="ParticipantReadinessMode.Warn"/> for every
    /// existing and new organisation (the column is NOT NULL with a constant database default of
    /// 0, so adding it is deploy-safe). An organisation with no ProviderSettings row at all is
    /// also Warn. Changes are audited as a single field change, never as a whole-entity audit:
    /// this row holds bank details (see ProviderSettingsController.Upsert).
    /// </summary>
    public ParticipantReadinessMode ParticipantReadinessMode { get; set; } = ParticipantReadinessMode.Warn;
}
