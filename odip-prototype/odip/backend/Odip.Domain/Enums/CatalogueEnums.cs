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

/// <summary>
/// The kind of support a catalogue item prices, from the code classification map (<c>CatalogueClassifier</c>), never from the item's name.
/// Items the map does not name are <see cref="Other"/>.
/// </summary>
public enum SupportFamily
{
    /// <summary>Assistance with self-care activities (RG 0107 standard, RG 0104 high intensity), hourly by day type.</summary>
    PersonalCare = 0,
    /// <summary>Access Community, Social and Recreational Activities (RG 0125 standard and ICBS, RG 0104 high intensity), hourly by day type.</summary>
    CommunityAccess = 1,
    /// <summary>Group Activities (RG 0136 standard, RG 0104 high intensity), hourly by day type.</summary>
    GroupActivity = 2,
    /// <summary>Short-term accommodation support hours (RG 0115), hourly by day type including Weekday Night.</summary>
    StaSupport = 3,
    /// <summary>Short-term accommodation overnight stays: 01_250 participant, 01_251 support worker (per day).</summary>
    StaAccommodation = 4,
    /// <summary>Night-time sleepover, Each: 01_010 (personal care) and 01_206 (STA). One price on any day.</summary>
    Sleepover = 5,
    /// <summary>Provider travel non-labour costs (kilometres, tolls, parking), Unit Price = $1.</summary>
    ProviderTravel = 6,
    /// <summary>Activity-based transport non-labour costs, Unit Price = $1.</summary>
    ActivityBasedTransport = 7,
    /// <summary>Centre Capital Cost, per hour when the primary support is delivered in a centre.</summary>
    CentreCapital = 8,
    Other = 9
}

/// <summary>Where a support is delivered, which decides the price column: MM1-5 National, MM6 Remote (x1.40), MM7 Very Remote (x1.50).</summary>
public enum PriceZone
{
    National = 0,
    Remote = 1,
    VeryRemote = 2
}

/// <summary>The price layout of a support catalogue workbook, told apart by its header row.</summary>
public enum CatalogueFileFormat
{
    /// <summary>2026-27: National, Remote and Very Remote price columns.</summary>
    NationalRemote = 0,
    /// <summary>2025-26: one price column per state (ACT, NSW, NT, QLD, SA, TAS, VIC, WA) plus Remote and Very Remote. The eight are identical on every row.</summary>
    StateColumns = 1
}

/// <summary>The intensity of an hourly support item. Not applicable (null) to sleepover, accommodation, travel, transport and centre items.</summary>
public enum SupportIntensity
{
    Standard = 0,
    /// <summary>Needs a worker with the High Intensity Supports skills (RG 0104 items; about 8.2% above standard).</summary>
    HighIntensity = 1,
    /// <summary>Intensive and Complex Behaviour Supports.</summary>
    Icbs = 2
}
