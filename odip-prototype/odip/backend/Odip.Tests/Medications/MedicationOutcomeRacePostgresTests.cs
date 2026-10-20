using System.Data.Common;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Medications;

public class MedicationOutcomeRacePostgresTests(PostgresFixture pg) : IClassFixture<PostgresFixture>
{
    private static readonly DateTime Original = new(2026, 10, 10, 1, 0, 0, DateTimeKind.Utc);
    private const string Conflict = "An outcome is already recorded for this dose.";

    private static ICurrentTenant Tenant(Guid id)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(id);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private OdipDbContext Request(Guid tenantId, params IInterceptor[] interceptors) => new(
        new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(pg.ConnectionString)
            .AddInterceptors(new IInterceptor[] { new AuditInterceptor(new HttpContextAccessor()) }.Concat(interceptors)).Options,
        Tenant(tenantId));

    private async Task<(Guid TenantId, Guid DoseId)> Seed(MedicationType type = MedicationType.Prn, string? outcome = null)
    {
        Skip.IfNot(pg.Available, "PostgreSQL required; a skip is not race proof.");
        var (db, tenantId) = await pg.NewTenantContextAsync();
        await using (db)
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Synthetic", LastName = "Race", IsActive = true };
            var med = new ParticipantMedication
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Name = "Synthetic medication", DoseDescription = "1 tablet",
                Type = type, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
            };
            var dose = new MedicationAdministration
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ParticipantMedicationId = med.Id,
                Status = MedicationAdministrationStatus.Administered, AdministeredAt = Original, RecordedByName = "Synthetic staff",
                PrnOutcome = outcome, PrnOutcomeAt = null, CreatedAt = Original, UpdatedAt = Original,
            };
            db.AddRange(participant, med, dose);
            await db.SaveChangesAsync();
            return (tenantId, dose.Id);
        }
    }

    // The initial SELECT has a PostgreSQL snapshot but has not materialized into EF yet. No exclusive lock is held here.
    private sealed class PauseInitialRead : DbCommandInterceptor
    {
        private int used;
        public TaskCompletionSource Read { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData data, DbDataReader result, CancellationToken ct = default)
        {
            if (command.CommandText.Contains("MedicationAdministrations", StringComparison.Ordinal) && Interlocked.Exchange(ref used, 1) == 0)
            {
                Read.TrySetResult();
                await Release.Task.WaitAsync(ct);
            }
            return result;
        }
    }

    [SkippableTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_stale_first_outcome_cannot_replace_the_winner_or_a_coordinator_amendment(bool amendWins)
    {
        var (tenantId, doseId) = await Seed();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var ct = deadline.Token;
        var pause = new PauseInitialRead();
        await using var stale = Request(tenantId, pause);
        await using var winner = Request(tenantId);
        var pending = new MedicationsController(stale, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Stale overwrite" }, ct);
        ActionResult<ApiResponse<AdministrationDto>>? loser = null;
        MedicationAdministration? committed = null;
        try
        {
            await pause.Read.Task.WaitAsync(ct);
            var controller = new MedicationsController(winner, Tenant(tenantId));
            var result = amendWins
                ? await controller.UpdateAdministration(doseId, Amend("Coordinator winner", Original.AddMinutes(30)), ct)
                : await controller.RecordOutcome(doseId, new() { PrnOutcome = "First winner" }, ct);
            Assert.IsType<OkObjectResult>(result.Result);
            await using var readWinner = Request(tenantId);
            committed = await readWinner.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId, ct);
        }
        finally
        {
            pause.Release.TrySetResult();
            loser = await pending.WaitAsync(ct);
        }
        var refused = Assert.IsType<ConflictObjectResult>(loser.Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(refused.Value);
        Assert.False(body.Success);
        Assert.Contains(Conflict, body.Errors!);
        await using var verify = Request(tenantId);
        var stored = await verify.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId, ct);
        Assert.Equal(amendWins ? "Coordinator winner" : "First winner", stored.PrnOutcome);
        Assert.Equal(committed!.PrnOutcomeAt, stored.PrnOutcomeAt);
        Assert.Equal(committed.UpdatedAt, stored.UpdatedAt);
        Assert.NotNull(stored.PrnOutcomeAt);
        var retry = await new MedicationsController(verify, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Fresh retry" }, ct);
        Assert.IsType<ConflictObjectResult>(retry.Result);
        Assert.Equal(1, await verify.AuditLogs.CountAsync(a => a.EntityId == doseId, ct));
        verify.ChangeTracker.Clear();
        var afterRetry = await verify.MedicationAdministrations.SingleAsync(a => a.Id == doseId, ct);
        Assert.Equal(stored.PrnOutcome, afterRetry.PrnOutcome);
        Assert.Equal(stored.PrnOutcomeAt, afterRetry.PrnOutcomeAt);
        Assert.Equal(stored.UpdatedAt, afterRetry.UpdatedAt);
        // Amend deliberately remains a correction, even after an outcome already exists.
        Assert.IsType<OkObjectResult>((await new MedicationsController(verify, Tenant(tenantId)).UpdateAdministration(doseId, Amend("Intentional correction", Original.AddHours(1)), ct)).Result);
        await using var final = Request(tenantId);
        Assert.Equal("Intentional correction", (await final.MedicationAdministrations.SingleAsync(a => a.Id == doseId, ct)).PrnOutcome);
    }

    private static UpdateAdministrationDto Amend(string outcome, DateTime at) => new()
    {
        Status = MedicationAdministrationStatus.Administered, AdministeredAt = Original,
        PrnOutcome = outcome, PrnOutcomeAt = at,
    };

    [SkippableFact]
    public async Task Whitespace_is_still_absent_and_a_borrowed_transaction_is_not_committed()
    {
        var (tenantId, doseId) = await Seed(outcome: " \t\r\n\u2003");
        await using var request = Request(tenantId);
        await using (var transaction = await request.Database.BeginTransactionAsync())
        {
            Assert.IsType<OkObjectResult>((await new MedicationsController(request, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Recorded" }, CancellationToken.None)).Result);
            Assert.Same(transaction, request.Database.CurrentTransaction);
            await transaction.RollbackAsync();
        }
        await using var verify = Request(tenantId);
        var original = await verify.MedicationAdministrations.SingleAsync(a => a.Id == doseId);
        Assert.Equal(" \t\r\n\u2003", original.PrnOutcome);
        Assert.Null(original.PrnOutcomeAt);
        Assert.Equal(Original, original.UpdatedAt);
        Assert.Equal(0, await verify.AuditLogs.CountAsync(a => a.EntityId == doseId));
        Assert.IsType<OkObjectResult>((await new MedicationsController(verify, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "After rollback" }, CancellationToken.None)).Result);
    }

    [SkippableFact]
    public async Task Foreign_tenant_and_regular_dose_refusals_do_not_write()
    {
        var (tenantId, doseId) = await Seed(MedicationType.Regular);
        var (foreign, otherId) = await pg.NewTenantContextAsync();
        await using (foreign)
        {
            var result = await new MedicationsController(foreign, Tenant(otherId)).RecordOutcome(doseId, new() { PrnOutcome = "Foreign" }, CancellationToken.None);
            var body = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<NotFoundObjectResult>(result.Result).Value);
            Assert.False(body.Success);
            Assert.Contains("Administration record not found", body.Errors!);
        }
        await using var own = Request(tenantId);
        var regular = await new MedicationsController(own, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Regular" }, CancellationToken.None);
        var refused = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<BadRequestObjectResult>(regular.Result).Value);
        Assert.Contains("Outcomes can only be recorded on PRN doses.", refused.Errors!);
        var stored = await own.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId);
        Assert.Null(stored.PrnOutcome);
        Assert.Null(stored.PrnOutcomeAt);
        Assert.Equal(Original, stored.UpdatedAt);
        Assert.Equal(0, await own.AuditLogs.CountAsync(a => a.EntityId == doseId));
    }
    private sealed class CancelBeforeSave(CancellationTokenSource source) : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
        {
            source.Cancel();
            return base.SavingChangesAsync(data, result, ct);
        }
    }

    [SkippableFact]
    public async Task Cancellation_rolls_back_outcome_and_audit_and_releases_the_owned_lock()
    {
        var (tenantId, doseId) = await Seed();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        await using var request = Request(tenantId, new CancelBeforeSave(cancellation));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await new MedicationsController(request, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Cancelled" }, cancellation.Token);
        });
        Assert.Null(request.Database.CurrentTransaction);
        await using var verify = Request(tenantId);
        var untouched = await verify.MedicationAdministrations.SingleAsync(a => a.Id == doseId);
        Assert.Null(untouched.PrnOutcome);
        Assert.Null(untouched.PrnOutcomeAt);
        Assert.Equal(Original, untouched.UpdatedAt);
        Assert.Equal(0, await verify.AuditLogs.CountAsync(a => a.EntityId == doseId));
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        Assert.IsType<OkObjectResult>((await new MedicationsController(verify, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "After cancellation" }, deadline.Token)).Result);
    }}
