using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
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

    // Fails the save at the contact roles' INSERT: everything else in that SaveChanges (the participant, the people, the deletes) must roll back with it.
    private sealed class FailOn(string marker) : DbCommandInterceptor
    {
        private ValueTask<T> Guard<T>(DbCommand c, ValueTask<T> next) => c.CommandText.Contains(marker, StringComparison.Ordinal) ? throw new InvalidOperationException("injected") : next;
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand c, CommandEventData d, InterceptionResult<DbDataReader> r, CancellationToken ct = default) => Guard(c, base.ReaderExecutingAsync(c, d, r, ct));
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand c, CommandEventData d, InterceptionResult<int> r, CancellationToken ct = default) => Guard(c, base.NonQueryExecutingAsync(c, d, r, ct));
    }

    [SkippableFact]
    public async Task Converting_moves_the_contacts_in_the_same_transaction_as_the_participant()
    {
        RequirePostgres();
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone" };
        await using (seed)
        {
            seed.ParticipantInquiries.Add(inquiry);
            seed.InquiryContacts.AddRange(
                new InquiryContact { Id = Guid.NewGuid(), TenantId = tenantId, InquiryId = inquiry.Id, SortOrder = 0, Role = ContactRoleType.Guardian, FirstName = "Maria", LastName = "Lopez" },
                new InquiryContact { Id = Guid.NewGuid(), TenantId = tenantId, InquiryId = inquiry.Id, SortOrder = 1, Role = ContactRoleType.NextOfKin, FirstName = "Tom", LastName = "Ng" });
            await seed.SaveChangesAsync();
        }
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        OdipDbContext Context(params IInterceptor[] interceptors) =>
            new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, tenant.Object);

        await using (var failing = Context(new FailOn("INSERT INTO \"ParticipantContactRoles\"")))
            await Assert.ThrowsAnyAsync<Exception>(() => new ParticipantInquiriesController(failing, tenant.Object).Convert(inquiry.Id, new(), CancellationToken.None));
        await using (var check = Context())
        {
            Assert.Null((await check.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id)).ParticipantId);
            Assert.False(await check.Participants.AnyAsync(p => p.TenantId == tenantId));
            Assert.Equal(2, await check.InquiryContacts.CountAsync(c => c.InquiryId == inquiry.Id));
        }
        await using (var db = Context())
        {
            Assert.IsType<OkObjectResult>((await new ParticipantInquiriesController(db, tenant.Object).Convert(inquiry.Id, new(), CancellationToken.None)).Result);
            db.ChangeTracker.Clear();
            Assert.Equal(new[] { "Maria", "Tom" }, await db.ParticipantContactRoles.Where(r => r.TenantId == tenantId).Select(r => r.Person!.FirstName).OrderBy(n => n).ToListAsync());
            Assert.Equal(0, await db.InquiryContacts.CountAsync(c => c.InquiryId == inquiry.Id));
        }
    }

    private (OdipDbContext Db, ParticipantInquiriesController Controller) Request(Guid tenantId, params IInterceptor[] interceptors)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).AddInterceptors(interceptors).Options, tenant.Object);
        return (db, new ParticipantInquiriesController(db, tenant.Object));
    }

    private static UpdateParticipantInquiryDto Form(DateTime? expected, params (ContactRoleType Role, string First)[] contacts) => new()
    {
        FirstName = "Ana", LastName = "Lopez", Source = "Phone", ExpectedUpdatedAt = expected,
        Contacts = contacts.Select(c => new InquiryContactDto { Role = c.Role, FirstName = c.First, LastName = "Lopez" }).ToList(),
    };

    // Deep review S2: two coordinators have the enquiry open; the second save must not bring back a contact the first removed.
    [SkippableFact]
    public async Task Two_forms_on_one_enquiry_the_second_save_is_a_409_and_a_removed_contact_never_comes_back()
    {
        RequirePostgres();
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone" };
        await using (seed)
        {
            seed.ParticipantInquiries.Add(inquiry);
            seed.InquiryContacts.Add(new InquiryContact { Id = Guid.NewGuid(), TenantId = tenantId, InquiryId = inquiry.Id, Role = ContactRoleType.NextOfKin, FirstName = "Dad", LastName = "Lopez" });
            await seed.SaveChangesAsync();
        }
        DateTime loadedA, loadedB;
        { var (db, c) = Request(tenantId); await using var _ = db; loadedA = Assert.IsType<ApiResponse<Odip.Application.DTOs.ParticipantInquiryDetailDto>>(Assert.IsType<OkObjectResult>((await c.Get(inquiry.Id, CancellationToken.None)).Result).Value).Data!.UpdatedAt; }
        { var (db, c) = Request(tenantId); await using var _ = db; loadedB = Assert.IsType<ApiResponse<Odip.Application.DTOs.ParticipantInquiryDetailDto>>(Assert.IsType<OkObjectResult>((await c.Get(inquiry.Id, CancellationToken.None)).Result).Value).Data!.UpdatedAt; }

        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<OkObjectResult>((await c.Update(inquiry.Id, Form(loadedA, (ContactRoleType.Guardian, "Mei")), CancellationToken.None)).Result); }
        { var (db, c) = Request(tenantId); await using var _ = db; Assert.IsType<ConflictObjectResult>((await c.Update(inquiry.Id, Form(loadedB, (ContactRoleType.NextOfKin, "Dad")), CancellationToken.None)).Result); }

        var (check, _c) = Request(tenantId);
        await using (check)
            Assert.Equal(new[] { "Mei" }, await check.InquiryContacts.Where(x => x.InquiryId == inquiry.Id).Select(x => x.FirstName).ToListAsync());
    }

    /// <summary>Runs <paramref name="other"/> once, just before this context's save sends its first command: another request committing in between.</summary>
    private sealed class Interleave(Func<Task> other) : DbCommandInterceptor
    {
        private bool _done;
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand c, CommandEventData d, InterceptionResult<DbDataReader> r, CancellationToken ct = default)
        {
            if (!_done && (c.CommandText.Contains("INSERT INTO \"InquiryContacts\"", StringComparison.Ordinal) || c.CommandText.Contains("UPDATE \"ParticipantInquiries\"", StringComparison.Ordinal)))
            {
                _done = true;
                await other();
            }
            return r;
        }
    }

    // Deep review S1: a contacts save that loaded the enquiry before Start intake committed must not leave pending rows on a converted enquiry.
    [SkippableFact]
    public async Task A_contacts_save_racing_Start_intake_loses_and_strands_nothing()
    {
        RequirePostgres();
        var (seed, tenantId) = await _pg.NewTenantContextAsync();
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ana", LastName = "Lopez", Source = "Phone" };
        await using (seed)
        {
            seed.ParticipantInquiries.Add(inquiry);
            await seed.SaveChangesAsync();
        }
        var converted = false;
        var (db, controller) = Request(tenantId, new Interleave(async () =>
        {
            var (other, convert) = Request(tenantId);
            await using var _ = other;
            converted = (await convert.Convert(inquiry.Id, new(), CancellationToken.None)).Result is OkObjectResult;
        }));
        await using (db)
            Assert.IsType<ConflictObjectResult>((await controller.Update(inquiry.Id, Form(null, (ContactRoleType.Guardian, "Mei")), CancellationToken.None)).Result);

        Assert.True(converted);
        var (check, _c) = Request(tenantId);
        await using (check)
        {
            Assert.NotNull((await check.ParticipantInquiries.SingleAsync(x => x.Id == inquiry.Id)).ParticipantId);
            Assert.Equal(0, await check.InquiryContacts.CountAsync(x => x.InquiryId == inquiry.Id));
        }
    }
}
