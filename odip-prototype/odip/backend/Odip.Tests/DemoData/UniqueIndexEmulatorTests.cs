using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The test double that makes EF InMemory refuse a row PostgreSQL would (see <see cref="UniqueIndexEmulator"/>). It is what the rest of the demo suite leans on for
/// "one acknowledgement per reader and handover", "one running break", "one tick per occurrence", so it is held to the database's own rules here: the key, the
/// filter, NULLs, a save that replaces a row, and the exception the maintainer classifies.
/// </summary>
public class UniqueIndexEmulatorTests
{
    private static readonly Guid Tenant = DemoTestEnv.DemoTenantId;
    private static readonly DateTimeOffset Clock = new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);

    private static HandoverAcknowledgement Ack(Guid source, Guid reader) => new()
    {
        Id = Guid.NewGuid(), TenantId = Tenant, SourceCompletionId = source, ShiftId = Guid.NewGuid(), UserId = reader, AcknowledgedAt = Clock.UtcDateTime,
    };

    private static ShiftBreak Break(Guid completion, DateTime? ended) => new()
    {
        Id = Guid.NewGuid(), TenantId = Tenant, ShiftCompletionId = completion, StartedAt = Clock.UtcDateTime.AddHours(-2), EndedAt = ended, CreatedByUserId = Guid.NewGuid(),
    };

    private static ShiftRoutineCheck Tick(Guid completion, Guid routine, DateTime? scheduled) => new()
    {
        Id = Guid.NewGuid(), TenantId = Tenant, ShiftCompletionId = completion, ParticipantRoutineId = routine, ScheduledAt = scheduled, RoutineTitle = "Morning routine",
        CheckedByUserId = Guid.NewGuid(), CheckedAt = Clock.UtcDateTime,
    };

    private static async Task SaveAsync(DemoTestEnv env, params object[] rows)
    {
        await using var db = env.AdminDb();
        db.AddRange(rows);
        await db.SaveChangesAsync();
    }

    private static async Task AssertRefusedAsync(string index, Func<Task> save)
    {
        var refused = await Assert.ThrowsAsync<DbUpdateException>(save);
        var pg = Assert.IsType<PostgresException>(refused.InnerException);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, pg.SqlState);
        Assert.Equal(index, pg.ConstraintName);
    }

    [Fact]
    public async Task ASecondAcknowledgementForOneReaderAndHandover_IsRefusedAsTheDatabaseWould_WhoeverWroteTheFirst()
    {
        var env = new DemoTestEnv(Clock);
        var (source, reader) = (Guid.NewGuid(), Guid.NewGuid());
        await SaveAsync(env, Ack(source, reader));

        await AssertRefusedAsync(HandoverAcknowledgement.UniqueReaderIndexName, () => SaveAsync(env, Ack(source, reader)));       // a different id, the same pair

        await SaveAsync(env, Ack(source, Guid.NewGuid()), Ack(Guid.NewGuid(), reader));                                              // another reader, another handover: fine
        await using var db = env.AdminDb();
        Assert.Equal(3, await db.HandoverAcknowledgements.CountAsync());                                                               // and the refused one left nothing behind
    }

    [Fact]
    public async Task TwoNewRowsWithOneKeyInTheSameSave_AreRefused()
    {
        var env = new DemoTestEnv(Clock);
        var (source, reader) = (Guid.NewGuid(), Guid.NewGuid());

        await AssertRefusedAsync(HandoverAcknowledgement.UniqueReaderIndexName, () => SaveAsync(env, Ack(source, reader), Ack(source, reader)));
    }

    [Fact]
    public async Task OnlyOneBreakOfACompletionMayBeRunning_AnyNumberMayHaveEnded()
    {
        var env = new DemoTestEnv(Clock);
        var completion = Guid.NewGuid();
        await SaveAsync(env, Break(completion, null), Break(completion, Clock.UtcDateTime.AddHours(-1)), Break(completion, Clock.UtcDateTime.AddMinutes(-30)));

        await AssertRefusedAsync(ShiftBreak.OneRunningIndexName, () => SaveAsync(env, Break(completion, null)));
        await SaveAsync(env, Break(Guid.NewGuid(), null));                                                                             // another completion's own running break
    }

    [Fact]
    public async Task EndingTheRunningBreakAndStartingAnotherInOneSave_FreesTheKey_ButAChangedRowCannotTakeAHeldKey()
    {
        var env = new DemoTestEnv(Clock);
        var completion = Guid.NewGuid();
        var running = Break(completion, null);
        var ended = Break(completion, Clock.UtcDateTime.AddHours(-1));
        await SaveAsync(env, running, ended);

        await using (var db = env.AdminDb())
        {
            (await db.ShiftBreaks.SingleAsync(b => b.Id == running.Id)).EndedAt = Clock.UtcDateTime;
            db.ShiftBreaks.Add(Break(completion, null));
            await db.SaveChangesAsync();                                                                                                // the old one ends as the new one starts: no violation
        }

        await using var again = env.AdminDb();
        (await again.ShiftBreaks.SingleAsync(b => b.Id == ended.Id)).EndedAt = null;                                                   // re-opening an ended one beside the running one
        var refused = await Assert.ThrowsAsync<DbUpdateException>(() => again.SaveChangesAsync());
        Assert.Equal(ShiftBreak.OneRunningIndexName, Assert.IsType<PostgresException>(refused.InnerException).ConstraintName);
    }

    [Fact]
    public async Task ATickIsUniquePerCompletionRoutineAndOccurrence_AndAnUntimedRoutineHasItsOwnIndex()
    {
        var env = new DemoTestEnv(Clock);
        var (completion, routine) = (Guid.NewGuid(), Guid.NewGuid());
        var seven = new DateTime(2026, 10, 2, 7, 0, 0, DateTimeKind.Unspecified);
        await SaveAsync(env, Tick(completion, routine, seven), Tick(completion, routine, null));

        await AssertRefusedAsync(ShiftRoutineCheck.UniqueTimedIndexName, () => SaveAsync(env, Tick(completion, routine, seven)));
        await AssertRefusedAsync(ShiftRoutineCheck.UniqueUntimedIndexName, () => SaveAsync(env, Tick(completion, routine, null)));
        await SaveAsync(env, Tick(completion, routine, seven.AddHours(6)), Tick(completion, Guid.NewGuid(), seven));                    // another occurrence, another routine
    }

    [Fact]
    public async Task ANullPartNeverConflicts_AndTheKeyIsPerTenantAndCaseSensitive()
    {
        var env = new DemoTestEnv(Clock);
        MedicationAdministration Dose(string? key, Guid? tenant = null) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? Tenant, ParticipantMedicationId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), RecordedByName = "James",
            Status = Odip.Domain.Enums.MedicationAdministrationStatus.Administered, IdempotencyKey = key,
        };
        await SaveAsync(env, Dose(null), Dose(null), Dose("demo-v1:a"));                                                               // NULL keys are distinct

        await AssertRefusedAsync(MedicationAdministration.IdempotencyIndexName, () => SaveAsync(env, Dose("demo-v1:a")));
        await SaveAsync(env, Dose("demo-v1:A"), Dose("demo-v1:a", Guid.NewGuid()));                                                    // another case, another tenant
    }

    [Fact]
    public async Task OneActiveCompletionPerShift_AnyNumberOfInactiveOnes()
    {
        var env = new DemoTestEnv(Clock);
        var shift = Guid.NewGuid();
        ShiftCompletion Completion(bool active) => new()
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ShiftId = shift, SubmittedByUserId = Guid.NewGuid(), ActualStart = Clock.UtcDateTime, StartedAt = Clock.UtcDateTime,
            TimeZoneId = "Australia/Sydney", IsActive = active,
        };
        await SaveAsync(env, Completion(true), Completion(false), Completion(false));

        await AssertRefusedAsync(ShiftCompletion.ActiveIndexName, () => SaveAsync(env, Completion(true)));
    }

    [Fact]
    public async Task EveryUniqueIndexInTheModel_HasAFilterTheEmulatorUnderstands_SoANewKindIsNoticedNotIgnored()
    {
        var env = new DemoTestEnv(Clock);
        await using var db = env.AdminDb();
        var indexes = db.Model.GetEntityTypes().SelectMany(t => t.GetIndexes()).Where(i => i.IsUnique).ToList();
        Assert.True(indexes.Count > 30, $"only {indexes.Count} unique indexes");

        foreach (var index in indexes)
        {
            // A row of defaults must be classified (held or not) without the emulator giving up on the filter.
            var key = UniqueIndexEmulator.IndexKey(index, p => p.ClrType == typeof(string) ? "x" : Nullable.GetUnderlyingType(p.ClrType) is not null ? null : p.ClrType.IsValueType ? Activator.CreateInstance(p.ClrType) : null);
            Assert.True(key is null or { Length: >= 0 }, UniqueIndexEmulator.NameOf(index));
        }
        Assert.Contains(indexes, i => UniqueIndexEmulator.NameOf(i) == HandoverAcknowledgement.UniqueReaderIndexName);
        Assert.Contains(indexes, i => UniqueIndexEmulator.NameOf(i) == "IX_CaregiverProfileSubmissions_ParticipantId_Active");        // the IN (0, 1) one
    }
}
