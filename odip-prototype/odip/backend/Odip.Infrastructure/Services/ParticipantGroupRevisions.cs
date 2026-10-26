using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Per-section revisions for a participant's scalar PATCH groups. One table ties each key to its DTO property and its Participant
/// columns, so "sent", "changed" and the key list cannot drift apart. A missing row is revision 0.
/// </summary>
public static class ParticipantGroupRevisions
{
    public const string ChangedCode = "participant-section-changed";
    public const string ChangedMessage = "Someone else saved this section since you opened it.";

    // Literal camelCase keys: no DictionaryKeyPolicy is configured, so keys serialise as written.
    internal static readonly (string Key, Func<PatchParticipantDto, object?> Sent, string[] Columns)[] Groups = [];

    public static readonly string[] Keys = Groups.Select(g => g.Key).ToArray();

    // Participant columns in no scalar group (ids, tenant, lifecycle, timestamps). The completeness test pins it.
    internal static readonly string[] NotGroupColumns = [];

    public static IEnumerable<string> SentGroups(PatchParticipantDto dto) => [];

    /// <summary>All 16 keys; 0 where there is no row.</summary>
    public static Task<Dictionary<string, int>> ReadAsync(OdipDbContext db, Guid participantId, CancellationToken ct) =>
        Task.FromResult(new Dictionary<string, int>());

    /// <summary>The current revisions when any expected, sent key differs (`!=`: an expected value above the current one is stale too); else null. A missing row is 0.</summary>
    public static Task<Dictionary<string, int>?> StaleAsync(OdipDbContext db, Guid participantId,
        IReadOnlyDictionary<string, int> expected, IEnumerable<string> sentKeys, CancellationToken ct) =>
        Task.FromResult<Dictionary<string, int>?>(null);

    /// <summary>Call just before SaveChanges. Bumps each group with a changed column.</summary>
    public static Task BumpChangedAsync(OdipDbContext db, Participant p, IReadOnlyDictionary<string, int>? expected, CancellationToken ct) =>
        Task.CompletedTask;

    public static bool IsLostRace(DbUpdateException ex) => false;

    /// <summary>SaveChanges for a writer that sent no expected revision: on a lost revision race, take the latest revision and save once more.</summary>
    public static Task SaveBumpingAsync(OdipDbContext db, CancellationToken ct) => db.SaveChangesAsync(ct);
}
