using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class OnboardingImportStaffTests
{
    private const string Header = "First name,Last name,Email";

    private static (OdipDbContext Db, Guid TenantId) TwoOrganisations()
    {
        var own = new Tenant { Id = Guid.NewGuid(), Name = "Own", EmailDomain = "own.example.com", IsActive = true, CreatedAt = DateTime.UtcNow };
        var other = new Tenant { Id = Guid.NewGuid(), Name = "Other", EmailDomain = "other.example.org", IsActive = true, CreatedAt = DateTime.UtcNow };
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), own.Id);
        db.Tenants.AddRange(own, other);
        db.Users.AddRange(
            new User { Id = Guid.NewGuid(), TenantId = own.Id, FirstName = "Kim", LastName = "Tan", Username = "ktan", Email = "kim@own.example.com", Role = UserRole.SupportWorker },
            new User { Id = Guid.NewGuid(), TenantId = other.Id, FirstName = "Sam", LastName = "Lee", Username = "slee", Email = "sam.lee@gmail.com", Role = UserRole.SupportWorker });
        db.SaveChanges();
        return (db, own.Id);
    }

    private static Task<ImportPreviewDto> Preview(OdipDbContext db, Guid tenantId, byte[] file) =>
        Service(db, tenantId).PreviewAsync(ImportKind.Staff, file, "staff.csv", null, CancellationToken.None, Admin());

    [Fact]
    public async Task Staff_preview_still_warns_about_an_unusual_address_when_the_organisation_has_no_domain()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        (await db.Tenants.SingleAsync(t => t.Id == tenantId)).EmailDomain = null;
        await db.SaveChangesAsync();

        var rows = (await Preview(db, tenantId, Csv(Header, "Lee,Ho,lee@unusual.example.net", "Jo,Ng,jo.ng@gmail.com"))).Rows;

        Assert.StartsWith("This address is at neither your organisation's email domain", rows[0].Warnings.Single());
        Assert.Empty(rows[1].Warnings);
    }

    [Fact]
    public async Task Staff_preview_skips_an_email_already_here_and_refuses_one_used_elsewhere()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var rows = (await Preview(db, tenantId, Csv(Header,
            "Kim,Tan,KIM@own.example.com", "Sam,Lee,sam.lee@gmail.com", "Pat,Ng,pat@other.example.org", "Jo,Ng,jo@own.example.com", "Lee,Ho,lee@unusual.example.net"))).Rows;

        Assert.Equal((ImportRowStatus.Skipped, "Already in Bunya Support as Kim Tan."), (rows[0].Status, rows[0].SkipReason));
        // Said without naming the organisation or the person there.
        Assert.Equal("This email belongs to another organisation.", rows[1].Reasons.Single());
        Assert.Equal(StaffCreateService.OtherOrganisationMessage, rows[2].Reasons.Single());
        Assert.Equal((ImportRowStatus.Ready, 0), (rows[3].Status, rows[3].Warnings.Count));
        Assert.Equal(ImportRowStatus.Ready, rows[4].Status);
        Assert.StartsWith("This address is at neither your organisation's email domain", rows[4].Warnings.Single());
    }

    [Fact]
    public async Task Staff_preview_flags_the_same_email_twice()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var rows = (await Preview(db, tenantId, Csv(Header, "Jo,Ng,jo@own.example.com", "Jo,Ng,JO@Own.Example.com"))).Rows;
        Assert.Equal(ImportRowStatus.Ready, rows[0].Status);
        Assert.Equal("The same email is on row 2.", rows[1].Reasons.Single());
    }

    [Fact]
    public async Task Staff_commit_creates_active_support_workers_with_free_usernames_and_imports_a_warned_address()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var result = await Service(db, tenantId).CommitAsync(ImportKind.Staff,
            Csv(Header, "Sam,Lee,sam.lee@own.example.com", "Sam,Lee,sam.lee2@own.example.com", "Lee,Ho,lee@unusual.example.net"),
            "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);

        Assert.Equal(3, result.CreatedCount);
        var created = await db.Users.Where(u => u.Email.EndsWith("own.example.com") || u.Email.EndsWith("unusual.example.net")).Where(u => u.LastName != "Tan").ToListAsync();
        Assert.Equal(3, created.Select(u => u.Username).Distinct().Count());
        Assert.All(created, u => Assert.Equal((tenantId, true, UserRole.SupportWorker), (u.TenantId, u.IsActive, u.Role)));
        Assert.All(await db.ImportBatchItems.ToListAsync(), i => Assert.Equal(nameof(User), i.EntityType));
    }

    [Fact]
    public async Task A_staff_commit_needs_no_landing_and_refuses_an_email_another_organisation_took_since_the_preview()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var result = await Service(db, tenantId).CommitAsync(ImportKind.Staff, Csv(Header, "Jo,Ng,jo@own.example.com", "Sam,Lee,SAM.LEE@gmail.com"),
            "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);

        Assert.Equal((1, 1), (result.CreatedCount, result.FailedCount));
        Assert.Equal("This email belongs to another organisation.", result.Rows[1].Reasons.Single());
        Assert.Equal(1, await db.Users.IgnoreQueryFilters().CountAsync(u => u.Email.ToLower() == "sam.lee@gmail.com"));
    }

    [Fact]
    public async Task Undo_deletes_untouched_staff_so_their_emails_can_be_imported_again()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var service = Service(db, tenantId);
        var file = Csv(Header, "Jo,Ng,jo@own.example.com", "Al,Wu,al@own.example.com");
        var first = await service.CommitAsync(ImportKind.Staff, file, "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);

        var outcome = await service.UndoAsync(first.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.NotNull(outcome.Batch!.UndoneAt);
        Assert.False(await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == "jo@own.example.com" || u.Email == "al@own.example.com"));
        Assert.True(await db.Users.AnyAsync(u => u.Email == "kim@own.example.com"));
        Assert.Equal(2, (await service.CommitAsync(ImportKind.Staff, file, "staff.csv", null, null, "key-2", Admin(), CancellationToken.None)).CreatedCount);
    }

    [Fact]
    public async Task Staff_undo_is_refused_when_someone_signed_in_or_was_rostered()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Staff, Csv(Header, "Jo,Ng,jo@own.example.com", "Al,Wu,al@own.example.com"), "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);
        (await db.Users.SingleAsync(u => u.Email == "jo@own.example.com")).LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Equal(("Jo Ng", "has signed in"), (outcome.Blockers.Single().Name, outcome.Blockers.Single().Reason));
        Assert.Equal(2, await db.Users.CountAsync(u => u.Email.EndsWith("@own.example.com") && u.LastName != "Tan"));
        Assert.Null((await db.ImportBatches.SingleAsync()).UndoneAt);
    }
}
