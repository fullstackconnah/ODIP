namespace Odip.Infrastructure.Services;

/// <summary>
/// Finds the participants already in an organisation for an import row: by NDIS number, or, only when the row gives no number, by full name (whatever the case and
/// spacing) and date of birth. A row with a number never falls back to the name: that could put the money, or the shifts, on someone else.
/// </summary>
public sealed class ImportParticipantLookup
{
    private readonly ILookup<string, ImportParticipantMatch> _byNdis;
    private readonly ILookup<(string, DateOnly), ImportParticipantMatch> _byName;

    public ImportParticipantLookup(IReadOnlyList<ImportParticipantMatch> participants)
    {
        // Only real numbers: a participant saved with "-" or "TBC" is never found by it.
        _byNdis = participants.Where(p => p.NdisNumber != null && ImportParticipantRows.IsNdisNumber(ImportParticipantRows.NdisKey(p.NdisNumber))).ToLookup(p => ImportParticipantRows.NdisKey(p.NdisNumber!));
        _byName = participants.Where(p => p.DateOfBirth is not null).ToLookup(p => (NameKey($"{p.FirstName} {p.LastName}".Trim()), p.DateOfBirth!.Value));
    }

    public IReadOnlyList<ImportParticipantMatch> Find(string? ndisKey, string fullName, DateOnly? dateOfBirth) =>
        ndisKey is { } key ? _byNdis[key].ToList()
            : dateOfBirth is { } born && fullName.Length > 0 ? _byName[(NameKey(fullName), born)].ToList() : [];

    public static string NameKey(string name) => string.Join(' ', name.Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
}
