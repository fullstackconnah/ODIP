using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Tenant-owned, immutable service-agreement draft revision. It is deliberately not a contract
/// or signed agreement: legal template approval and evidence storage are separate prerequisites.
/// A revision is never edited, but saving again deletes the participant's older revisions that did nothing; one that was approved,
/// rostered (a <c>ShiftPattern</c> points at it) or signed (a signing snapshot) is kept, and those keys restrict deleting it.
/// </summary>
public class ServiceAgreementDraft : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public int Version { get; set; }
    public DateOnly PlanStartDate { get; set; }
    public DateOnly PlanEndDate { get; set; }
    public DateOnly AgreementStartDate { get; set; }
    public DateOnly AgreementEndDate { get; set; }
    public string State { get; set; } = string.Empty;
    public string ServiceTypesJson { get; set; } = "[]";
    public string? Representative { get; set; }
    public string ParticipantNameSnapshot { get; set; } = string.Empty;
    public string? NdisNumberSnapshot { get; set; }
    public DateOnly? DateOfBirthSnapshot { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string CreatedBy { get; set; } = string.Empty;
    /// <summary>
    /// The support blocks this revision was priced from (plan builder, phase C), in the order the coordinator arranged them. Empty on a draft whose lines were
    /// typed by hand before the builder existed: those keep their lines and read as they always did.
    /// </summary>
    public ICollection<ServiceAgreementDraftBlock> Blocks { get; set; } = new List<ServiceAgreementDraftBlock>();
    /// <summary>
    /// What the pricing engine answered when this revision was saved, as the JSON of a <c>PlanQuote</c> without its per-occurrence lines (its totals, issues, notices,
    /// holiday occurrences and open questions): the revision's own record of what was priced and what a person still has to look at, so a later catalogue import or
    /// settings change cannot change what an old revision says. Null on a draft that was typed by hand.
    /// </summary>
    public string? PricingJson { get; set; }
    public ICollection<ServiceAgreementDraftLine> Lines { get; set; } = new List<ServiceAgreementDraftLine>();
}

/// <summary>
/// The record that a person approved one revision of an agreement draft for rostering (plan builder, phase D): who, when, and what it did. One row for each revision
/// (unique on <see cref="DraftId"/>), written in the same transaction as the roster patterns the approval made, and never changed: there is no un-approving, a change is
/// a new revision that is approved in its turn. It is a table of its own and not columns on <see cref="ServiceAgreementDraft"/>, which stays an immutable revision.
/// It is not the e-signing state (that is the revision's template status, and its own evidence) and it is not a signed agreement.
/// </summary>
public class ServiceAgreementDraftApproval : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid DraftId { get; set; }
    public ServiceAgreementDraft? Draft { get; set; }
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    /// <summary>The revision's version, kept here so the approval reads without its revision.</summary>
    public int DraftVersion { get; set; }
    /// <summary>The instant of the approval, from the injected clock (never the machine's).</summary>
    public DateTime ApprovedAt { get; set; }
    /// <summary>The user who approved it; null when the claim was not a user id.</summary>
    public Guid? ApprovedByUserId { get; set; }
    public string ApprovedByName { get; set; } = string.Empty;
    /// <summary>The weekly roster patterns the approval made.</summary>
    public int PatternsCreated { get; set; }
    /// <summary>The patterns of earlier approved revisions it ended the day before this revision starts.</summary>
    public int PatternsEnded { get; set; }
    /// <summary>The open shifts it generated straight away (none for a participant who is not active yet: the daily top-up makes them once they are).</summary>
    public int ShiftsCreated { get; set; }
    /// <summary>The date of the first shift it generated; null when it generated none.</summary>
    public DateOnly? FirstShiftDate { get; set; }
    /// <summary>The last day shifts were generated to (the provider's today plus the horizon, held to the agreement's end); null when none were generated.</summary>
    public DateOnly? HorizonEnd { get; set; }
}

