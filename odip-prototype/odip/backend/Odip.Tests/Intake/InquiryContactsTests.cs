using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
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

/// <summary>An enquiry's pending contacts (spec 2026-10-16, D3): saved with the enquiry, refused by row, and the answers carry the provider's zone.</summary>
public class InquiryContactsTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly OdipDbContext _db;

    public InquiryContactsTests()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        _db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private ParticipantInquiriesController Controller(string role = "Coordinator", Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId ?? _tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role)], "test");
        return new ParticipantInquiriesController(_db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static IDictionary<string, string[]> Problems(IActionResult? result) =>
        Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>(result).Value).Errors;

    private static CreateParticipantInquiryDto Body(List<InquiryContactDto>? contacts) =>
        new() { FirstName = "Ana", LastName = "Lopez", Source = "Phone", Contacts = contacts };

    private static UpdateParticipantInquiryDto UpdateBody(List<InquiryContactDto>? contacts, string firstName = "Ana") =>
        new() { FirstName = firstName, LastName = "Lopez", Source = "Phone", Contacts = contacts };

    private static InquiryContactDto Contact(ContactRoleType? role, string? first, string? last, string? phone = null, string? email = null, string? relationship = null) =>
        new() { Role = role, FirstName = first, LastName = last, Phone = phone, Email = email, Relationship = relationship };

    private ParticipantInquiry SeedInquiry(Guid? participantId = null, Guid? tenantId = null)
    {
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId ?? _tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone", ParticipantId = participantId };
        _db.ParticipantInquiries.Add(inquiry);
        _db.SaveChanges();
        return inquiry;
    }

    private void SeedContacts(ParticipantInquiry inquiry, params InquiryContact[] contacts)
    {
        for (var i = 0; i < contacts.Length; i++)
        {
            contacts[i].Id = Guid.NewGuid(); contacts[i].TenantId = inquiry.TenantId; contacts[i].InquiryId = inquiry.Id; contacts[i].SortOrder = i;
        }
        _db.InquiryContacts.AddRange(contacts);
        _db.SaveChanges();
        _db.ChangeTracker.Clear();
    }

    private List<InquiryContact> Stored() => _db.InquiryContacts.AsNoTracking().IgnoreQueryFilters().OrderBy(c => c.SortOrder).ToList();

    [Fact]
    public async Task Create_saves_the_contacts_with_the_enquiry_in_one_save_in_the_forms_order()
    {
        var result = await Controller().Create(Body([
            Contact(ContactRoleType.Guardian, " Maria ", "Lopez", "0412 345 678", "maria@example.com", "Mother"),
            Contact(ContactRoleType.EmergencyContact, "Tom", "Ng", " ", ""),
        ]), CancellationToken.None);

        var dto = Data<ParticipantInquiryDto>(result.Result);
        var stored = Stored();
        Assert.Equal(2, stored.Count);
        Assert.All(stored, c => Assert.Equal((dto.Id, _tenantId), (c.InquiryId, c.TenantId)));
        Assert.Equal((0, ContactRoleType.Guardian, "Maria", "Lopez", "0412 345 678", "maria@example.com", "Mother"),
            (stored[0].SortOrder, stored[0].Role, stored[0].FirstName, stored[0].LastName, stored[0].Phone, stored[0].Email, stored[0].Relationship));
        Assert.Equal((1, ContactRoleType.EmergencyContact, "Tom", "Ng", (string?)null, (string?)null, (string?)null),
            (stored[1].SortOrder, stored[1].Role, stored[1].FirstName, stored[1].LastName, stored[1].Phone, stored[1].Email, stored[1].Relationship));
    }

    [Fact]
    public async Task Create_answers_with_the_providers_zone()
    {
        var sydney = Data<ParticipantInquiryDto>((await Controller().Create(Body(null), CancellationToken.None)).Result);
        Assert.Equal("Australia/Sydney", sydney.TimeZoneId);

        _db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = _tenantId, State = "WA", OrganisationName = "West Co" });
        _db.SaveChanges();
        var perth = Data<ParticipantInquiryDto>((await Controller().Create(Body(null), CancellationToken.None)).Result);
        Assert.Equal("Australia/Perth", perth.TimeZoneId);
    }

    [Fact]
    public async Task Update_replaces_the_contacts_and_a_PUT_without_contacts_leaves_them()
    {
        var inquiry = SeedInquiry();
        SeedContacts(inquiry,
            new InquiryContact { Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez" },
            new InquiryContact { Role = ContactRoleType.NextOfKin, FirstName = "Tom", LastName = "Ng" });

        Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody([Contact(ContactRoleType.Advocate, "Lee", "Park", "0400 000 000")]), CancellationToken.None)).Result);
        var one = Assert.Single(Stored());
        Assert.Equal((ContactRoleType.Advocate, "Lee", "Park", "0400 000 000", 0), (one.Role, one.FirstName, one.LastName, one.Phone, one.SortOrder));

        _db.ChangeTracker.Clear();
        Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody(null, "Anna"), CancellationToken.None)).Result);
        Assert.Single(Stored());

        _db.ChangeTracker.Clear();
        Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody([]), CancellationToken.None)).Result);
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task Each_bad_contact_field_is_refused_by_its_row_and_nothing_is_saved()
    {
        var result = await Controller().Create(Body([
            Contact(ContactRoleType.PlanManager, "Pat", "Kerr"),
            Contact(null, "Maria", " ", "12ab", "maria at home"),
            Contact(ContactRoleType.Guardian, "Ann", "Lee", email: "Ann <a@b.c>"),
        ]), CancellationToken.None);

        var errors = Problems(result.Result);
        Assert.Equal(new Dictionary<string, string[]>
        {
            ["contacts[0].role"] = ["Add a plan manager on the participant's Contacts tab once intake starts."],
            ["contacts[1].role"] = ["Choose a role."],
            ["contacts[1].lastName"] = ["Add their last name."],
            ["contacts[1].phone"] = ["Enter a phone number, like 0412 345 678."],
            ["contacts[1].email"] = ["Enter a full email address, like name@example.com."],
            ["contacts[2].email"] = ["Enter a full email address, like name@example.com."],
        }, errors.OrderBy(e => e.Key).ToDictionary(e => e.Key, e => e.Value));
        Assert.Empty(_db.ParticipantInquiries.AsNoTracking().IgnoreQueryFilters());
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task More_than_twenty_contacts_are_refused()
    {
        var rows = Enumerable.Range(0, 21).Select(i => Contact(ContactRoleType.NextOfKin, $"P{i}", "Ng")).ToList();
        var errors = Problems((await Controller().Create(Body(rows), CancellationToken.None)).Result);
        Assert.Equal(["Add at most 20 contacts."], errors["contacts"]);
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task Contacts_on_a_converted_enquiry_are_refused_but_none_or_an_empty_list_is_fine()
    {
        var inquiry = SeedInquiry(participantId: Guid.NewGuid());

        var refused = await Controller().Update(inquiry.Id, UpdateBody([Contact(ContactRoleType.NextOfKin, "Tom", "Ng")], "Changed"), CancellationToken.None);
        Assert.Equal(["Intake has started, so add contacts on the participant's record."], Problems(refused.Result)["contacts"]);
        _db.ChangeTracker.Clear();
        Assert.Equal("Ana", _db.ParticipantInquiries.AsNoTracking().Single(x => x.Id == inquiry.Id).FirstName);

        Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody(null), CancellationToken.None)).Result);
        _db.ChangeTracker.Clear();
        Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody([]), CancellationToken.None)).Result);
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task Get_returns_the_enquiry_with_its_contacts_in_order_with_the_zone_and_staff()
    {
        var inquiry = SeedInquiry();
        SeedContacts(inquiry,
            new InquiryContact { Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez", Phone = "0412 345 678", Email = "maria@example.com", Relationship = "Mother", Notes = "Works nights" },
            new InquiryContact { Role = ContactRoleType.EmergencyContact, FirstName = "Tom", LastName = "Ng" });

        var dto = Data<ParticipantInquiryDetailDto>((await Controller().Get(inquiry.Id, CancellationToken.None)).Result);

        Assert.Equal((inquiry.Id, "Ana", "Australia/Sydney"), (dto.Id, dto.FirstName, dto.TimeZoneId));
        Assert.Equal(2, dto.Contacts.Count);
        Assert.Equal(new InquiryContactDto { Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez", Phone = "0412 345 678", Email = "maria@example.com", Relationship = "Mother", Notes = "Works nights" }, dto.Contacts[0]);
        Assert.Equal(new InquiryContactDto { Role = ContactRoleType.EmergencyContact, FirstName = "Tom", LastName = "Ng" }, dto.Contacts[1]);
    }

    [Fact]
    public async Task Get_another_organisations_enquiry_is_not_found()
    {
        var other = Guid.NewGuid();
        var theirs = SeedInquiry(tenantId: other);
        SeedContacts(theirs, new InquiryContact { Role = ContactRoleType.Guardian, FirstName = "Zelda", LastName = "Quill", Phone = "0499 111 222" });

        var result = (await Controller().Get(theirs.Id, CancellationToken.None)).Result;

        var notFound = Assert.IsType<NotFoundObjectResult>(result);
        var json = JsonSerializer.Serialize(notFound.Value);
        Assert.DoesNotContain("Zelda", json);
        Assert.DoesNotContain("0499", json);
    }

    [Fact]
    public async Task Get_a_direct_intakes_id_is_not_found()
    {
        var draft = new Participant { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Dee", LastName = "Rect", IsDraft = true };
        _db.Participants.Add(draft);
        _db.SaveChanges();

        Assert.IsType<NotFoundObjectResult>((await Controller().Get(draft.Id, CancellationToken.None)).Result);
    }

    [Fact]
    public void GET_inquiries_by_id_is_for_the_roles_that_edit_enquiries() =>
        Assert.Equal("Admin,Coordinator,SuperAdmin",
            typeof(ParticipantInquiriesController).GetMethod(nameof(ParticipantInquiriesController.Get))!.GetCustomAttribute<AuthorizeAttribute>()!.Roles);

    [Fact]
    public async Task The_list_never_carries_contacts()
    {
        var inquiry = SeedInquiry();
        SeedContacts(inquiry, new InquiryContact { Role = ContactRoleType.Guardian, FirstName = "Zelda", LastName = "Quill", Phone = "0499 111 222", Email = "zelda@example.com" });

        var result = (await Controller("SupportWorker").GetAll(CancellationToken.None)).Result;

        var json = JsonSerializer.Serialize(Assert.IsType<OkObjectResult>(result).Value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Contains("\"Ana\"", json);
        foreach (var leaked in new[] { "Zelda", "0499 111 222", "zelda@example.com", "\"contacts\"" }) Assert.DoesNotContain(leaked, json);
    }

    private static readonly InquiryContact[] MariaAndTom =
    [
        new() { Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez", Phone = "0412 345 678", Email = "maria@example.com", Relationship = "Mother", Notes = "Works nights" },
        new() { Role = ContactRoleType.EmergencyContact, FirstName = "Tom", LastName = "Ng" },
    ];

    private List<ParticipantContactRole> RolesOf(Guid participantId) =>
        _db.ParticipantContactRoles.AsNoTracking().Include(r => r.Person).Where(r => r.ParticipantId == participantId).OrderBy(r => r.Person!.FirstName).ToList();

    [Fact]
    public async Task Convert_moves_each_pending_contact_onto_the_new_participant_and_deletes_it()
    {
        var inquiry = SeedInquiry();
        SeedContacts(inquiry, MariaAndTom.Select(c => new InquiryContact { Role = c.Role, FirstName = c.FirstName, LastName = c.LastName, Phone = c.Phone, Email = c.Email, Relationship = c.Relationship, Notes = c.Notes }).ToArray());

        var dto = Data<ParticipantInquiryDto>((await Controller().Convert(inquiry.Id, new(), CancellationToken.None)).Result);

        var roles = RolesOf(dto.ParticipantId!.Value);
        Assert.Equal(2, roles.Count);
        var (maria, tom) = (roles[0], roles[1]);
        Assert.Equal(("Maria", "Lopez", "0412 345 678", "maria@example.com", _tenantId), (maria.Person!.FirstName, maria.Person.LastName, maria.Person.Phone, maria.Person.Email, maria.Person.TenantId));
        Assert.Equal((ContactRoleType.Guardian, "Mother", "Works nights", false, ContactRoleStatus.Active, _tenantId), (maria.RoleType, maria.RelationshipToParticipant, maria.Notes, maria.IsPrimary, maria.Status, maria.TenantId));
        Assert.Equal(("Tom", "Ng", (string?)null, ContactRoleType.EmergencyContact, false, ContactRoleStatus.Active), (tom.Person!.FirstName, tom.Person.LastName, tom.Person.Phone, tom.RoleType, tom.IsPrimary, tom.Status));
        Assert.Equal(2, _db.People.AsNoTracking().Count());
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task Convert_onto_an_existing_participant_moves_them_onto_that_one_and_does_not_add_one_it_already_has()
    {
        var existing = new Participant { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Ana", LastName = "Lopez", PlanType = PlanType.PlanManaged };
        var tomPerson = new Person { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Tom", LastName = "Ng" };
        _db.Participants.Add(existing);
        _db.People.Add(tomPerson);
        _db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = _tenantId, ParticipantId = existing.Id, PersonId = tomPerson.Id, RoleType = ContactRoleType.EmergencyContact });
        var inquiry = SeedInquiry();
        SeedContacts(inquiry,
            new InquiryContact { Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez" },
            new InquiryContact { Role = ContactRoleType.EmergencyContact, FirstName = " tom ", LastName = "NG" });

        var dto = Data<ParticipantInquiryDto>((await Controller().Convert(inquiry.Id, new() { ParticipantId = existing.Id }, CancellationToken.None)).Result);

        Assert.Equal(existing.Id, dto.ParticipantId);
        Assert.Equal(new[] { "Maria", "Tom" }, RolesOf(existing.Id).Select(r => r.Person!.FirstName));
        Assert.Empty(Stored());
    }

    [Fact]
    public async Task Convert_onto_an_existing_participant_refuses_a_contact_its_rules_do_not_allow_and_moves_nothing()
    {
        // Plan check S1: a pending Plan Nominee on an under-18 participant must not bypass ContactRoleRules.
        var child = new Participant { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Kai", LastName = "Lopez", DateOfBirth = new DateOnly(2016, 3, 1) };
        _db.Participants.Add(child);
        var inquiry = SeedInquiry();
        SeedContacts(inquiry, new InquiryContact { Role = ContactRoleType.PlanNominee, FirstName = "Maria", LastName = "Lopez" });

        var result = (await Controller().Convert(inquiry.Id, new() { ParticipantId = child.Id }, CancellationToken.None)).Result;

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal("Maria Lopez can't be added as this participant's contact: Plan Nominee is not available for a participant under 18 — use Child Representative instead.",
            Assert.Single(Assert.IsType<ApiResponse<ParticipantInquiryDto>>(conflict.Value).Errors!));
        _db.ChangeTracker.Clear();
        Assert.Null(_db.ParticipantInquiries.AsNoTracking().Single(x => x.Id == inquiry.Id).ParticipantId);
        Assert.Empty(RolesOf(child.Id));
        Assert.Single(Stored());
    }

    [Fact]
    public async Task Converting_again_moves_nothing_twice()
    {
        var inquiry = SeedInquiry();
        SeedContacts(inquiry, MariaAndTom.Select(c => new InquiryContact { Role = c.Role, FirstName = c.FirstName, LastName = c.LastName }).ToArray());

        var first = Data<ParticipantInquiryDto>((await Controller().Convert(inquiry.Id, new(), CancellationToken.None)).Result);
        _db.ChangeTracker.Clear();
        var again = Data<ParticipantInquiryDto>((await Controller().Convert(inquiry.Id, new(), CancellationToken.None)).Result);

        Assert.Equal(first.ParticipantId, again.ParticipantId);
        Assert.Equal(2, _db.ParticipantContactRoles.AsNoTracking().Count());
        Assert.Equal(2, _db.People.AsNoTracking().Count());
    }

    [Fact]
    public void Every_role_a_pending_contact_may_have_passes_the_contact_gate_for_a_new_draft()
    {
        Assert.Equal(PlanType.SelfManaged, new Participant().PlanType);
        foreach (var role in Enum.GetValues<ContactRoleType>().Where(r => r != ContactRoleType.PlanManager))
            Assert.Null(ContactRoleRules.Validate(role, PlanType.SelfManaged, null, null));
    }

    [Fact]
    public async Task Update_answers_with_the_booked_staff_members_names()
    {
        var sam = new User { Id = Guid.NewGuid(), TenantId = _tenantId, Username = "sam", Email = "sam@example.com", FirstName = "Sam", LastName = "Lee", Role = UserRole.Admin, IsActive = true };
        _db.Users.Add(sam);
        var inquiry = SeedInquiry();
        inquiry.IntakeStartsAt = IntakeBookingsControllerTests.Start; inquiry.IntakeDurationMinutes = 90; inquiry.IntakeStaffUserId = sam.Id;
        _db.SaveChanges();

        var dto = Data<ParticipantInquiryDto>((await Controller().Update(inquiry.Id, UpdateBody(null), CancellationToken.None)).Result);
        Assert.Equal(("Sam Lee", "Sam"), (dto.IntakeStaffName, dto.IntakeStaffFirstName));
        Assert.Equal("Australia/Sydney", dto.TimeZoneId);
    }
}
