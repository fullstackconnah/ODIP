using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Notes;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the filtered unique index on
/// (TenantId, IdempotencyKey) that makes a retried add-note save safe, and the race the controller answers as a replay.
/// </summary>
public class ParticipantNoteRetryPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public ParticipantNoteRetryPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Participant NewParticipant(Guid tenantId) => new() { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sophie", LastName = "Brown", IsActive = true };

    private static ParticipantNote NewNote(Guid tenantId, Guid participantId, string? key) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Title = "Haircut", Description = "Short bob.", CreatedByName = "Test", IdempotencyKey = key,
    };

    [SkippableFact]
    public async Task TheIndex_RefusesTheSameKeyTwiceInATenant_ButNotNullKeys_OrAnotherTenant()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenant) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (otherDb, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = otherDb;
        var person = NewParticipant(tenant);
        var otherPerson = NewParticipant(otherTenant);
        db.Participants.Add(person);
        otherDb.Participants.Add(otherPerson);
        await db.SaveChangesAsync(Ct);
        await otherDb.SaveChangesAsync(Ct);

        db.ParticipantNotes.AddRange(NewNote(tenant, person.Id, null), NewNote(tenant, person.Id, null), NewNote(tenant, person.Id, "key-1"));
        await db.SaveChangesAsync(Ct); // two null keys are outside the filtered index
        otherDb.ParticipantNotes.Add(NewNote(otherTenant, otherPerson.Id, "key-1"));
        await otherDb.SaveChangesAsync(Ct); // the same key in another tenant is its own row

        db.ParticipantNotes.Add(NewNote(tenant, person.Id, "key-1"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync(Ct));
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(ParticipantNote.IdempotencyIndexName, pg.ConstraintName);
    }

    /// <summary>Hands the first save a rival that commits the same (tenant, key) just before it, which is what two saves passing the lookup together look like.</summary>
    private sealed class RivalFirstInterceptor(Func<Task> rival) : SaveChangesInterceptor
    {
        private bool _fired;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_fired) { _fired = true; await rival(); }
            return result;
        }
    }

    [SkippableFact]
    public async Task ARacingSaveWithTheSameKey_AnswersAsAReplayOfTheWinner_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (setup, tenant) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var person = NewParticipant(tenant);
        setup.Participants.Add(person);
        await setup.SaveChangesAsync(Ct);
        var winner = NewNote(tenant, person.Id, "race-key");

        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString)
            .AddInterceptors(new RivalFirstInterceptor(async () =>
            {
                await using var rival = PostgresFixture.NewContext(_pg.ConnectionString);
                rival.ParticipantNotes.Add(winner);
                await rival.SaveChangesAsync(Ct);
            })).Options;
        var tenantMock = new Moq.Mock<Odip.Domain.Interfaces.ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenant);
        tenantMock.Setup(t => t.IsSuperAdmin).Returns(false);
        await using var db = new OdipDbContext(options, tenantMock.Object);

        var result = await new ParticipantNotesController(db, new SafetyNoteSyncService(db)).Create(person.Id,
            new CreateParticipantNoteDto { Title = "Haircut", Description = "Short bob.", IdempotencyKey = "race-key" }, Ct);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(winner.Id, Assert.IsType<ApiResponse<ParticipantNoteDto>>(ok.Value).Data!.Id);
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.Equal(1, await check.ParticipantNotes.CountAsync(n => n.TenantId == tenant && n.IdempotencyKey == "race-key", Ct));
    }
}
