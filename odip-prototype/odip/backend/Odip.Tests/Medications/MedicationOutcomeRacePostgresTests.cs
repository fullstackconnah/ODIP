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

    private async Task<(Guid TenantId, Guid DoseId)> Seed(
        MedicationType type = MedicationType.Prn, string? outcome = null, MedicationAdministrationStatus status = MedicationAdministrationStatus.Administered)
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
                Status = status, AdministeredAt = Original, RecordedByName = "Synthetic staff",
                PrnOutcome = outcome, PrnOutcomeAt = null, CreatedAt = Original, UpdatedAt = Original,
            };
            db.AddRange(participant, med, dose);
            await db.SaveChangesAsync();
            return (tenantId, dose.Id);
        }
    }

    // Pauses the request on its second read of the dose, which is the reload inside the lock: it holds the advisory lock, has seen no outcome,
    // and has not saved. A second writer that reaches the lock now must wait for it (or give up), whatever it read first.
    private sealed class PauseOnReload : DbCommandInterceptor
    {
        private int reads;
        public TaskCompletionSource Paused { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData data, DbDataReader result, CancellationToken ct = default)
        {
            if (command.CommandText.Contains("MedicationAdministrations", StringComparison.Ordinal) && Interlocked.Increment(ref reads) == 2)
            {
                Paused.TrySetResult();
                await Release.Task.WaitAsync(ct);
            }
            return result;
        }
    }

    // Without pg_advisory_xact_lock the second request does not wait: it reloads the same empty outcome and saves over the first.
    // Without the reload it waits, then saves from the empty outcome it read before the first committed. Either way this test fails.
    [SkippableTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_second_outcome_waits_on_the_lock_then_is_refused_by_the_reload(bool firstIsAmend)
    {
        var (tenantId, doseId) = await Seed();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var ct = deadline.Token;
        var pause = new PauseOnReload();
        await using var first = Request(tenantId, pause);
        await using var second = Request(tenantId);
        var firstCall = firstIsAmend
            ? new MedicationsController(first, Tenant(tenantId)).UpdateAdministration(doseId, Amend("Coordinator winner", Original.AddMinutes(30)), ct)
            : new MedicationsController(first, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "First winner" }, ct);
        Task<ActionResult<ApiResponse<AdministrationDto>>>? secondCall = null;
        try
        {
            await pause.Paused.Task.WaitAsync(ct);
            secondCall = new MedicationsController(second, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Second writer" }, ct);
            await Task.Delay(1500, ct);
            Assert.False(secondCall.IsCompleted, "the second write must be blocked on the advisory lock while the first holds it");
        }
        finally
        {
            pause.Release.TrySetResult();
        }
        Assert.IsType<OkObjectResult>((await firstCall.WaitAsync(ct)).Result);
        var refused = Assert.IsType<ConflictObjectResult>((await secondCall!.WaitAsync(ct)).Result);
        var body = Assert.IsType<ApiResponse<AdministrationDto>>(refused.Value);
        Assert.False(body.Success);
        Assert.Contains(Conflict, body.Errors!);
        Assert.Equal(MedicationErrorCodes.PrnOutcomeAlreadyRecorded, body.Code);
        await using var verify = Request(tenantId);
        var stored = await verify.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId, ct);
        Assert.Equal(firstIsAmend ? "Coordinator winner" : "First winner", stored.PrnOutcome);
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

    [SkippableFact]
    public async Task A_write_that_cannot_get_the_lock_in_time_answers_busy_and_writes_nothing()
    {
        var (tenantId, doseId) = await Seed();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var ct = deadline.Token;
        var pause = new PauseOnReload();
        await using var holder = Request(tenantId, pause);
        await using var waiter = Request(tenantId);
        var holderCall = new MedicationsController(holder, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Holder" }, ct);
        ActionResult<ApiResponse<AdministrationDto>> timedOut;
        try
        {
            await pause.Paused.Task.WaitAsync(ct);
            timedOut = await new MedicationsController(waiter, Tenant(tenantId)) { OutcomeLockWait = TimeSpan.FromMilliseconds(300) }
                .RecordOutcome(doseId, new() { PrnOutcome = "Waiter" }, ct);
        }
        finally
        {
            pause.Release.TrySetResult();
        }
        var busy = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<ConflictObjectResult>(timedOut.Result).Value);
        Assert.Equal(MedicationErrorCodes.AdministrationSlotBusy, busy.Code);
        Assert.Contains("Another person is saving this dose right now. Check the dose, then try again.", busy.Errors!);
        Assert.Null(waiter.Database.CurrentTransaction);
        Assert.IsType<OkObjectResult>((await holderCall.WaitAsync(ct)).Result);
        await using var verify = Request(tenantId);
        Assert.Equal("Holder", (await verify.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId, ct)).PrnOutcome);
        Assert.Equal(1, await verify.AuditLogs.CountAsync(a => a.EntityId == doseId, ct));
    }

    [SkippableFact]
    public async Task An_amend_that_sends_no_outcome_keeps_the_outcome_another_user_recorded()
    {
        var (tenantId, doseId) = await Seed();
        await using var request = Request(tenantId);
        Assert.IsType<OkObjectResult>((await new MedicationsController(request, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Settled within 20 minutes" }, CancellationToken.None)).Result);
        await using var recorded = Request(tenantId);
        var before = await recorded.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId);
        Assert.NotNull(before.PrnOutcomeAt);
        // A client holding the copy from before the outcome sends no outcome fields at all.
        var stale = new UpdateAdministrationDto { Status = MedicationAdministrationStatus.Administered, AdministeredAt = Original, Notes = "Corrected note" };
        await using var amend = Request(tenantId);
        Assert.IsType<OkObjectResult>((await new MedicationsController(amend, Tenant(tenantId)).UpdateAdministration(doseId, stale, CancellationToken.None)).Result);
        await using var verify = Request(tenantId);
        var after = await verify.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId);
        Assert.Equal("Settled within 20 minutes", after.PrnOutcome);
        Assert.Equal(before.PrnOutcomeAt, after.PrnOutcomeAt);
        Assert.Equal("Corrected note", after.Notes);
    }

    [SkippableTheory]
    [InlineData(MedicationAdministrationStatus.Refused)]
    [InlineData(MedicationAdministrationStatus.Missed)]
    [InlineData(MedicationAdministrationStatus.WrongMedication)]
    public async Task An_outcome_on_a_PRN_record_that_was_never_given_is_refused(MedicationAdministrationStatus status)
    {
        var (tenantId, doseId) = await Seed(status: status);
        await using var request = Request(tenantId);
        var result = await new MedicationsController(request, Tenant(tenantId)).RecordOutcome(doseId, new() { PrnOutcome = "Should not be saved" }, CancellationToken.None);
        var refused = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Contains("Outcomes can only be recorded on a PRN dose that was given.", refused.Errors!);
        var stored = await request.MedicationAdministrations.AsNoTracking().SingleAsync(a => a.Id == doseId);
        Assert.Null(stored.PrnOutcome);
        Assert.Null(stored.PrnOutcomeAt);
        Assert.Equal(Original, stored.UpdatedAt);
        Assert.Equal(0, await request.AuditLogs.CountAsync(a => a.EntityId == doseId));
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
