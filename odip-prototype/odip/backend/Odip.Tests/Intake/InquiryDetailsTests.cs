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
using static Odip.Tests.Intake.IntakeBookingsControllerTests;

namespace Odip.Tests.Intake;

/// <summary>
/// The enquiry's participant details and main contact at save (spec 2026-10-16 redesign, L3/L4, D4/D5/D7): only the first name is required, each bad
/// detail is refused on its own field in the form's words, and a converted enquiry's PUT writes only its names, source and provenance.
/// </summary>
public class InquiryDetailsTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly OdipDbContext _db;
    // Fri 16 Oct 2026, 12:00 pm in Sydney.
    private static readonly FixedClock Clock = new(new DateTime(2026, 10, 16, 1, 0, 0, DateTimeKind.Utc));
    private static readonly DateOnly Today = new(2026, 10, 16);

    public InquiryDetailsTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private ParticipantInquiriesController Controller(string role = "Coordinator")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role)], "test");
        return new ParticipantInquiriesController(_db, tenant.Object, Clock)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static IDictionary<string, string[]> Problems(IActionResult? result) =>
        Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>(result).Value).Errors;

    private ParticipantInquiry Stored() => _db.ParticipantInquiries.AsNoTracking().IgnoreQueryFilters().Single();

    private ParticipantInquiry Seed(Action<ParticipantInquiry>? with = null)
    {
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Noah", LastName = "Lee", Source = "Phone" };
        with?.Invoke(inquiry);
        _db.ParticipantInquiries.Add(inquiry);
        _db.SaveChanges();
        _db.ChangeTracker.Clear();
        return inquiry;
    }

    // An update body that repeats what is stored, so a test changes only what it names.
    private static UpdateParticipantInquiryDto Echo(ParticipantInquiry x) => new()
    {
        FirstName = x.FirstName, LastName = x.LastName, Phone = x.Phone, Email = x.Email, Source = x.Source, Provenance = x.Provenance,
        ContactFirstName = x.ContactFirstName, ContactLastName = x.ContactLastName, ContactRelationship = x.ContactRelationship, ContactRole = x.ContactRole,
        ContactIsParticipant = x.ContactIsParticipant, DateOfBirth = x.DateOfBirth, NdisNumber = x.NdisNumber,
        AddressStreet = x.AddressStreet, AddressSuburb = x.AddressSuburb, AddressState = x.AddressState, AddressPostcode = x.AddressPostcode,
        PlanType = x.PlanType, PlanStartDate = x.PlanStartDate, PlanEndDate = x.PlanEndDate,
    };

    [Fact]
    public async Task Create_with_only_a_first_name_saves_and_stores_the_rest_as_null()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = " Ari ", Source = "Phone" }, CancellationToken.None);

        Assert.Equal("", Data<ParticipantInquiryDto>(result.Result).LastName);
        var s = Stored();
        Assert.Equal("Ari", s.FirstName);
        Assert.False(s.ContactIsParticipant);
        Assert.All(new object?[] { s.LastName, s.Phone, s.Email, s.ContactFirstName, s.ContactLastName, s.ContactRelationship, s.ContactRole, s.DateOfBirth,
            s.NdisNumber, s.AddressStreet, s.AddressSuburb, s.AddressState, s.AddressPostcode, s.PlanType, s.PlanStartDate, s.PlanEndDate }, Assert.Null);
    }

    [Fact]
    public async Task A_blank_first_name_is_refused_in_the_forms_words()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "  ", Source = "Phone" }, CancellationToken.None);

        var problems = Problems(result.Result);
        Assert.Equal(["Add the participant's first name."], problems["firstName"]);
        Assert.False(problems.ContainsKey("FirstName"));
        Assert.Empty(_db.ParticipantInquiries.IgnoreQueryFilters());
    }

    public static TheoryData<string, string, string> BadDetails => new()
    {
        { "phone", "call me", "Enter a phone number, like 0412 345 678." },
        { "email", "a b@c.d", "Enter a full email address, like name@example.com." },
        { "ndisNumber", "430 123 45", "Enter the 9-digit NDIS number, like 430 123 456." },
        { "dateOfBirth", "tomorrow", "The date of birth can't be in the future." },
        { "dateOfBirth", "1900-01-01", "Check the year: that's more than 120 years ago." },
        { "addressState", "XX", "Choose a state from the list." },
        { "addressPostcode", "215", "Postcode must be exactly 4 digits." },
        { "planEndDate", "before", "The plan end can't be before the plan start." },
    };

    [Theory]
    [MemberData(nameof(BadDetails))]
    public async Task Each_bad_detail_is_refused_by_its_field_and_nothing_is_saved(string field, string value, string message)
    {
        var dto = new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone" };
        dto = field switch
        {
            "phone" => dto with { Phone = value },
            "email" => dto with { Email = value },
            "ndisNumber" => dto with { NdisNumber = value },
            "dateOfBirth" => dto with { DateOfBirth = value == "tomorrow" ? Today.AddDays(1) : DateOnly.Parse(value) },
            "addressState" => dto with { AddressState = value },
            "addressPostcode" => dto with { AddressPostcode = value },
            _ => dto with { PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2026, 6, 30) },
        };

        var result = await Controller().Create(dto, CancellationToken.None);

        Assert.Equal([message], Problems(result.Result)[field]);
        Assert.Empty(_db.ParticipantInquiries.IgnoreQueryFilters());
    }

    [Fact]
    public async Task The_NDIS_number_is_stored_without_spaces()
    {
        await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", NdisNumber = "430 123 456" }, CancellationToken.None);

        Assert.Equal("430123456", Stored().NdisNumber);
    }

    [Fact]
    public async Task Their_own_contact_stores_no_contact_name_relationship_or_role_whatever_was_sent()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto
        {
            FirstName = "Grace", Source = "Phone", Phone = "0412 345 678", ContactIsParticipant = true,
            ContactFirstName = "Sarah", ContactLastName = "Walsh", ContactRelationship = "Mother", ContactRole = ContactRoleType.Guardian,
        }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var s = Stored();
        Assert.True(s.ContactIsParticipant);
        Assert.Equal("0412 345 678", s.Phone);
        Assert.All(new object?[] { s.ContactFirstName, s.ContactLastName, s.ContactRelationship, s.ContactRole }, Assert.Null);
    }

    [Fact]
    public async Task A_legacy_phone_or_email_that_fails_the_rules_saves_while_unchanged_and_is_refused_once_changed()
    {
        var seeded = Seed(x => { x.Phone = "0412 555 010 after 3pm, ask for Mum"; x.Email = "noah at home"; });

        var unrelated = await Controller().Update(seeded.Id, Echo(seeded) with { Provenance = "GP referral" }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(unrelated.Result);

        var changed = await Controller().Update(seeded.Id, Echo(Stored()) with { Phone = "call" }, CancellationToken.None);
        Assert.Equal(["Enter a phone number, like 0412 345 678."], Problems(changed.Result)["phone"]);

        var self = await Controller().Update(seeded.Id, Echo(Stored()) with { ContactIsParticipant = true }, CancellationToken.None);
        Assert.Equal(["Enter a phone number, like 0412 345 678."], Problems(self.Result)["phone"]);
    }

    [Fact]
    public async Task The_main_contacts_role_is_checked_against_the_enquirys_age_and_plan()
    {
        var child = new DateOnly(2014, 3, 12);
        var nominee = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", DateOfBirth = child, ContactRole = ContactRoleType.PlanNominee }, CancellationToken.None);
        Assert.Equal(["Plan Nominee is not available for a participant under 18 — use Child Representative instead."], Problems(nominee.Result)["contactRole"]);

        var provider = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", PlanType = PlanType.AgencyManaged, ContactRole = ContactRoleType.ProviderContact }, CancellationToken.None);
        Assert.Equal(["Agency-managed participants can only record registered-provider contacts."], Problems(provider.Result)["contactRole"]);

        var manager = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ContactRole = ContactRoleType.PlanManager }, CancellationToken.None);
        Assert.Equal(["Add a plan manager on the participant's Contacts tab once intake starts."], Problems(manager.Result)["contactRole"]);

        var guardian = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ContactRole = ContactRoleType.Guardian }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(guardian.Result);
    }

    [Fact]
    public async Task A_pending_contacts_role_is_checked_the_same_way()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto
        {
            FirstName = "Ari", Source = "Phone", DateOfBirth = new DateOnly(2014, 3, 12),
            Contacts = [new InquiryContactDto { Role = ContactRoleType.PlanNominee, FirstName = "Sarah", LastName = "Walsh" }],
        }, CancellationToken.None);

        Assert.Equal(["Plan Nominee is not available for a participant under 18 — use Child Representative instead."], Problems(result.Result)["contacts[0].role"]);
    }

    [Fact]
    public async Task A_converted_enquirys_PUT_writes_only_the_names_source_and_provenance()
    {
        var seeded = Seed(x => { x.ParticipantId = Guid.NewGuid(); x.Phone = "0412 345 678"; x.NdisNumber = "430123456"; x.AddressPostcode = "2150"; });

        var result = await Controller().Update(seeded.Id, Echo(seeded) with { FirstName = "Noa", Phone = "x", NdisNumber = "abc", AddressPostcode = "1" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var s = Stored();
        Assert.Equal(("Noa", "0412 345 678", "430123456", "2150"), (s.FirstName, s.Phone, s.NdisNumber, s.AddressPostcode));
    }
}
