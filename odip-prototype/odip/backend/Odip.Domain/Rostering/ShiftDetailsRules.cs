namespace Odip.Domain.Rostering;

/// <summary>What the "Needs details" rule reads off a completion (finish-later). <c>TravelAsked</c> is the organisation's provider-travel switch.</summary>
public sealed record ShiftDetailsFacts(bool DetailsRequired, bool TravelAsked, bool HasNote,
    decimal? Kilometres, int? PreMinutes, decimal? PreKm, bool PreNone, int? PostMinutes, decimal? PostKm, bool PostNone,
    string? HandoverText, bool NothingToHandOver, bool NothingToNoteConfirmed, bool? AnythingToReport);

public static class ShiftDetailsRules
{
    public const string Kilometres = "kilometres", TripTo = "tripTo", TripAfter = "tripAfter", Notes = "notes", Handover = "handover", Report = "report";

    /// <summary>The deferrable answers still missing, in a fixed order; empty for a completion that never opted in. Doses are not here: they block the end.
    /// The phone's live form runs the same rule (checklist.missingDetails); both are pinned by one case table.</summary>
    public static IReadOnlyList<string> Missing(ShiftDetailsFacts f) => [];
}
