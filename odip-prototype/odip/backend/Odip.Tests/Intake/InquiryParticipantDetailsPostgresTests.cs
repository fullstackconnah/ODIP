using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>An enquiry's participant details and main contact against a real PostgreSQL (spec 2026-10-16 redesign, L1): the columns and the migration's defaults.</summary>
public class InquiryParticipantDetailsPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InquiryParticipantDetailsPostgresTests(PostgresFixture pg) => _pg = pg;
    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    [SkippableFact]
    public async Task The_new_columns_round_trip_at_their_full_lengths()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var inquiry = new ParticipantInquiry
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ari", LastName = "", Source = "Phone",
            ContactFirstName = new string('f', 100), ContactLastName = new string('l', 100), ContactRelationship = new string('r', 100),
            ContactRole = ContactRoleType.Guardian, ContactIsParticipant = true,
            DateOfBirth = new DateOnly(2014, 3, 12), NdisNumber = new string('9', 20),
            AddressStreet = new string('s', 200), AddressSuburb = new string('b', 100), AddressState = "NSW", AddressPostcode = "2150",
            PlanType = PlanType.AgencyManaged, PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
        };
        db.ParticipantInquiries.Add(inquiry);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var r = await db.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id);
        Assert.Equal("", r.LastName);
        Assert.Equal((100, 100, 100), (r.ContactFirstName!.Length, r.ContactLastName!.Length, r.ContactRelationship!.Length));
        Assert.Equal(ContactRoleType.Guardian, r.ContactRole);
        Assert.True(r.ContactIsParticipant);
        Assert.Equal(new DateOnly(2014, 3, 12), r.DateOfBirth);
        Assert.Equal(new string('9', 20), r.NdisNumber);
        Assert.Equal((200, 100, "NSW", "2150"), (r.AddressStreet!.Length, r.AddressSuburb!.Length, r.AddressState, r.AddressPostcode));
        Assert.Equal(PlanType.AgencyManaged, r.PlanType);
        Assert.Equal((new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30)), (r.PlanStartDate, r.PlanEndDate));
    }

    [SkippableFact]
    public async Task A_row_written_before_the_migration_reads_back_with_no_details_and_not_their_own_contact()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var id = Guid.NewGuid();
        // Only the columns that existed before AddInquiryParticipantDetails: the new ones take their defaults.
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO \"ParticipantInquiries\" (\"Id\", \"TenantId\", \"FirstName\", \"LastName\", \"Source\", \"CreatedAt\", \"UpdatedAt\", \"IntakeIcsSequence\") VALUES ({0}, {1}, 'Noah', 'Lee', 'Phone', now(), now(), 0)",
            id, tenantId);

        var r = await db.ParticipantInquiries.SingleAsync(x => x.Id == id);
        Assert.False(r.ContactIsParticipant);
        Assert.All(new object?[] { r.ContactFirstName, r.ContactLastName, r.ContactRelationship, r.ContactRole, r.DateOfBirth, r.NdisNumber,
            r.AddressStreet, r.AddressSuburb, r.AddressState, r.AddressPostcode, r.PlanType, r.PlanStartDate, r.PlanEndDate }, Assert.Null);
    }

    private (OdipDbContext Db, ParticipantInquiriesController Controller) Request(Guid tenantId, params IInterceptor[] interceptors)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, tenant.Object);
        return (db, new ParticipantInquiriesController(db, tenant.Object));
    }

    private async Task<DateTime> LoadedAsync(Guid tenantId, Guid id)
    {
        var (db, c) = Request(tenantId);
        await using var _ = db;
        return Assert.IsType<ApiResponse<ParticipantInquiryDetailDto>>(Assert.IsType<OkObjectResult>((await c.Get(id, CancellationToken.None)).Result).Value).Data!.UpdatedAt;
    }

    // L4 on PostgreSQL: the DateOnly binds and stores, the provider's today reads, and Start intake's own role gate reads the date of birth it copied.
    [SkippableFact]
    public async Task The_role_rules_use_the_stored_DOB_at_save_and_at_Start_intake()
    {
        RequirePostgres();
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        await seed.DisposeAsync();
        var form = new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", DateOfBirth = new DateOnly(2014, 3, 12), ContactFirstName = "Sarah", ContactLastName = "Walsh", ContactRole = ContactRoleType.PlanNominee };

        { var (db, c) = Request(tenantId); await using var _ = db; Assert.Contains("contactRole", Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>((await c.Create(form, CancellationToken.None)).Result).Value).Errors.Keys); }
        Guid id;
        { var (db, c) = Request(tenantId); await using var _ = db; id = Assert.IsType<ApiResponse<ParticipantInquiryDto>>(Assert.IsType<OkObjectResult>((await c.Create((form with { ContactRole = ContactRoleType.Guardian }).WithFullAddress(),CancellationToken.None)).Result).Value).Data!.Id; }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Convert(id, new(), CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
        {
            var role = await check.ParticipantContactRoles.Include(r => r.Participant).SingleAsync(r => r.TenantId == tenantId);
            Assert.Equal((ContactRoleType.Guardian, new DateOnly(2014, 3, 12)), (role.RoleType, role.Participant!.DateOfBirth));
        }
    }

    // Two coordinators have the enquiry open: the second save, loaded before the first, must not wipe the address the first one added.
    [SkippableFact]
    public async Task Two_editors_the_second_save_of_the_details_is_a_409_and_the_first_editors_address_stays()
    {
        RequirePostgres();
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ari", Source = "Phone" };
        await using (seed) { seed.ParticipantInquiries.Add(inquiry); await seed.SaveChangesAsync(); }
        var loadedA = await LoadedAsync(tenantId, inquiry.Id);
        var loadedB = await LoadedAsync(tenantId, inquiry.Id);

        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(inquiry.Id, new UpdateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ExpectedUpdatedAt = loadedB, ContactIsParticipant = false, AddressStreet = "12 Smith St", AddressSuburb = "Parramatta", AddressState = "NSW", AddressPostcode = "2150" }, CancellationToken.None)).Result); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Update(inquiry.Id, new UpdateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ExpectedUpdatedAt = loadedA, ContactIsParticipant = false, ContactFirstName = "Sarah" }, CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
        {
            var r = await check.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id);
            Assert.Equal(("12 Smith St", (string?)null), (r.AddressStreet, r.ContactFirstName));
        }
    }
}
