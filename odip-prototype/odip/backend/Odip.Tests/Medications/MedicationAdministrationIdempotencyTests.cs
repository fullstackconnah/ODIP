using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// "One record per dose slot" (D3): a filtered unique IdempotencyKey makes a double tap / retry safe, and an
/// APPLICATION rule stops a second record for the same (medication, ScheduledAt). There is deliberately NO unique
/// index on (medication, ScheduledAt): existing data may already hold duplicates per slot and the deploy
/// migration would fail.
/// </summary>
public class MedicationAdministrationIdempotencyTests
{
    private static readonly DateTime Slot = new(2026, 7, 14, 8, 0, 0, DateTimeKind.Unspecified);

    private sealed class Fixture
    {
        public required OdipDbContext Db { get; init; }
        public required MedicationsController Controller { get; init; }
        public required Guid MedId { get; init; }
        public required Guid OtherMedId { get; init; }
        public required Guid PrnMedId { get; init; }
        public required Guid ParticipantId { get; init; }
    }

    private static Fixture Arrange(string? dbName = null, SaveChangesInterceptor? interceptor = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var builder = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName ?? Guid.NewGuid().ToString());
        if (interceptor != null) builder.AddInterceptors(interceptor);
        var db = new OdipDbContext(builder.Options, tenant.Object);

        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        ParticipantMedication Med(string name, MedicationType type = MedicationType.Regular) => new()
        {
            Id = Guid.NewGuid(), ParticipantId = p.Id, Name = name, DoseDescription = "1 tablet", Type = type,
            TimesOfDay = type == MedicationType.Regular ? "08:00" : null, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 10 : null,
        };
        var med = Med("Levetiracetam");
        var other = Med("Melatonin");
        var prn = Med("Paracetamol", MedicationType.Prn);
        db.Participants.Add(p);
        db.ParticipantMedications.AddRange(med, other, prn);
        var recorder = MedicationTestIdentities.SeedCompetentUser(db);
        tenant.Setup(t => t.ViewAsUserId).Returns(recorder.Id);
        db.SaveChanges();

