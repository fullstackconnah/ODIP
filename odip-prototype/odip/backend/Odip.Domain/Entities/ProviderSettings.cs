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

    /// <summary>The IANA zone the organisation's "today" follows (rosters, the portal, reminders). Null = its State's default (StateTimeZoneMap). Only StateTimeZoneMap.Zones are accepted.</summary>
    public string? TimeZoneId { get; set; }
    /// <summary>Organisation profile contact details (Settings PR 2b; added with the time zone so one migration carries them).</summary>
    public string? TradingName { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? Website { get; set; }

    /// <summary>
    /// How strictly this organisation applies participant readiness before rostering, booking or
    /// activating a participant. Defaults to <see cref="ParticipantReadinessMode.Warn"/> for every
    /// existing and new organisation (the column is NOT NULL with a constant database default of
    /// 0, so adding it is deploy-safe). An organisation with no ProviderSettings row at all is
    /// also Warn. Changes are audited as a single field change, never as a whole-entity audit:
    /// this row holds bank details (see ProviderSettingsController.Upsert).
    /// </summary>
    public ParticipantReadinessMode ParticipantReadinessMode { get; set; } = ParticipantReadinessMode.Warn;

    /// <summary>
    /// Whether recording a medication administration without a current Medication Competency is only flagged (Warn, the default) or
    /// refused (Enforce). Per tenant. The column is NOT NULL with the constant default 0 (= Warn), so adding it is metadata-only and
    /// every existing provider keeps today's recording behaviour until an Admin chooses Enforce.
    /// </summary>
    public MedicationCompetencyMode MedicationCompetencyMode { get; set; } = MedicationCompetencyMode.Warn;

    /// <summary>
    /// The row's version as well as its last change: a concurrency token (OdipDbContext), as on ParticipantInquiry. Held in whole microseconds, as PostgreSQL
    /// stores it, so the value GET sends, returned by the form as ExpectedUpdatedAt, still matches the stored one.
    /// </summary>
    public DateTime UpdatedAt { get => _updatedAt; set => _updatedAt = Micro(value); }
    private DateTime _updatedAt = Micro(DateTime.UtcNow);
    private static DateTime Micro(DateTime value) => new(value.Ticks - value.Ticks % 10, value.Kind);

    /// <summary>Printed before an invoice's number (INV-0042). Letters, digits, - _ . only: it is also the PDF's file name. New invoices only.</summary>
    public string InvoiceNumberPrefix { get; set; } = "INV-";
    /// <summary>Printed before a credit note's number (CN-0007).</summary>
    public string CreditNotePrefix { get; set; } = "CN-";
    /// <summary>The first invoice number; it can change only until the organisation's first invoice is issued.</summary>
    public int InvoiceStartNumber { get; set; } = 1;
    /// <summary>An invoice is due this many days after it is issued (0 = on issue).</summary>
    public int PaymentTermsDays { get; set; } = 14;
}
