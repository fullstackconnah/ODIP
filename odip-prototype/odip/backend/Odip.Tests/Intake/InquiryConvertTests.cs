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
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>
/// Start intake (Convert) after the enquiry redesign (spec 2026-10-16, L5, D1, D2, G1, G3, G4): the address and name gates, the details copied onto the
/// participant, and the main contact becoming the participant's first contact, with the phone and email no longer copied onto the participant.
/// </summary>
public class InquiryConvertTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly OdipDbContext _db;

    public InquiryConvertTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private ParticipantInquiriesController Controller()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Coordinator")], "test");
        return new ParticipantInquiriesController(_db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static IDictionary<string, string[]> Problems(IActionResult? result) =>
        Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>(result).Value).Errors;

    private ParticipantInquiry Seed(Action<ParticipantInquiry> with)
    {
        var x = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Ari", LastName = "Walsh", Source = "Phone" };
        with(x);
        _db.ParticipantInquiries.Add(x);
        _db.SaveChanges();
        _db.ChangeTracker.Clear();
        return x;
    }

    private static void SarahAsGuardian(ParticipantInquiry x)
    {
        x.WithFullAddress();
        x.ContactFirstName = "Sarah"; x.ContactLastName = "Walsh"; x.ContactRelationship = "Mother"; x.ContactRole = ContactRoleType.Guardian;
        x.Phone = "0412 555 061"; x.Email = "sarah.walsh@example.com.au";
    }

    private async Task<Guid> ConvertedAsync(ParticipantInquiry x, Guid? onto = null)
    {
        var result = (await Controller().Convert(x.Id, new() { ParticipantId = onto }, CancellationToken.None)).Result;
        return Assert.IsType<ApiResponse<ParticipantInquiryDto>>(Assert.IsType<OkObjectResult>(result).Value).Data!.ParticipantId!.Value;
    }

    private List<ParticipantContactRole> RolesOf(Guid participantId) =>
        _db.ParticipantContactRoles.AsNoTracking().Include(r => r.Person).Where(r => r.ParticipantId == participantId).ToList();

    [Fact]
    public async Task Convert_without_a_full_address_is_a_400_keyed_by_each_missing_field_and_creates_nothing()
    {
        var x = Seed(i => i.AddressStreet = "12 Smith St");

        var problems = Problems((await Controller().Convert(x.Id, new(), CancellationToken.None)).Result);

        Assert.Equal(["addressPostcode", "addressState", "addressSuburb"], problems.Keys.Order());
        Assert.Equal(["Add the suburb to start intake."], problems["addressSuburb"]);
        Assert.Equal(["Add the state to start intake."], problems["addressState"]);
        Assert.Equal(["Add the postcode to start intake."], problems["addressPostcode"]);
        Assert.Empty(_db.Participants.AsNoTracking());
    }

    [Fact]
    public async Task Convert_checks_closed_before_the_address()
    {
        var x = Seed(i => i.ClosedAt = DateTime.UtcNow);

        var conflict = Assert.IsType<ConflictObjectResult>((await Controller().Convert(x.Id, new(), CancellationToken.None)).Result);

        Assert.Equal(IntakeBookingsController.ClosedCode, Assert.IsType<ApiResponse<ParticipantInquiryDto>>(conflict.Value).Code);
    }

    [Fact]
    public async Task Convert_with_a_contact_phone_but_no_contact_name_is_a_400_on_the_contact_name()
    {
        var x = Seed(i => { i.WithFullAddress(); i.Phone = "0412 555 061"; });

        var problems = Problems((await Controller().Convert(x.Id, new(), CancellationToken.None)).Result);

        Assert.Equal(["contactFirstName", "contactLastName"], problems.Keys.Order());
        Assert.Equal(["Add the main contact's name to start intake."], problems["contactFirstName"]);
        Assert.Empty(_db.Participants.AsNoTracking());
    }

    [Fact]
    public async Task Convert_copies_the_names_DOB_NDIS_number_address_plan_dates_and_plan_type()
    {
        var x = Seed(i =>
        {
            i.WithFullAddress(); i.LastName = null; i.ContactIsParticipant = true;
            i.DateOfBirth = new DateOnly(1990, 5, 1); i.NdisNumber = "430123456"; i.PlanType = PlanType.PlanManaged;
            i.PlanStartDate = new DateOnly(2026, 7, 1); i.PlanEndDate = new DateOnly(2027, 6, 30);
        });

        var id = await ConvertedAsync(x);
        var p = _db.Participants.AsNoTracking().Single(p => p.Id == id);

        Assert.Equal(("Ari", ""), (p.FirstName, p.LastName));
        Assert.Equal((new DateOnly(1990, 5, 1), "430123456", PlanType.PlanManaged), (p.DateOfBirth, p.NdisNumber, p.PlanType));
        Assert.Equal(("12 Smith St", "Parramatta", "NSW", "2150"), (p.AddressStreet, p.AddressSuburb, p.AddressState, p.AddressPostcode));
        Assert.Equal((new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)), (p.PlanStartDate, p.PlanEndDate));
        Assert.True(p.IsDraft);
        Assert.False(p.IsActive);
    }

    [Fact]
    public async Task Convert_makes_the_main_contact_the_participants_first_contact_and_does_not_copy_their_phone_or_email_onto_the_participant()
    {
        var x = Seed(SarahAsGuardian);
        _db.InquiryContacts.Add(new InquiryContact { Id = Guid.NewGuid(), TenantId = _tenantId, InquiryId = x.Id, Role = ContactRoleType.EmergencyContact, FirstName = "Tom", LastName = "Ng" });
        _db.SaveChanges();

        var id = await ConvertedAsync(x);

        var p = _db.Participants.AsNoTracking().Single(p => p.Id == id);
        Assert.Equal(((string?)null, (string?)null), (p.Phone, p.Email));
        var roles = RolesOf(id);
        var sarah = Assert.Single(roles, r => r.IsPrimary);
        Assert.Equal(("Sarah", "Walsh", "0412 555 061", "sarah.walsh@example.com.au"), (sarah.Person!.FirstName, sarah.Person.LastName, sarah.Person.Phone, sarah.Person.Email));
        Assert.Equal((ContactRoleType.Guardian, "Mother", (string?)null), (sarah.RoleType, sarah.RelationshipToParticipant, sarah.Notes));
        Assert.False(Assert.Single(roles, r => r.Person!.FirstName == "Tom").IsPrimary);
    }

    [Fact]
    public async Task A_main_contact_with_no_role_becomes_Next_of_Kin()
    {
        var x = Seed(i => { SarahAsGuardian(i); i.ContactRole = null; });

        var role = Assert.Single(RolesOf(await ConvertedAsync(x)));

        Assert.Equal((ContactRoleType.NextOfKin, true), (role.RoleType, role.IsPrimary));
    }

    [Fact]
    public async Task Their_own_contact_puts_the_phone_and_email_on_the_participant_and_adds_no_contact()
    {
        var x = Seed(i => { i.WithFullAddress(); i.ContactIsParticipant = true; i.Phone = "0412 555 061"; i.Email = "ari@example.com"; });

        var id = await ConvertedAsync(x);

        var p = _db.Participants.AsNoTracking().Single(p => p.Id == id);
        Assert.Equal(("0412 555 061", "ari@example.com"), (p.Phone, p.Email));
        Assert.Empty(RolesOf(id));
        Assert.Empty(_db.People.AsNoTracking());
    }

    [Fact]
    public async Task A_legacy_phone_that_is_not_a_phone_goes_into_the_contacts_notes()
    {
        var x = Seed(i => { SarahAsGuardian(i); i.Phone = "0412 555 010 after 3pm"; });

        var role = Assert.Single(RolesOf(await ConvertedAsync(x)));

        Assert.Null(role.Person!.Phone);
        Assert.Equal("Phone on the enquiry: 0412 555 010 after 3pm", role.Notes);
    }

    [Fact]
    public async Task A_pending_row_that_repeats_the_main_contact_is_added_once()
    {
        var x = Seed(SarahAsGuardian);
        _db.InquiryContacts.Add(new InquiryContact { Id = Guid.NewGuid(), TenantId = _tenantId, InquiryId = x.Id, Role = ContactRoleType.Guardian, FirstName = "sarah", LastName = "WALSH", Relationship = "Mum" });
        _db.SaveChanges();

        var role = Assert.Single(RolesOf(await ConvertedAsync(x)));

        Assert.Equal((true, "Mother"), (role.IsPrimary, role.RelationshipToParticipant));
        Assert.Empty(_db.InquiryContacts.AsNoTracking());
    }

    [Fact]
    public async Task Convert_onto_an_existing_participant_copies_nothing_and_needs_no_address_but_moves_the_main_contact()
    {
        var existing = new Participant { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Ari", LastName = "Walsh", Phone = "0400 000 000" };
        _db.Participants.Add(existing);
        var x = Seed(i => { SarahAsGuardian(i); i.AddressStreet = null; i.AddressSuburb = null; i.AddressState = null; i.AddressPostcode = null; i.DateOfBirth = new DateOnly(1990, 1, 1); });

        Assert.Equal(existing.Id, await ConvertedAsync(x, existing.Id));

        var p = _db.Participants.AsNoTracking().Single(p => p.Id == existing.Id);
        Assert.Equal(("0400 000 000", (DateOnly?)null, (string?)null), (p.Phone, p.DateOfBirth, p.AddressStreet));
        Assert.Equal("Sarah", Assert.Single(RolesOf(existing.Id)).Person!.FirstName);
    }

    [Fact]
    public async Task The_main_contact_is_not_primary_when_the_participant_already_has_a_primary_next_of_kin()
    {
        var existing = new Participant { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Ari", LastName = "Walsh" };
        var dad = new Person { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Mark", LastName = "Walsh" };
        _db.AddRange(existing, dad, new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = _tenantId, ParticipantId = existing.Id, PersonId = dad.Id, RoleType = ContactRoleType.NextOfKin, IsPrimary = true });
        var x = Seed(i => { SarahAsGuardian(i); i.ContactRole = null; });

        await ConvertedAsync(x, existing.Id);

        var sarah = Assert.Single(RolesOf(existing.Id), r => r.Person!.FirstName == "Sarah");
        Assert.Equal((ContactRoleType.NextOfKin, false), (sarah.RoleType, sarah.IsPrimary));
    }
}
