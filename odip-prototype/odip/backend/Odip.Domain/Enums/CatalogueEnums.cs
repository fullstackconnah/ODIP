namespace Odip.Domain.Enums;

// Values here are persisted as integers (EF's default enum mapping) and travel as names in JSON: append, never renumber.

/// <summary>The support catalogue's "Type" column (2025-26 calls Priced "Price Limited Supports"). A blank cell is stored as null.</summary>
public enum CatalogueItemType
{
    /// <summary>Has a price limit per unit.</summary>
    Priced = 0,
    /// <summary>No price limit; claimable only when the item is stated in the participant's plan.</summary>
    Quotable = 1,
    /// <summary>"Unit Price = $1": the quantity is a dollar amount claimed at $1.00 (provider travel non-labour, activity-based transport).</summary>
    UnitPriceOne = 2
}

/// <summary>A claim-flag cell of the catalogue: Y, N or NA. A blank cell is stored as null (unknown).</summary>
public enum CatalogueClaimFlag
{
    No = 0,
    Yes = 1,
    NotApplicable = 2
}
