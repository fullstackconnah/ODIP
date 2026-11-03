using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Moq;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>
/// Everything that reads a claim line must find a manual line's participant on its claim (it has neither shift nor booking): the BPR file, the ledger, the invoice payer, the NDIA rejection reader, the
/// hub's person column, the claim detail, and the guards that must still treat the claim as a manual one.
/// </summary>
public class ManualClaimReadersTests
{
    private static readonly DateOnly Day = new(2026, 10, 1);
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed record Made(LedgerKit Kit, Participant Person, TripClaim Claim, ClaimLineItem Line);

    /// <summary>A manual claim made by the service itself, so the readers see exactly what production writes.</summary>
    private static async Task<Made> MakeAsync(string personState = "NSW", PlanType plan = PlanType.AgencyManaged)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("VIC");
        var item = kit.SeedItem("15_100", 15, price: 100m);
        item.PriceNational = 100m;
        kit.Db.SaveChanges();
        var person = kit.SeedParticipant(planType: plan, addressState: personState);
        var made = await new ManualClaimService(kit.Db, kit.Ledger, kit.Clock).MakeAsync(kit.TenantId, new ManualClaimRequestDto
        {
            ParticipantId = person.Id, Lines = [new ManualClaimLineRequestDto { SupportItemCode = "15_100", ServiceDate = Day, Quantity = 2m, UnitPrice = 60m }],
        }, Ct);
        return new Made(kit, person, made.Claim, kit.Db.ClaimLineItems.Single());
    }

    [Fact]
    public async Task Bpr_ManualLine_CarriesTheClaimParticipantsNdisNumber_AndTheirStateNotTheOrganisations()
    {
        var m = await MakeAsync("NSW");
        using var _ = m.Kit;

        var bytes = await BprFile.OfClaimAsync(m.Kit.Db, m.Kit.TenantId, m.Claim.Id);

        var lines = Encoding.UTF8.GetString(bytes).Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        Assert.Equal(2, lines.Length);
        var header = lines[0].Split(',');
        var row = lines[1].Split(',');
        Assert.Equal(16, header.Length);
        Assert.Equal(16, row.Length);
        Assert.Equal(m.Person.NdisNumber, row[Array.IndexOf(header, "NDISNumber")]);
        Assert.Equal("15_100", row[Array.IndexOf(header, "SupportNumber")]);
        Assert.Equal("60.00", row[Array.IndexOf(header, "UnitPrice")]);
    }

    [Fact]
    public async Task Ledger_AManualDraftCounts_AndTheClaimBudgetIsFound()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;
        m.Kit.SeedPlan(m.Person, LedgerKit.Core(PlanType.AgencyManaged, LedgerKit.Q(2, 5000m)));

        var all = await m.Kit.Ledger.ComputeAsync(m.Kit.TenantId, [m.Person.Id], Ct);
        var budget = await m.Kit.Ledger.ForClaimAsync(m.Kit.TenantId, m.Claim.Id, Ct);

        Assert.Contains(all[m.Person.Id].Items, i => i.ClaimId == m.Claim.Id && i.Amount == 120m);
        Assert.NotNull(budget);
        Assert.Equal(m.Person.Id, Assert.Single(budget!.Participants).ParticipantId);
    }

    [Fact]
    public async Task Invoice_AManualClaim_IsOnePayerGroup_OfTheClaimsParticipant()
    {
        var m = await MakeAsync(plan: PlanType.SelfManaged);
        using var _ = m.Kit;
        var claim = await m.Kit.Db.TripClaims.Include(c => c.Participant).Include(c => c.LineItems).SingleAsync(Ct);

        var group = Assert.Single(InvoiceService.GroupsOf(claim));

        Assert.Equal(m.Person.Id, group.GroupId);
        Assert.Null(group.BookingId);
        Assert.Single(group.Lines);
    }

    [Fact]
    public async Task RejectionReader_FindsAManualLinesParticipant_AndNotThatOfAnotherOrganisation()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;
        m.Claim.Status = TripClaimStatus.Rejected;
        m.Claim.RejectionCode = "V17";
        m.Claim.RejectedDate = DateTime.UtcNow;
        m.Kit.Db.SaveChanges();
        var reader = new NdiaRejectionReader(m.Kit.Db, m.Kit.Clock);

        var row = Assert.Single(await reader.RejectedLinesQuery(m.Kit.TenantId, [m.Person.Id]).ToListAsync(Ct));
        var elsewhere = await reader.RejectedLinesQuery(Guid.NewGuid(), [m.Person.Id]).ToListAsync(Ct);

        Assert.Equal(m.Person.Id, row.ParticipantId);
        Assert.Equal(PlanType.AgencyManaged, row.ParticipantPlanType);
        Assert.Equal(m.Claim.ClaimReference, row.ClaimReference);
        Assert.Empty(elsewhere);
    }

    [Fact]
    public async Task Hub_ABatchLineOfAManualClaim_NamesTheParticipant()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;
        var batch = new ClaimBatch { Id = Guid.NewGuid(), TenantId = m.Kit.TenantId, FileName = "claims-1.csv", Status = ClaimBatchStatus.Built };
        m.Kit.Db.ClaimBatches.Add(batch);
        m.Kit.Db.ClaimBatchLines.Add(new ClaimBatchLine { Id = Guid.NewGuid(), TenantId = m.Kit.TenantId, BatchId = batch.Id, ClaimLineItemId = m.Line.Id, Outcome = ClaimBatchLineOutcome.Pending });
        m.Kit.Db.SaveChanges();
        var service = new ClaimBatchService(m.Kit.Db, new BprCsvService(m.Kit.Db), new InvoiceService(m.Kit.Db), m.Kit.Clock);

        var lines = await service.LinesAsync(m.Kit.TenantId, l => l.BatchId == batch.Id, Ct);

        Assert.Equal(m.Person.FullName, Assert.Single(lines).ParticipantName);
    }

    [Fact]
    public async Task ClaimAgain_OnAManualClaim_IsRefused()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;
        m.Claim.Status = TripClaimStatus.Rejected;
        m.Kit.Db.SaveChanges();
        var engine = new ShiftClaimGenerationService(m.Kit.Db, m.Kit.Ledger, m.Kit.Tenant);
        var now = LedgerKit.Today;

        var refused = await Assert.ThrowsAsync<ClaimAgainRefusedException>(() => engine.ClaimAgainAsync(m.Claim.Id, m.Kit.TenantId, now, Ct));

        Assert.Equal("Only a shift claim can be claimed again.", refused.Message);
        Assert.Equal(1, await m.Kit.Db.TripClaims.CountAsync(Ct));
    }

    [Fact]
    public async Task Controller_ManualActions_HaveTheSameRolesAsTheShiftClaim()
    {
        string RolesOf(string action) => typeof(ClaimsController).GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>()!.Roles!;
        var expected = RolesOf(nameof(ClaimsController.GenerateShiftClaim));

        Assert.Equal(expected, RolesOf(nameof(ClaimsController.PreviewManualClaim)));
        Assert.Equal(expected, RolesOf(nameof(ClaimsController.MakeManualClaim)));
        Assert.DoesNotContain("SupportWorker", expected);
        await Task.CompletedTask;
    }

    private static ClaimsController ControllerOf(LedgerKit kit, Mock<ICurrentTenant>? tenant = null) =>
        new(kit.Db, new ClaimGenerationService(kit.Db), new ShiftClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant), new BprCsvService(kit.Db), new InvoiceService(kit.Db), kit.Ledger, tenant?.Object ?? kit.Tenant!, kit.Clock);

    [Fact]
    public async Task Controller_NoOrganisation_IsRefused_ARefusalIs400_AndANotFoundIs404()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;
        var dto = new ManualClaimRequestDto
        {
            ParticipantId = m.Person.Id, Lines = [new ManualClaimLineRequestDto { SupportItemCode = "15_100", ServiceDate = Day, Quantity = 1m, UnitPrice = 10m }],
        };
        var none = new Mock<ICurrentTenant>();
        none.Setup(t => t.TenantId).Returns((Guid?)null);
        none.Setup(t => t.IsSuperAdmin).Returns(true);

        var noTenant = await ControllerOf(m.Kit, none).MakeManualClaim(dto, Ct);
        var noTenantPreview = await ControllerOf(m.Kit, none).PreviewManualClaim(dto, Ct);
        var refused = await ControllerOf(m.Kit).MakeManualClaim(dto with { Lines = [dto.Lines[0] with { Quantity = 0m }] }, Ct);
        var missing = await ControllerOf(m.Kit).PreviewManualClaim(dto with { ParticipantId = Guid.NewGuid() }, Ct);
        var ok = await ControllerOf(m.Kit).PreviewManualClaim(dto, Ct);

        Assert.Equal("Choose an organisation first.", Assert.Single(Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(Assert.IsType<BadRequestObjectResult>(noTenant.Result).Value).Errors!));
        Assert.IsType<BadRequestObjectResult>(noTenantPreview.Result);
        Assert.Equal("Quantity and unit price must be more than 0.", Assert.Single(Assert.IsType<ApiResponse<ShiftClaimGeneratedDto>>(Assert.IsType<BadRequestObjectResult>(refused.Result).Value).Errors!));
        Assert.IsType<NotFoundObjectResult>(missing.Result);
        Assert.IsType<OkObjectResult>(ok.Result);
        Assert.Equal(1, await m.Kit.Db.TripClaims.CountAsync(Ct));
    }

    [Fact]
    public async Task Controller_TheDetailOfAManualClaim_CarriesTheParticipantNameAndNdisNumber()
    {
        var m = await MakeAsync();
        using var _ = m.Kit;

        var result = await ControllerOf(m.Kit).GetClaim(m.Claim.Id, Ct);

        var detail = Assert.IsType<ApiResponse<TripClaimDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        var line = Assert.Single(detail.LineItems);
        Assert.Equal(m.Person.Id, line.ParticipantId);
        Assert.Equal(m.Person.FullName, line.ParticipantName);
        Assert.Equal(m.Person.NdisNumber, line.NdisNumber);
    }
}
