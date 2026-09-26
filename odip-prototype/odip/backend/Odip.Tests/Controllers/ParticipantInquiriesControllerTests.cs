using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Contract tests for internal inquiry capture and its single-participant conversion.</summary>
public class ParticipantInquiriesControllerTests
{
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    [Fact]
    public async Task CreateAndRepeatedConvert_PreservesFullInquiryPayload_AndCreatesOneDraftParticipant()
    {
        var tenantId = Guid.NewGuid();
        using var fixture = CreateDb(tenantId).Db;
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var controller = new ParticipantInquiriesController(fixture, tenant.Object);
        var payload = new CreateParticipantInquiryDto
        {
            FirstName = "  Ada ", LastName = "  Lovelace ", Phone = "0400 000 001",
            Email = "ada@example.test", Source = "Email", Provenance = "Hospital referral #R-9"
        };

        var create = await controller.Create(payload, CancellationToken.None);
        var created = Data<ParticipantInquiryDto>(create.Result!);
        Assert.Equal("Ada", created.FirstName);
        Assert.Equal("Lovelace", created.LastName);
        Assert.Equal(payload.Phone, created.Phone);
        Assert.Equal(payload.Email, created.Email);
        Assert.Equal("Email", created.Source);
        Assert.Equal(payload.Provenance, created.Provenance);

        var firstConvert = Data<ParticipantInquiryDto>(
            (await controller.Convert(created.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).Result!);
        var secondConvert = Data<ParticipantInquiryDto>(
            (await controller.Convert(created.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).Result!);

        Assert.NotNull(firstConvert.ParticipantId);
        Assert.Equal(firstConvert.ParticipantId, secondConvert.ParticipantId);
        var participant = Assert.Single(fixture.Participants);
        Assert.Equal(firstConvert.ParticipantId, participant.Id);
        Assert.Equal(tenantId, participant.TenantId);
        Assert.True(participant.IsDraft);
        Assert.Equal("Ada", participant.FirstName);
        Assert.Equal("Lovelace", participant.LastName);
        Assert.Equal(payload.Phone, participant.Phone);
        Assert.Equal(payload.Email, participant.Email);
        Assert.Single(fixture.ParticipantOnboardings);
    }

    [Theory]
    [InlineData("Web")]
    [InlineData("Email")]
    [InlineData("Phone")]
    public async Task Create_AcceptsEachInternalSourceChannel(string source)
    {
        var tenantId = Guid.NewGuid();
        using var fixture = CreateDb(tenantId).Db;
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var controller = new ParticipantInquiriesController(fixture, tenant.Object);

        var result = await controller.Create(new CreateParticipantInquiryDto { FirstName = "Source", LastName = source, Source = source }, CancellationToken.None);

        Assert.Equal(source, Data<ParticipantInquiryDto>(result.Result!).Source);
    }

    [Fact]
    public async Task Convert_ForeignInquiryOrParticipant_ReturnsNonEnumeratingNotFound()
    {
        var ownTenant = Guid.NewGuid();
        var otherTenant = Guid.NewGuid();
        var (db, tenant) = CreateDb(ownTenant);
        using (db)
        {
            var foreignInquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = otherTenant, FirstName = "Foreign", LastName = "Inquiry", Source = "Phone" };
            var foreignParticipant = new Participant { Id = Guid.NewGuid(), TenantId = otherTenant, FirstName = "Foreign", LastName = "Participant", IsActive = true, IsDraft = true };
            db.AddRange(foreignInquiry, foreignParticipant);
            await db.SaveChangesAsync();
            var controller = new ParticipantInquiriesController(db, tenant.Object);

            var foreignInquiryResult = await controller.Convert(foreignInquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None);
            Assert.IsType<NotFoundObjectResult>(foreignInquiryResult.Result);

            var ownInquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = ownTenant, FirstName = "Own", LastName = "Inquiry", Source = "Phone" };
            db.ParticipantInquiries.Add(ownInquiry);
            await db.SaveChangesAsync();
            var foreignParticipantResult = await controller.Convert(ownInquiry.Id, new ConvertParticipantInquiryDto { ParticipantId = foreignParticipant.Id }, CancellationToken.None);
            Assert.IsType<NotFoundObjectResult>(foreignParticipantResult.Result);
            Assert.Null((await db.ParticipantInquiries.SingleAsync(x => x.Id == ownInquiry.Id)).ParticipantId);
        }
    }

    [Fact]
    public async Task Convert_SuperAdminCannotLinkSameRequestToForeignTenantParticipant()
    {
        var ownTenant = Guid.NewGuid();
        var foreignTenant = Guid.NewGuid();
        var (db, tenant) = CreateDb(ownTenant);
        using (db)
        {
            tenant.SetupGet(x => x.IsSuperAdmin).Returns(true);
            var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = ownTenant, FirstName = "Own", LastName = "Inquiry", Source = "Phone" };
            var foreignParticipant = new Participant { Id = Guid.NewGuid(), TenantId = foreignTenant, FirstName = "Foreign", LastName = "Participant", IsActive = true, IsDraft = true };
            db.AddRange(inquiry, foreignParticipant);
            await db.SaveChangesAsync();
            var controller = new ParticipantInquiriesController(db, tenant.Object);

            var result = await controller.Convert(inquiry.Id, new ConvertParticipantInquiryDto { ParticipantId = foreignParticipant.Id }, CancellationToken.None);

            Assert.IsType<NotFoundObjectResult>(result.Result);
            Assert.Null((await db.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id)).ParticipantId);
            Assert.Empty(db.ParticipantOnboardings);
        }
    }

    private static T Data<T>(IActionResult result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;
}
