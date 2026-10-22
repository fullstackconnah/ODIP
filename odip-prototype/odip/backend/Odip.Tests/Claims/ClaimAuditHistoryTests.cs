using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Claims;

/// <summary>A claim and its lines are audited, so the audit history can be asked for them: for the caller's own organisation only (a claim has no organisation column, so it is found through its trip or participant).</summary>
public class ClaimAuditHistoryTests
{
    private static readonly Guid TenantA = Guid.NewGuid();

    [Theory]
    [InlineData("TripClaim", false)]
    [InlineData("TripClaim", true)]
    [InlineData("ClaimLineItem", false)]
    [InlineData("ClaimLineItem", true)]
    public async Task AuditHistory_ClaimAndLine_ReadableForOwnOrganisationOnly(string entityType, bool foreign)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = foreign ? Guid.NewGuid() : TenantA, FirstName = "Ada", LastName = "Claim" };
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, Status = TripClaimStatus.Submitted, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20] };
        var line = new ClaimLineItem { Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = Guid.NewGuid(), SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday, Hours = 1m, UnitPrice = 1m, TotalAmount = 1m };
        db.AddRange(participant, claim, line);
        db.SaveChanges();

        var result = await new AuditController(db, NullLogger<AuditController>.Instance).GetAuditHistory(entityType, entityType == "TripClaim" ? claim.Id : line.Id, ct: CancellationToken.None);

        if (foreign) Assert.IsType<NotFoundObjectResult>(result); else Assert.IsType<OkObjectResult>(result);
    }

    [Fact]
    public void AuditHistory_IsForAdminsOnly()
    {
        var authorize = Assert.Single(typeof(AuditController).GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true).Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        Assert.Equal("Admin,SuperAdmin", authorize.Roles);
    }
}
