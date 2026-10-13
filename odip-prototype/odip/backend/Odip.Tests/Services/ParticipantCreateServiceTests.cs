using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>POST /participants as a service: it validates and tracks, the caller saves. Pins what the controller did before the move.</summary>
public class ParticipantCreateServiceTests
{
    private static ParticipantCreateService Service(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new SafetyNoteSyncService(db), new ParticipantIntakeSnapshotService(db), TimeProvider.System);

    [Fact]
    public async Task Stage_tracks_an_inactive_participant_with_its_contact_and_saves_nothing_itself()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var dto = new CreateParticipantDto
        {
            FirstName = "Ava", LastName = "Stone",
            ContactRoles = [new CreateParticipantContactRoleDto { NewPersonFirstName = "Ben", NewPersonLastName = "Stone", RoleType = ContactRoleType.NextOfKin }],
        };

        var (participant, error) = await Service(db).StageAsync(dto, "actor-1", CancellationToken.None);

        Assert.Null(error);
        Assert.False(participant!.IsActive);
        Assert.Equal(0, await db.Participants.CountAsync());
        await db.SaveChangesAsync();
        Assert.Equal(tenantId, (await db.Participants.SingleAsync()).TenantId);
        var role = await db.ParticipantContactRoles.Include(r => r.Person).SingleAsync();
        Assert.Equal(("Ben", "Stone", ContactRoleType.NextOfKin), (role.Person!.FirstName, role.Person.LastName, role.RoleType));
    }

    [Fact]
    public async Task Stage_refuses_with_the_manual_message_and_tracks_nothing()
    {
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Guid.NewGuid());
        var (participant, error) = await Service(db).StageAsync(
            new CreateParticipantDto { FirstName = "Ava", LastName = "Stone", AddressPostcode = "12a4" }, "actor-1", CancellationToken.None);

        Assert.Null(participant);
        Assert.Equal("Postcode must be exactly 4 digits.", error);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task Stage_with_CompleteIntake_stamps_completion_and_adds_the_onboarding_row_and_snapshot()
    {
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Guid.NewGuid());
        var (participant, _) = await Service(db).StageAsync(
            new CreateParticipantDto { FirstName = "Ava", LastName = "Stone", IsDraft = true, CompleteIntake = true }, "actor-1", CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.NotNull(participant!.IntakeCompletedAt);
        Assert.Equal(participant.Id, (await db.ParticipantOnboardings.SingleAsync()).ParticipantId);
        Assert.Equal("actor-1", (await db.ParticipantIntakeSnapshots.SingleAsync()).CompletedBy);
    }

    [Fact]
    public async Task FindCompletedReplay_returns_the_participant_a_retried_completion_already_made()
    {
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), Guid.NewGuid());
        var service = Service(db);
        var dto = new CreateParticipantDto { FirstName = "Ava", LastName = "Stone", IsDraft = true, CompleteIntake = true, CompletionRequestId = "req-1" };
        var (first, _) = await service.StageAsync(dto, "actor-1", CancellationToken.None);
        await db.SaveChangesAsync();

        Assert.Equal(first!.Id, (await service.FindCompletedReplayAsync(dto, CancellationToken.None))!.Id);
        Assert.Null(await service.FindCompletedReplayAsync(dto with { CompletionRequestId = "req-2" }, CancellationToken.None));
    }
}