/// <summary>
/// One weekly support block of a draft revision. The block is stored exactly as the pricing engine takes it (<see cref="BlockJson"/> is the JSON of its
/// <c>PlanBlock</c>), so re-pricing a revision later needs no translation and a change to the engine's model never needs a new column. It belongs to the revision
/// and is never edited: a change is a new revision with its own copies. Tenant ownership is the draft's (like <see cref="ServiceAgreementDraftLine"/>, this row is
/// only ever reached through its draft, which carries the tenant filter).
/// </summary>
public class ServiceAgreementDraftBlock
{
    public Guid Id { get; set; }
    public Guid DraftId { get; set; }
    public ServiceAgreementDraft? Draft { get; set; }
    /// <summary>The order of the block in the plan, from 0.</summary>
    public int Position { get; set; }
    /// <summary>The block's own key in the engine's request (<c>PlanBlock.Id</c>, at most 64 characters, unique in the revision): the lines and the totals name their block by it.</summary>
    public string BlockKey { get; set; } = string.Empty;
    /// <summary>The block as the engine takes it, as JSON (a <c>jsonb</c> column: the block is nested and the engine's model, not this table, decides its shape).</summary>
    public string BlockJson { get; set; } = "{}";
    /// <summary>
    /// What the shifts of this block will ask of a worker (gender preference, a driver, skills), as JSON: kept apart from <see cref="BlockJson"/> because the pricing
    /// engine does not read it. It is for the roster patterns an approved revision creates (phase D). Requirements only, never a name.
    /// </summary>
    public string RequirementsJson { get; set; } = "{}";
}

/// <summary>Catalogue provenance is copied to the revision so future catalogue changes cannot mutate a draft.</summary>
public class ServiceAgreementDraftLine
{
    public Guid Id { get; set; }
    public Guid DraftId { get; set; }
    public ServiceAgreementDraft? Draft { get; set; }
    public string ServiceType { get; set; } = string.Empty;
    /// <summary>The quantity in the line's <see cref="Unit"/>: hours for a line priced by the hour (the only kind a hand-typed line is), items for an Each line, nights for a Day line.</summary>
    public decimal Hours { get; set; }
    public string ItemCode { get; set; } = string.Empty;
    public string CatalogueVersion { get; set; } = string.Empty;
    public DateOnly CatalogueEffectiveFrom { get; set; }
    public DateOnly? CatalogueEffectiveTo { get; set; }
    public decimal UnitPrice { get; set; }

    // The columns below are set only on a line the pricing engine generated from a block. A hand-typed line leaves them null (and Unit "H", Position 0, no flags),
    // and is read exactly as before: its total is its hours times its unit price.

    /// <summary>The block (<see cref="ServiceAgreementDraftBlock.BlockKey"/>) the line was generated from.</summary>
    public string? BlockKey { get; set; }
    /// <summary>The time band or the kind of companion the line is for, in the engine's words ("Weekday Daytime", "Sleepover", "Activity-based transport").</summary>
    public string? Band { get; set; }
    /// <summary>H for an hour, E for each (and a dollar amount at $1.00), D for a day or night.</summary>
    public string Unit { get; set; } = "H";
    /// <summary>
    /// What the line claims for the whole agreement period, as the engine priced it: the sum of its occurrences' own totals (each floored to the cent), which is authoritative.
    /// Never read it as hours times unit price: the quantity is rounded and the price per occurrence is floored. Null on a hand-typed line.
    /// </summary>
    public decimal? Total { get; set; }
    /// <summary>How many occurrences (dated shifts) the line sums.</summary>
    public int Occurrences { get; set; }
    /// <summary>The engine's flags on the line (1 Review, 2 Holiday exposure, 4 Provisional), as the number of <c>PlannedLineFlags</c>.</summary>
    public int Flags { get; set; }
    /// <summary>The order of the line in the draft, from 0.</summary>
    public int Position { get; set; }
}
