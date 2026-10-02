using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

/// <summary>A Demo participant a story can use: just what a pack needs to decide whether to use them.</summary>
public sealed record DemoParticipant(Guid Id, string Key, string FullName, bool IsActive, bool IsDraft)
{
    public bool CanBeRostered => IsActive && !IsDraft;
}

/// <summary>
/// The people of the Demo tenant, resolved once per tick by natural key (see <see cref="DemoPeople"/>). A person who is not there (deleted,
/// renamed by the owner) is simply absent: the pack skips the stories that need them and logs it, and every other story proceeds.
/// Users are loaded tracked, because the credential fill changes them; everything else only reads.
/// </summary>
public sealed class DemoDirectory
{
    private readonly Dictionary<string, User> _staff;
    private readonly Dictionary<string, DemoParticipant> _participants;

    private DemoDirectory(IReadOnlyList<User> users, Dictionary<string, User> staff, IReadOnlyList<DemoParticipant> everyParticipant,
        Dictionary<string, DemoParticipant> participants)
    {
        AllUsers = users;
        _staff = staff;
        AllParticipants = everyParticipant;
        _participants = participants;
    }

    /// <summary>Every user of the Demo tenant (the 11 seeded ones, plus anyone the owner added).</summary>
    public IReadOnlyList<User> AllUsers { get; }

    public IReadOnlyList<DemoParticipant> AllParticipants { get; }

    /// <summary>The rosterable staff member for a story key ("james"), or null when they are missing or inactive.</summary>
    public User? Staff(string key) => _staff.TryGetValue(key, out var user) && user.IsActive ? user : null;

    /// <summary>The participant for a story key ("sophie"), or null when missing, archived or still a draft.</summary>
    public DemoParticipant? Participant(string key) =>
        _participants.TryGetValue(key, out var participant) && participant.CanBeRostered ? participant : null;

    /// <summary>
    /// Tells <see cref="DemoTenantGuard"/> which users and participants the Demo tenant owns. The guard is built before the context it
    /// guards (it is an interceptor on it), so it holds this set empty and the maintainer fills it once the directory has loaded.
    /// </summary>
    public void FillOwned(DemoOwnedIds target)
    {
        foreach (var user in AllUsers) target.Users.Add(user.Id);
        foreach (var participant in AllParticipants) target.Participants.Add(participant.Id);
    }

    /// <summary>Loads through a tenant-scoped context, so only the Demo tenant's rows can come back.</summary>
    public static async Task<DemoDirectory> LoadAsync(OdipDbContext db, CancellationToken ct)
    {
        var users = await db.Users.ToListAsync(ct);
        var staff = new Dictionary<string, User>();
        foreach (var (key, email) in DemoPeople.StaffEmails)
        {
            var match = users.FirstOrDefault(u => string.Equals(u.Email, email, StringComparison.OrdinalIgnoreCase));
            if (match is not null) staff[key] = match;
        }

        var rows = await db.Participants
            .Select(p => new { p.Id, p.NdisNumber, p.FirstName, p.LastName, p.IsActive, p.IsDraft })
            .ToListAsync(ct);
        var everyone = rows
            .Select(p => new DemoParticipant(p.Id, KeyFor(p.NdisNumber), $"{p.FirstName} {p.LastName}".Trim(), p.IsActive, p.IsDraft))
            .ToList();
        var participants = new Dictionary<string, DemoParticipant>();
        foreach (var participant in everyone)
        {
            if (participant.Key.Length > 0) participants[participant.Key] = participant;
        }

        return new DemoDirectory(users, staff, everyone, participants);
    }

    private static string KeyFor(string? ndisNumber)
    {
        foreach (var (key, number) in DemoPeople.ParticipantNdisNumbers)
        {
            if (string.Equals(number, ndisNumber, StringComparison.Ordinal)) return key;
        }
        return string.Empty;
    }
}
