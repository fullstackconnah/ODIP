using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Emergency contacts for the participants the roster stories use (plan 7: "EmergencyContact roles"). The shift package's need-to-know
/// block lists a participant's active Emergency Contact roles (or Next of Kin when there are none), and only Liam had one: Sophie, Harrison,
/// Charlotte and the rest showed an empty "who to call" in the middle of a shift.
///
/// One contact per participant, two for Sophie and Harrison (the two people whose shifts carry the live medication stories), each a Person
/// plus an EmergencyContact role. A participant who already has an active Emergency Contact of any origin is left alone. Everything is
/// fictional: addresses are @example.com.au, mobiles are in the old seed's 0412 345 xxx range.
/// </summary>
public sealed class EmergencyContactsPack : IDemoPack
{
    public string Name => "emergency-contacts";

    private sealed record Contact(string Participant, int Priority, string First, string Last, string Relationship);

    // Mobile numbers are assigned in table order: 0412 345 101, 102, ...
    private static readonly Contact[] Contacts =
    {
        new("sophie", 1, "Margaret", "Brown", "Mother"),
        new("sophie", 2, "Peter", "Brown", "Father"),
        new("harrison", 1, "Helen", "Lee", "Mother"),
        new("harrison", 2, "Gregory", "Lee", "Father"),
        new("charlotte", 1, "Susan", "White", "Mother"),
        new("noah", 1, "Karen", "Taylor", "Mother"),
        new("ethan", 1, "Linda", "Davis", "Mother"),
        new("mia", 1, "Robert", "Anderson", "Father"),
        new("grace", 1, "Patricia", "Sullivan", "Mother"),
        new("mason", 1, "Hoa", "Nguyen", "Mother"),
        new("thomas", 1, "Anita", "Patel", "Mother"),
        new("ryan", 1, "Brian", "Murphy", "Father"),
        new("olivia", 1, "Gareth", "Wilson", "Brother"),
        new("william", 1, "Julie", "Martin", "Sister"),
        new("dylan", 1, "Michelle", "Foster", "Mother"),
        new("jack", 1, "Frank", "Thomas", "Father"),
        new("chloe", 1, "Rebecca", "Robinson", "Sister"),
        new("isabella", 1, "Claire", "Clarke", "Mother"),
    };

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var people = new List<Person>();
        var roles = new List<ParticipantContactRole>();
        var number = 0;
        foreach (var contact in Contacts)
        {
            number++;
            var participant = run.Directory.Participant(contact.Participant);
            if (participant is null)
            {
                run.Skipped($"emergency contact for {contact.Participant}", "participant missing, archived or a draft");
                continue;
            }

            var person = new Person
            {
                Id = DemoIds.For("contact-person", contact.Participant, contact.Priority),
                TenantId = run.TenantId,
                FirstName = contact.First,
                LastName = contact.Last,
                Mobile = $"0412 345 {100 + number:D3}",
                Email = $"{contact.First}.{contact.Last}@example.com.au".ToLowerInvariant(),
                Notes = "Demo contact: fictional person.",
                CreatedAt = run.NowUtc,
                UpdatedAt = run.NowUtc,
            };
            people.Add(person);
            roles.Add(new ParticipantContactRole
            {
                Id = DemoIds.For("contact-role", contact.Participant, contact.Priority),
                TenantId = run.TenantId,
                ParticipantId = participant.Id,
                PersonId = person.Id,
                RoleType = ContactRoleType.EmergencyContact,
                RelationshipToParticipant = contact.Relationship,
                IsPrimary = contact.Priority == 1,
                PriorityOrder = contact.Priority,
                AuthorisedForMedicalInfo = contact.Priority == 1,
                Status = ContactRoleStatus.Active,
                CreatedAt = run.NowUtc,
                UpdatedAt = run.NowUtc,
            });
        }

        var ourRoleIds = roles.Select(r => r.Id).ToHashSet();
        var participantIds = roles.Select(r => r.ParticipantId).Distinct().ToList();
        var existingRoles = await run.ExistingIdsAsync<ParticipantContactRole>(ourRoleIds, ct);
        var existingPeople = await run.ExistingIdsAsync<Person>(people.Select(p => p.Id), ct);

        // A participant with an active Emergency Contact that is not one of ours already has somebody to call: leave them alone.
        var foreign = (await DemoQueries.ActiveEmergencyContacts(run.Db, participantIds).ToListAsync(ct))
            .Where(r => !ourRoleIds.Contains(r.Id))
            .Select(r => r.ParticipantId)
            .ToHashSet();

        var newRoles = roles.Where(r => !existingRoles.Contains(r.Id) && !foreign.Contains(r.ParticipantId)).ToList();
        var newPersonIds = newRoles.Select(r => r.PersonId).ToHashSet();
        var newPeople = people.Where(p => newPersonIds.Contains(p.Id) && !existingPeople.Contains(p.Id)).ToList();
        if (newRoles.Count == 0) return;

        run.Db.People.AddRange(newPeople);
        run.Db.ParticipantContactRoles.AddRange(newRoles);
        await run.SaveAsync(ct);
        run.Added("people", newPeople.Count);
        run.Added("emergency contact roles", newRoles.Count);
    }
}
