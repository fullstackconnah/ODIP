using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>Editing or deleting a claim whose lines are in an NDIA file (G4, G5, S6).</summary>
public class ClaimEditFileGuardTests
{
    internal static ClaimsController ControllerFor(OdipDbContext db, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new ClaimsController(db, new ClaimGenerationService(db), new ShiftClaimGenerationService(db), new BprCsvService(db), new InvoiceService(db), new BudgetLedgerService(db, TimeProvider.System), tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test")) } },
        };
    }

    private static int Status(ActionResult<ApiResponse<bool>> r) => Assert.IsAssignableFrom<ObjectResult>(r.Result).StatusCode ?? 200;
    private static string Message(ActionResult<ApiResponse<bool>> r) => Assert.Single(Assert.IsType<ApiResponse<bool>>(Assert.IsAssignableFrom<ObjectResult>(r.Result).Value).Errors!);

    private static Task<ActionResult<ApiResponse<bool>>> Patch(BatchFixture f, TripClaim claim, ClaimLineItem line, UpdateClaimLineItemDto dto) =>
        ControllerFor(f.Db, f.TenantId).UpdateLineItem(claim.Id, line.Id, dto, default);

    [Fact]
    public async Task A_field_edit_is_refused_while_the_line_is_in_a_built_file_and_allowed_after_a_discard()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);

        var refused = await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { Hours = 3m });

        Assert.Equal(409, Status(refused));
        Assert.Equal($"This line is in {built.Value!.FileName}. Discard that file before changing it.", Message(refused));
        await f.Service.DiscardAsync(f.TenantId, f.User, built.Value.Id, default);
        Assert.Equal(200, Status(await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { Hours = 3m })));
    }

    [Fact]
    public async Task A_field_edit_is_refused_while_the_line_is_in_an_uploaded_file()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value!.Id, default);

        Assert.Equal(409, Status(await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { UnitPrice = 10m })));
    }

    [Theory]
    [InlineData(ClaimLineItemStatus.Rejected)]
    [InlineData(ClaimLineItemStatus.Paid)]
    public async Task Recording_a_result_by_hand_is_refused_while_built_and_allowed_once_uploaded(ClaimLineItemStatus status)
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);

        var whileBuilt = await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { Status = status });
        Assert.Equal(409, Status(whileBuilt));
        Assert.Contains(built.Value!.FileName, Message(whileBuilt));

        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value.Id, default);
        Assert.Equal(200, Status(await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { Status = status })));
    }

    [Fact]
    public async Task A_rejected_line_on_a_submitted_claim_can_be_corrected_but_an_accepted_one_cannot()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(2, status: TripClaimStatus.Submitted, lineStatus: ClaimLineItemStatus.Approved);
        lines[0].Status = ClaimLineItemStatus.Rejected;
        await f.Db.SaveChangesAsync();

        Assert.Equal(200, Status(await Patch(f, claim, lines[0], new UpdateClaimLineItemDto { Hours = 3m })));
        Assert.Equal(409, Status(await Patch(f, claim, lines[1], new UpdateClaimLineItemDto { Hours = 3m })));
        Assert.Equal(3m, (await f.Db.ClaimLineItems.FindAsync(lines[0].Id))!.Hours);
    }

    [Fact]
    public async Task A_claim_in_a_live_file_cannot_be_deleted()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        var controller = ControllerFor(f.Db, f.TenantId);

        var refused = await controller.DeleteClaim(claim.Id, default);

        Assert.Equal(409, Status(refused));
        Assert.Equal($"This claim is in {built.Value!.FileName}. Discard that file first.", Message(refused));
        await f.Service.DiscardAsync(f.TenantId, f.User, built.Value.Id, default);
        Assert.Equal(200, Status(await controller.DeleteClaim(claim.Id, default)));
    }

    private static Task<ActionResult<ApiResponse<bool>>> Put(BatchFixture f, TripClaim claim, TripClaimStatus status) =>
        ControllerFor(f.Db, f.TenantId).UpdateClaim(claim.Id, new UpdateClaimDto { Status = status }, default);

    [Fact]
    public async Task A_status_change_is_refused_while_the_claim_is_in_a_built_file()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);

        var refused = await Put(f, claim, TripClaimStatus.Submitted);

        Assert.Equal(409, Status(refused));
        Assert.Equal($"This claim is in {built.Value!.FileName}. Discard that file first.", Message(refused));
        Assert.Equal(TripClaimStatus.Draft, (await f.Db.TripClaims.FindAsync(claim.Id))!.Status);
        Assert.Empty(await f.Db.Invoices.ToListAsync());
    }

    [Fact]
    public async Task A_claim_in_an_uploaded_file_can_still_be_marked_paid_by_hand()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim();
        var built = await f.BuildAsync(lines[0].Id);
        await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value!.Id, default);

        Assert.Equal(200, Status(await Put(f, claim, TripClaimStatus.Paid)));
        Assert.Equal(TripClaimStatus.Paid, (await f.Db.TripClaims.FindAsync(claim.Id))!.Status);
    }

    [Fact]
    public async Task A_hand_rejection_is_refused_while_the_file_is_built_and_the_confirm_then_works_on_the_untouched_claim()
    {
        using var f = new BatchFixture();
        var (claim, lines, _) = f.AddClaim(status: TripClaimStatus.Submitted, lineStatus: ClaimLineItemStatus.Rejected);
        var built = await f.BuildAsync(lines[0].Id);
        Assert.True(built.Ok, string.Join("; ", built.Errors ?? []));

        var refused = await Put(f, claim, TripClaimStatus.Rejected);

        Assert.Equal(409, Status(refused));
        Assert.Contains(built.Value!.FileName, Message(refused));
        Assert.Equal(TripClaimStatus.Submitted, (await f.Db.TripClaims.FindAsync(claim.Id))!.Status);
        var up = await f.Service.ConfirmUploadedAsync(f.TenantId, f.User, built.Value.Id, default);
        Assert.True(up.Ok, string.Join("; ", up.Errors ?? []));
        Assert.Equal(TripClaimStatus.Submitted, (await f.Db.TripClaims.FindAsync(claim.Id))!.Status);
        Assert.Equal(ClaimLineItemStatus.Submitted, (await f.Db.ClaimLineItems.FindAsync(lines[0].Id))!.Status);
    }

    [Fact]
    public async Task The_per_claim_csv_route_serves_the_stored_file()
    {
        using var f = new BatchFixture();
        var (claim, _, _) = f.AddClaim();
        var result = await ControllerFor(f.Db, f.TenantId).DownloadBprCsv(claim.Id, f.Service, default);
        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal((await f.Db.ClaimBatches.SingleAsync()).Content, file.FileContents);
    }
}
