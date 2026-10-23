using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A numbered invoice or credit note, issued when a claim is marked as submitted (one per plan- or self-managed payer group). It is a snapshot:
/// seller, bill-to, lines and totals are copied at issue, so the PDF reads the same on every download whatever happens to the claim or the settings
/// later. Rows are never deleted; a voided or credited number is never used again. Deliberately NOT in AuditedEntities: it holds the bank details,
/// so void and credit write one SettingChangeAudit row on the claim instead.
/// </summary>
public class Invoice : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public InvoiceKind Kind { get; set; }
    public int Number { get; set; }
    public string DisplayNumber { get; set; } = string.Empty;
    public InvoiceStatus Status { get; set; }

    /// <summary>The claim it was issued for; null once that claim is deleted (the row and its number stay).</summary>
    public Guid? TripClaimId { get; set; }
    public string ClaimReference { get; set; } = string.Empty;
    /// <summary>The payer group: the booking for a trip claim (null for a shift claim), and always the participant.</summary>
    public Guid? ParticipantBookingId { get; set; }
    public Guid ParticipantId { get; set; }
    public string ParticipantName { get; set; } = string.Empty;
    public string? NdisNumber { get; set; }
    /// <summary>"Trip: {name}" or "Period: 01 Oct 2026 – 14 Oct 2026".</summary>
    public string ServiceReference { get; set; } = string.Empty;

    public DateOnly IssueDate { get; set; }
    /// <summary>Always set on a stored invoice; null only on the never-saved preview and legacy renders.</summary>
    public DateOnly? DueDate { get; set; }
    public PlanType PayerKind { get; set; }
    public string BillToName { get; set; } = string.Empty;
    public string BillToAddress { get; set; } = string.Empty;
    public string? BillToEmail { get; set; }

    public string SellerOrganisationName { get; set; } = string.Empty;
    public string SellerAbn { get; set; } = string.Empty;
    public string SellerRegistrationNumber { get; set; } = string.Empty;
    public string SellerAddress { get; set; } = string.Empty;
    /// <summary>The provider's state at issue: later dates on this invoice ("Voided on") are read in its zone, never the live settings'.</summary>
    public string SellerState { get; set; } = string.Empty;
    public bool GstRegistered { get; set; }
    public string? BankAccountName { get; set; }
    public string? Bsb { get; set; }
    public string? AccountNumber { get; set; }
    public string? FooterNotes { get; set; }
    public int PaymentTermsDays { get; set; }

    public decimal Subtotal { get; set; }
    public decimal Gst { get; set; }
    public decimal Total { get; set; }

    /// <summary>On a credit note: the invoice it credits, and that invoice's number.</summary>
    public Guid? CreditsInvoiceId { get; set; }
    public string? CreditsDisplayNumber { get; set; }

    public DateTime? VoidedAt { get; set; }
    public Guid? VoidedById { get; set; }
    /// <summary>Internal: kept for the audit, never printed or sent to the browser.</summary>
    public string? VoidReason { get; set; }

    public DateTime CreatedAt { get; set; }
    public Guid? CreatedById { get; set; }

    public ICollection<InvoiceLine> Lines { get; set; } = new List<InvoiceLine>();
}

/// <summary>One line of an invoice, copied from its claim line at issue (stored values, never recomputed).</summary>
public class InvoiceLine : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid InvoiceId { get; set; }
    /// <summary>The claim line it was copied from; null once the claim is deleted.</summary>
    public Guid? ClaimLineItemId { get; set; }
    public string SupportItemCode { get; set; } = string.Empty;
    public DateOnly ServiceFrom { get; set; }
    public DateOnly ServiceTo { get; set; }
    public decimal Hours { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; set; }
    public GSTCode GSTCode { get; set; }
}

/// <summary>The next number of each kind for one organisation. Taken with one atomic upsert inside the issuing transaction, so a rolled-back issue gives its number back.</summary>
public class InvoiceNumberCounter : ITenantEntity
{
    public Guid TenantId { get; set; }
    public InvoiceKind Kind { get; set; }
    public int NextNumber { get; set; }
}