        return new Fixture
        {
            Db = db, Controller = new MedicationsController(db, tenant.Object), MedId = med.Id, OtherMedId = other.Id,
            PrnMedId = prn.Id, ParticipantId = p.Id,
        };
    }

    private static CreateAdministrationDto Dose(DateTime? scheduledAt, string? key = null,
        MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered) => new()
    {
        Status = status, ScheduledAt = scheduledAt, IdempotencyKey = key, DoseGiven = "1 tablet",
        Reason = status == MedicationAdministrationStatus.Administered ? null : "Participant declined",
    };

    private static ApiResponse<AdministrationDto> Body(ActionResult<ApiResponse<AdministrationDto>> r) =>
        Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value);

    // ── idempotency key ────────────────────────────────────────────────

    [Fact]
    public async Task ADoubleTap_WithTheSameKey_ReturnsTheFirstRecord_AndCreatesOnlyOne()
    {
        var f = Arrange();

        var first = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-1"), default);
        var second = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-1"), default);

        Assert.IsType<OkObjectResult>(first.Result);
        Assert.IsType<OkObjectResult>(second.Result);
        Assert.Equal(Body(first).Data!.Id, Body(second).Data!.Id);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task TheSameKey_ForADifferentMedication_IsRejected()
    {
        var f = Arrange();
        await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-1"), default);

        var result = await f.Controller.RecordAdministration(f.OtherMedId, Dose(Slot, "key-1"), default);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(MedicationErrorCodes.AdministrationIdempotencyKeyReused, Body(result).Code);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task ABlankKey_IsTreatedAsNoKey_SoTwoBlankKeyedPrnDosesAreBothRecorded()
    {
        var f = Arrange();
        var prnDose = new CreateAdministrationDto
        {
            Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache", IdempotencyKey = "   ",
        };

        await f.Controller.RecordAdministration(f.PrnMedId, prnDose, default);
        await f.Controller.RecordAdministration(f.PrnMedId, prnDose with { AcknowledgeLimitBreach = true }, default);

        var saved = await f.Db.MedicationAdministrations.ToListAsync();
        Assert.Equal(2, saved.Count);
        Assert.All(saved, a => Assert.Null(a.IdempotencyKey));
    }

    [Fact]
    public async Task TheKey_IsTrimmed_AndStoredOnTheRecord()
    {
        var f = Arrange();

        await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "  key-1  "), default);

        Assert.Equal("key-1", (await f.Db.MedicationAdministrations.SingleAsync()).IdempotencyKey);
    }

    [Fact]
    public async Task ARacingSubmit_RejectedByTheUniqueIndex_ReturnsTheWinner_NotA500()
    {
        // Simulates the window between the replay check and the insert: a concurrent request with the same key
        // commits first, so this request's INSERT is rejected by the filtered unique index (Postgres 23505).
        var dbName = Guid.NewGuid().ToString();
        Guid winnerId = Guid.Empty;
        Fixture? f = null;
        var interceptor = new RaceInterceptor(async () =>
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.IsSuperAdmin).Returns(true);
            using var other = new OdipDbContext(
                new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(dbName).Options, tenant.Object);
            winnerId = Guid.NewGuid();
            other.MedicationAdministrations.Add(new MedicationAdministration
            {
                Id = winnerId, ParticipantMedicationId = f!.MedId, ParticipantId = f.ParticipantId, ScheduledAt = Slot,
                Status = MedicationAdministrationStatus.Administered, RecordedByName = "Winner", IdempotencyKey = "key-race",
            });
            await other.SaveChangesAsync();
        });
        f = Arrange(dbName, interceptor);
        interceptor.Armed = true;

        var result = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-race"), default);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(winnerId, Body(result).Data!.Id);
        Assert.Equal("Winner", Body(result).Data!.RecordedByName);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    private sealed class RaceInterceptor(Func<Task> beforeThrow) : SaveChangesInterceptor
    {
        public bool Armed { get; set; }
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!Armed || _fired) return result;
            _fired = true;
            await beforeThrow();
            throw new DbUpdateException("duplicate key value violates unique constraint", new PostgresException(
                messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: "23505", constraintName: MedicationAdministration.IdempotencyIndexName));
        }
    }

    // ── one record per scheduled slot (application rule) ───────────────

    [Fact]
    public async Task ASecondRecord_ForTheSameScheduledSlot_WithADifferentKey_Is409WithTheExistingRecord()
    {
        var f = Arrange();
        var first = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-1"), default);

        var second = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "key-2", MedicationAdministrationStatus.Refused), default);

        var conflict = Assert.IsType<ConflictObjectResult>(second.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(conflict.Value);
        Assert.False(body.Success);
        Assert.Equal(MedicationErrorCodes.AdministrationAlreadyRecorded, body.Code);
        Assert.Equal(Body(first).Data!.Id, body.Data!.Id);          // the EXISTING record rides along as data
        Assert.Equal(MedicationAdministrationStatus.Administered, body.Data.Status);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task ASecondRecord_WithNoKeyAtAll_IsAlsoBlocked_SoTheExistingUiCannotDoubleRecord()
    {
        var f = Arrange();
        await f.Controller.RecordAdministration(f.MedId, Dose(Slot), default);

        var second = await f.Controller.RecordAdministration(f.MedId, Dose(Slot), default);

        Assert.IsType<ConflictObjectResult>(second.Result);
        Assert.Single(await f.Db.MedicationAdministrations.ToListAsync());
    }

    [Fact]
    public async Task EveryStatusCountsAsTheSlotsRecord_ARefusalBlocksAnotherNotGivenOutcome_ButYieldsToALaterAdministeredOne()
    {
        // One ACTIVE record per slot. A Refused (or Missed) record is the one kind that can be replaced - by an Administered record, kept as
        // history (MedicationSupersedeTests covers the detail); every other combination is still the 409.
        var f = Arrange();
        await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k1", MedicationAdministrationStatus.Refused), default);

        var anotherNotGiven = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k2", MedicationAdministrationStatus.Missed), default);
        var given = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k3"), default);

        Assert.IsType<ConflictObjectResult>(anotherNotGiven.Result);
        Assert.IsType<OkObjectResult>(given.Result);
    }

    [Fact]
    public async Task AnAdministeredRecord_BlocksEveryOtherOutcomeForTheSameSlot()
    {
        var f = Arrange();
        await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k1"), default);

        var refused = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k2", MedicationAdministrationStatus.Refused), default);
        var again = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k3"), default);

        Assert.IsType<ConflictObjectResult>(refused.Result);
        Assert.IsType<ConflictObjectResult>(again.Result);
    }

    [Fact]
    public async Task DifferentSlots_AndDifferentMedications_AreIndependent()
    {
        var f = Arrange();

        var a = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "a"), default);
        var b = await f.Controller.RecordAdministration(f.MedId, Dose(Slot.AddHours(12), "b"), default);
        var c = await f.Controller.RecordAdministration(f.OtherMedId, Dose(Slot, "c"), default);

        Assert.All(new[] { a, b, c }, r => Assert.IsType<OkObjectResult>(r.Result));
        Assert.Equal(3, (await f.Db.MedicationAdministrations.ToListAsync()).Count);
    }

    [Fact]
    public async Task APrnDose_HasNoSlot_SoTheSlotRuleNeverApplies()
    {
        var f = Arrange();
        var dose = new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, PrnReason = "Headache" };

        await f.Controller.RecordAdministration(f.PrnMedId, dose, default);
        var second = await f.Controller.RecordAdministration(f.PrnMedId, dose with { AcknowledgeLimitBreach = true }, default);

        Assert.IsType<OkObjectResult>(second.Result);
        Assert.Equal(2, (await f.Db.MedicationAdministrations.ToListAsync()).Count);
    }

    [Fact]
    public async Task LegacyDuplicatesForASlot_AreNotAnError_AndTheNewestIsReturnedOn409()
    {
        // Existing data may already hold duplicates for a slot (nothing ever prevented it) — the rule only stops
        // NEW ones, and must never throw over the old ones.
        var f = Arrange();
        f.Db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = f.MedId, ParticipantId = f.ParticipantId, ScheduledAt = Slot,
                Status = MedicationAdministrationStatus.Refused, Reason = "x", RecordedByName = "Old", CreatedAt = new DateTime(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc),
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = f.MedId, ParticipantId = f.ParticipantId, ScheduledAt = Slot,
                Status = MedicationAdministrationStatus.Administered, RecordedByName = "New", CreatedAt = new DateTime(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc),
            });
        await f.Db.SaveChangesAsync();

        var result = await f.Controller.RecordAdministration(f.MedId, Dose(Slot, "k"), default);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal("New", Assert.IsType<ApiResponse<AdministrationDto>>(conflict.Value).Data!.RecordedByName);
        Assert.Equal(2, (await f.Db.MedicationAdministrations.ToListAsync()).Count);
    }

    // ── deploy safety: what the schema does and does not enforce ──────────

    [Fact]
    public void Model_HasAFilteredUniqueIdempotencyIndex_AndNoUniqueIndexOnTheSlot()
    {
        var f = Arrange();
        var entity = f.Db.Model.FindEntityType(typeof(MedicationAdministration))!;

        var idempotency = Assert.Single(entity.GetIndexes(), i => i.GetDatabaseName() == MedicationAdministration.IdempotencyIndexName);
        Assert.True(idempotency.IsUnique);
        Assert.Equal(new[] { "TenantId", "IdempotencyKey" }, idempotency.Properties.Select(p => p.Name));
        Assert.Equal("\"IdempotencyKey\" IS NOT NULL", idempotency.GetFilter());

        // The regression this guards: a unique index over ScheduledAt would fail the deploy migration wherever
        // existing data holds a duplicate slot.
        Assert.DoesNotContain(entity.GetIndexes(), i => i.IsUnique && i.Properties.Any(p => p.Name == "ScheduledAt"));
    }

    [Fact]
    public void TheMigration_AddsANullableColumn_AndAFilteredUniqueIndex_Only()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln"))) dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        Assert.NotNull(dir);
        var migration = Directory.GetFiles(Path.Combine(dir!, "Odip.Infrastructure", "Migrations"), "*_AddMedicationAdministrationIdempotencyKey.cs").Single();
        var source = File.ReadAllText(migration);

        Assert.Contains($"\"{MedicationAdministration.IdempotencyIndexName}\"", source);
        Assert.Contains("filter: \"\\\"IdempotencyKey\\\" IS NOT NULL\"", source);
        Assert.Matches(new Regex(@"AddColumn<string>\(\s*name: ""IdempotencyKey"",[\s\S]*?nullable: true"), source);
        Assert.DoesNotContain("ScheduledAt", source);
        Assert.DoesNotContain("Sql(", source);
    }

    [Fact]
    public void TheIndexName_IsNotDuplicatedAsARawLiteralInTheRecorderOrContext()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln"))) dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        foreach (var relative in new[] { "Odip.Infrastructure/Data/OdipDbContext.cs", "Odip.Infrastructure/Services/MedicationAdministrationRecorder.cs" })
            Assert.DoesNotContain($"\"{MedicationAdministration.IdempotencyIndexName}\"", File.ReadAllText(Path.Combine(dir!, relative)));
    }
}
