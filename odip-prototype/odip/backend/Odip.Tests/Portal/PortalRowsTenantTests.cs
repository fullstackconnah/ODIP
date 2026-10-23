using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// Rows a worker portal call creates for a shift belong to the shift's organisation. A SuperAdmin viewing as no organisation has no current tenant, so the
/// context's auto-stamp used to leave them with an empty TenantId (invisible to the organisation) and the follow-up task's due date on the default zone.
/// </summary>
public class PortalRowsTenantTests
{
    private static readonly Guid WaOrg = Guid.Parse("7a000000-0000-0000-0000-000000000001");

    /// <summary>A Published shift of a WA organisation; the caller is a SuperAdmin with no organisation selected. 15:00 UTC is 23:00 on the 14th in Perth but already the 15th in Sydney.</summary>
    private static async Task<ShiftPackageFixture> UnscopedFixture()
    {
        var f = Create(ShiftStatus.Published, now: new DateTimeOffset(2026, 7, 14, 15, 0, 0, TimeSpan.Zero), tenantId: WaOrg);
        (await f.Db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).State = "WA";
        await f.Db.SaveChangesAsync();
        f.Tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        f.Tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return f;
    }

    [Fact]
    public async Task CreateNote_UnscopedSuperAdmin_SavesTheNoteInTheShiftsOrganisation()
    {
        var f = await UnscopedFixture();

        await f.Controller.CreateShiftNote(f.Shift.Id, new CreateShiftNoteDto { Body = "Quiet shift, no concerns." }, default);

        Assert.Equal(WaOrg, (await f.Db.ShiftNotes.IgnoreQueryFilters().SingleAsync()).TenantId);
    }

    [Fact]
    public async Task CreateFlaggedNote_UnscopedSuperAdmin_RaisesTheTaskInTheShiftsOrganisationDueTomorrowInItsZone()
    {
        var f = await UnscopedFixture();

        await f.Controller.CreateShiftNote(f.Shift.Id, new CreateShiftNoteDto { Body = "She had a fall near the bathroom this morning." }, default);

        var task = await f.Db.BookingTasks.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(WaOrg, task.TenantId);
        Assert.Equal((DateOnly?)new DateOnly(2026, 7, 15), task.DueDate);
        Assert.Equal(WaOrg, (await f.Db.ShiftNotes.IgnoreQueryFilters().SingleAsync()).TenantId);
    }
}
