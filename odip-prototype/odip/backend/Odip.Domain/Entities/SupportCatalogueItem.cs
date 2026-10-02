using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// One row of an NDIA support catalogue: an item as one catalogue version published it. A code appears once per version and
/// <see cref="EffectiveFrom"/>/<see cref="EffectiveTo"/> are the row's own start and end dates from the file (an open-ended row has no
/// end), so the row valid on a service date is found by date, never by "latest". Rows from before the 2026-27 import were
/// written by an importer that stamped "today" as the start date and carry none of the classification or zone-price columns below
/// (all null): they are history, not data to trust.
/// </summary>
public class SupportCatalogueItem
{
    public Guid Id { get; set; }
    public Guid ActivityGroupId { get; set; }
    public SupportActivityGroup ActivityGroup { get; set; } = null!;

    public string ItemNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    /// <summary>The catalogue's unit code: H hour, E each, D day, WK week, MON month, YR year.</summary>
    public string Unit { get; set; } = "H";
    public ClaimDayType DayType { get; set; }
    public bool IsIntensive { get; set; }

    // The eight per-state limits and the two remote ones are the 2025-26 shape, kept because the trip claims, shift claims and
    // agreement drafts still read them. A 2026-27 import fills every state column with the National price. PriceLimit_Remote and
    // PriceLimit_VeryRemote are 0 where the file lists no remote price; the nullable Price* columns below are the truth.
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

    /// <summary>The catalogue version label the admin confirmed on import (for example "2026-27"). Informational: validity comes from the dates.</summary>
    public string CatalogueVersion { get; set; } = string.Empty;
    public DateOnly EffectiveFrom { get; set; }
    /// <summary>Null = open-ended (the file's 99991231).</summary>
    public DateOnly? EffectiveTo { get; set; }
    /// <summary>
    /// "In the current catalogue": true on an imported row unless its own end date has already passed, false on a row an import has
    /// end-dated (superseded by a newer version, or its code left the catalogue). The Support Catalogue list reads this flag. It is NOT what
    /// prices a service: the claim engines, the agreement draft and the date-effective lookup use the row valid on the SERVICE date
    /// (<c>EffectiveCatalogueResolver.IsValidOn</c>), where an inactive row still counts if it has an end date, because it is still the right row
    /// for the dates inside its window. An inactive row with no end date was withdrawn by hand (an import always end-dates what it deactivates)
    /// and prices nothing.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>The 4-digit registration group a provider must hold to claim the item (for example "0125"), from the file's column.</summary>
    public string? RegistrationGroup { get; set; }
    /// <summary>Legacy support category 1-15.</summary>
    public int? SupportCategoryNumber { get; set; }
    /// <summary>The PACE category (1-21): where the plan budget for the item sits. Differs from <see cref="SupportCategoryNumber"/> on STA and SIL items.</summary>
    public int? PaceSupportCategoryNumber { get; set; }
    /// <summary>Outcome domain digit of the item number (4th part: 1 daily living ... 8 choice and control).</summary>
    public int? OutcomeDomain { get; set; }
    /// <summary>Support purpose digit of the item number (5th part: 1 core, 2 capital, 3 capacity building). Stored as published, never derived from the category.</summary>
    public int? SupportPurpose { get; set; }
    public CatalogueItemType? CatalogueType { get; set; }

    // The five claim-flag columns. A claim type is allowed only where its flag is Yes.
    public CatalogueClaimFlag? NonFaceToFace { get; set; }
    public CatalogueClaimFlag? ProviderTravel { get; set; }
    public CatalogueClaimFlag? ShortNoticeCancellation { get; set; }
    public CatalogueClaimFlag? NdiaRequestedReports { get; set; }
    public CatalogueClaimFlag? IrregularSil { get; set; }

    /// <summary>The row came from the catalogue's Legacy sheet: still claimable until its end date, no longer offered for new plans.</summary>
    public bool IsLegacy { get; set; }

    /// <summary>MM1-5 price per unit. Null on a quotable item (no price limit).</summary>
    public decimal? PriceNational { get; set; }
    /// <summary>MM6 price. Null = the file lists none, so the item is not eligible for remote loading.</summary>
    public decimal? PriceRemote { get; set; }
    /// <summary>MM7 price. Null = not eligible for very remote loading.</summary>
    public decimal? PriceVeryRemote { get; set; }

    /// <summary>The file the row was imported from (its name as uploaded).</summary>
    public string? SourceDocument { get; set; }
}
