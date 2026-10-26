using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class UpcomingShiftsUndoTests
{
    private static async Task<(OdipDbContext Db, Guid TenantId, Guid BatchId, Guid StaffId, List<Shift> Shifts)> ImportFour()
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" });
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Mia", LastName = "Test", NdisNumber = "430000001", IsActive = true });
        var staff = db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Ng", Username = Guid.NewGuid().ToString(), Email = "sam@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        }).Entity;
        await db.SaveChangesAsync();
        var today = await ProviderTimeZoneResolver.TodayAsync(db, TimeProvider.System, CancellationToken.None);
        var result = await Service(db, tenantId).CommitAsync(ImportKind.UpcomingShifts,
            Csv("NDIS number,Weekday,Start time,End time", $"430000001,{today.DayOfWeek},9:00 am,3:00 pm"), "shifts.csv", null, null, "undo", Admin(), CancellationToken.None,
            new ImportShiftOptions(ImportShiftShape.Pattern, today, 4));
        return (db, tenantId, result.BatchId, staff.Id, await db.Shifts.OrderBy(s => s.ServiceDate).ToListAsync());
    }

    private static Task<ImportUndoOutcome> Undo(OdipDbContext db, Guid tenantId, Guid batchId) => Service(db, tenantId).UndoAsync(batchId, Admin(), CancellationToken.None);

    [Fact]
    public async Task Undo_removes_untouched_drafts_and_keeps_published_edited_and_referenced_shifts()
    {
        var (db, tenantId, batchId, staffId, shifts) = await ImportFour();
        using var _ = db;
        shifts[0].Status = ShiftStatus.Published;
        shifts[0].UpdatedAt = shifts[0].CreatedAt.AddMinutes(1);
        shifts[1].Notes = "edited";
        shifts[1].UpdatedAt = shifts[1].CreatedAt.AddMinutes(1);
        db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shifts[2].Id, AuthorUserId = staffId, AuthorName = "Sam Ng" });
        await db.SaveChangesAsync();

        var outcome = await Undo(db, tenantId, batchId);

        Assert.Equal(3, outcome.Batch!.KeptCount);
        Assert.NotNull(outcome.Batch.UndoneAt);
        Assert.Equal(shifts.Take(3).Select(s => s.Id).Order(), (await db.Shifts.Select(s => s.Id).ToListAsync()).Order());
    }

    [Fact]
    public async Task Undo_of_an_import_nothing_of_which_is_left_untouched_is_a_409_and_the_batch_stays()
    {
        var (db, tenantId, batchId, _, shifts) = await ImportFour();
        using var _ = db;
        foreach (var s in shifts) { s.Status = ShiftStatus.Published; s.UpdatedAt = s.CreatedAt.AddMinutes(1); }
        await db.SaveChangesAsync();

        var ex = await Assert.ThrowsAsync<ImportException>(() => Undo(db, tenantId, batchId));

        Assert.Equal((OnboardingImportService.NothingToUndo, 409), (ex.Message, ex.StatusCode));
        Assert.Null((await db.ImportBatches.SingleAsync()).UndoneAt);
        Assert.Equal(4, await db.Shifts.CountAsync());
    }

    [Fact]
    public async Task Undo_of_a_clean_import_removes_every_shift_and_keeps_none()
    {
        var (db, tenantId, batchId, _, _) = await ImportFour();
        using var _ = db;
        var outcome = await Undo(db, tenantId, batchId);
        Assert.Equal(0, outcome.Batch!.KeptCount);
        Assert.Equal(0, await db.Shifts.CountAsync());
    }
}
