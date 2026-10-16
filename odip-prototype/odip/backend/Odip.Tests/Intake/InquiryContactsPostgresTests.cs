using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>An enquiry's pending contacts against a real PostgreSQL (spec 2026-10-16, D3): the columns, the cascade from the enquiry, and the move at Start intake.</summary>
public class InquiryContactsPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public InquiryContactsPostgresTests(PostgresFixture pg) => _pg = pg;
    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    [SkippableFact]
    public async Task A_pending_contact_round_trips_at_its_full_lengths()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone" };
        db.ParticipantInquiries.Add(inquiry);
        var contact = new InquiryContact
        {
            Id = Guid.NewGuid(), TenantId = tenantId, InquiryId = inquiry.Id, Role = ContactRoleType.Guardian,
            FirstName = new string('f', 100), LastName = new string('l', 100), Phone = new string('1', 30), Email = new string('e', 200),
            Relationship = new string('r', 100), Notes = new string('n', 2000),
        };
        db.InquiryContacts.Add(contact);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var read = await db.InquiryContacts.SingleAsync(c => c.Id == contact.Id);
        Assert.Equal((100, 100, 30, 200, 100, 2000), (read.FirstName.Length, read.LastName.Length, read.Phone!.Length, read.Email!.Length, read.Relationship!.Length, read.Notes!.Length));
        Assert.Equal(ContactRoleType.Guardian, read.Role);
    }

    // Any delete of an enquiry relies on this cascade; PR 2's close deletes the contacts explicitly in its own save.
    [SkippableFact]
    public async Task Deleting_an_enquiry_deletes_its_pending_contacts_in_the_database()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone" };
        db.ParticipantInquiries.Add(inquiry);
        db.InquiryContacts.Add(new InquiryContact { Id = Guid.NewGuid(), TenantId = tenantId, InquiryId = inquiry.Id, Role = ContactRoleType.NextOfKin, FirstName = "Maria", LastName = "Lopez" });
        await db.SaveChangesAsync();

        // Raw SQL, so the database's own ON DELETE CASCADE does it, not EF's tracked-dependents delete.
        await db.Database.ExecuteSqlRawAsync("DELETE FROM \"ParticipantInquiries\" WHERE \"Id\" = {0}", inquiry.Id);

        Assert.Equal(0, await db.InquiryContacts.IgnoreQueryFilters().CountAsync(c => c.InquiryId == inquiry.Id));
    }
}
