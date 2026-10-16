using System.Security.Claims;
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
using Odip.Tests.Intake;
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
            Email = "ada@example.test", Source = "Email", Provenance = "Hospital referral #R-9",
            ContactFirstName = "Byron", ContactLastName = "Lovelace",
        }.WithFullAddress();

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
        Assert.False(participant.IsActive);
        Assert.Equal("Ada", participant.FirstName);
        Assert.Equal("Lovelace", participant.LastName);
        // Spec L5: the phone and email are the main contact's, so they go onto the contact, not the participant.
        Assert.Null(participant.Phone);
        Assert.Null(participant.Email);
        Assert.Single(fixture.ParticipantOnboardings);
    }

    [Fact]
    public async Task Convert_of_a_participant_who_is_their_own_contact_copies_the_phone_and_email_onto_them()
    {
        var tenantId = Guid.NewGuid();
        using var fixture = CreateDb(tenantId).Db;
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var controller = new ParticipantInquiriesController(fixture, tenant.Object);
        var created = Data<ParticipantInquiryDto>((await controller.Create(new CreateParticipantInquiryDto
        {
            FirstName = "Ada", LastName = "Lovelace", Phone = "0400 000 001", Email = "ada@example.test", Source = "Email", ContactIsParticipant = true,
        }.WithFullAddress(), CancellationToken.None)).Result!);

        Data<ParticipantInquiryDto>((await controller.Convert(created.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).Result!);

        var participant = Assert.Single(fixture.Participants);
        Assert.Equal(("0400 000 001", "ada@example.test"), (participant.Phone, participant.Email));
        Assert.Empty(fixture.ParticipantContactRoles);
    }

    [Fact]
    public async Task Convert_TwoInquiriesLinkedToOneExistingParticipant_CreatesOneSharedOnboarding()
    {
        var tenantId = Guid.NewGuid();
        using var fixture = CreateDb(tenantId).Db;
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Lovelace", IsActive = true, IsDraft = true };
        var firstInquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Lovelace", Source = "Email" };
        var secondInquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Lovelace", Source = "Phone" };
        fixture.AddRange(participant, firstInquiry, secondInquiry);
        await fixture.SaveChangesAsync();
        var controller = new ParticipantInquiriesController(fixture, tenant.Object);

        var first = Data<ParticipantInquiryDto>((await controller.Convert(firstInquiry.Id, new ConvertParticipantInquiryDto { ParticipantId = participant.Id }, CancellationToken.None)).Result!);
        var second = Data<ParticipantInquiryDto>((await controller.Convert(secondInquiry.Id, new ConvertParticipantInquiryDto { ParticipantId = participant.Id }, CancellationToken.None)).Result!);

        Assert.Equal(participant.Id, first.ParticipantId);
        Assert.Equal(participant.Id, second.ParticipantId);
        var onboarding = Assert.Single(fixture.ParticipantOnboardings);
        Assert.Equal(participant.Id, onboarding.ParticipantId);
        Assert.Equal(tenantId, onboarding.TenantId);
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
    public async Task GetOnboarding_ForeignParticipant_ReturnsNonEnumeratingNotFound()
    {
        var ownTenant = Guid.NewGuid();
        var foreignTenant = Guid.NewGuid();
        var (db, tenant) = CreateDb(ownTenant);
        using (db)
        {
            var foreignParticipant = new Participant { Id = Guid.NewGuid(), TenantId = foreignTenant, FirstName = "Foreign", LastName = "Participant", IsDraft = false };
            var foreignOnboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = foreignTenant, ParticipantId = foreignParticipant.Id };
            db.AddRange(foreignParticipant, foreignOnboarding);
            await db.SaveChangesAsync();
            var controller = new ParticipantInquiriesController(db, tenant.Object);

            var result = await controller.GetOnboarding(foreignParticipant.Id, CancellationToken.None);

            Assert.IsType<NotFoundObjectResult>(result.Result);
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

    private static readonly DateTime VisitStart = new(2026, 10, 16, 0, 0, 0, DateTimeKind.Utc);

    // One booked enquiry, read by a caller in the given role.
    private static async Task<List<ParticipantInquiryDto>> BookedFeedAs(string role, Guid staffId)
    {
        var tenantId = Guid.NewGuid();
        var (db, tenant) = CreateDb(tenantId);
        db.Users.Add(new User { Id = staffId, TenantId = tenantId, Username = "sam", Email = "sam@example.com", FirstName = "Sam", LastName = "Lee", Role = UserRole.Coordinator, IsActive = true });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "QLD" });
        db.ParticipantInquiries.Add(new ParticipantInquiry
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Noah", LastName = "Fitzgerald", Source = "Phone",
            IntakeStartsAt = VisitStart, IntakeDurationMinutes = 90, IntakeLocation = "12 Smith St", IntakeStaffUserId = staffId,
            IntakeNotes = "Gate code 1234", IntakeInviteError = "NotConfigured", IntakeConfirmedAt = VisitStart.AddDays(-1),
        });
        await db.SaveChangesAsync();
        var controller = new ParticipantInquiriesController(db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test")) } },
        };
        return Data<List<ParticipantInquiryDto>>((await controller.GetAll(CancellationToken.None)).Result!);
    }

    // The location is often a home address, and the notes are internal: like /intake-visits, they are for the lifecycle roles. Everyone who can open
    // the Enquiries tab still sees when the visit is, the staff member's first name and what the invite did.
    [Fact]
    public async Task GetAll_keeps_a_visits_address_notes_and_staff_name_from_roles_outside_the_lifecycle()
    {
        var row = Assert.Single(await BookedFeedAs("SupportWorker", Guid.NewGuid()));

        Assert.Equal(VisitStart, row.IntakeStartsAt);
        Assert.Equal("Sam", row.IntakeStaffFirstName);
        Assert.Equal("NotConfigured", row.IntakeInviteError);
        Assert.Null(row.IntakeLocation);
        Assert.Null(row.IntakeNotes);
        Assert.Null(row.IntakeStaffName);
    }

    [Fact]
    public async Task GetAll_carries_the_booking_the_staff_names_and_the_providers_zone()
    {
        var staffId = Guid.NewGuid();
        var start = VisitStart;

        var rows = await BookedFeedAs("Coordinator", staffId);

        var row = Assert.Single(rows);
        Assert.Equal(start, row.IntakeStartsAt);
        Assert.Equal(90, row.IntakeDurationMinutes);
        Assert.Equal("12 Smith St", row.IntakeLocation);
        Assert.Equal(staffId, row.IntakeStaffUserId);
        Assert.Equal("Sam", row.IntakeStaffFirstName);
        Assert.Equal("Sam Lee", row.IntakeStaffName);
        Assert.Equal("Gate code 1234", row.IntakeNotes);
        Assert.Equal("NotConfigured", row.IntakeInviteError);
        Assert.Equal(start.AddDays(-1), row.IntakeConfirmedAt);
        Assert.Equal("Australia/Brisbane", row.TimeZoneId);
    }
}
