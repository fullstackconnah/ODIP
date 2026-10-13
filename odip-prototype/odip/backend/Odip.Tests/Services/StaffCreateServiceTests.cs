using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>POST /staff as a service: the address, role and uniqueness rules, unchanged by the move.</summary>
public class StaffCreateServiceTests
{
    private static ClaimsPrincipal As(string role) => new(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "Test"));

    private static (OdipDbContext Db, Guid TenantId) TwoOrganisations()
    {
        var own = new Tenant { Id = Guid.NewGuid(), Name = "Own", EmailDomain = "own.example.com", IsActive = true, CreatedAt = DateTime.UtcNow };
        var other = new Tenant { Id = Guid.NewGuid(), Name = "Other", EmailDomain = "other.example.org", IsActive = true, CreatedAt = DateTime.UtcNow };
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), own.Id);
        db.Tenants.AddRange(own, other);
        db.Users.Add(new User { Id = Guid.NewGuid(), TenantId = other.Id, FirstName = "Sam", LastName = "Lee", Username = "slee", Email = "sam.lee@gmail.com", Role = UserRole.SupportWorker });
        db.SaveChanges();
        return (db, own.Id);
    }

    private static CreateStaffDto Staff(string email, UserRole role = UserRole.SupportWorker) => new() { FirstName = "Jo", LastName = "Ng", Email = email, Role = role };

    [Fact]
    public async Task Stage_tracks_the_user_with_a_normalised_email_and_a_free_username()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var result = await new StaffCreateService(db, null).StageAsync(Staff(" Jo.Ng@Own.Example.com "), As("Admin"), tenantId, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal("jo.ng@own.example.com", result.User!.Email);
        Assert.NotEqual("slee", result.User.Username);
        Assert.False(string.IsNullOrWhiteSpace(result.User.Username));
        Assert.Equal(1, await db.Users.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Stage_answers_conflict_for_an_email_used_in_another_organisation()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var result = await new StaffCreateService(db, null).StageAsync(Staff("Sam.Lee@gmail.com"), As("Admin"), tenantId, CancellationToken.None);
        Assert.True(result.IsConflict);
        Assert.Equal(StaffCreateService.EmailTakenMessage, result.Error);
    }

    [Fact]
    public async Task Stage_refuses_another_organisations_domain()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var result = await new StaffCreateService(db, null).StageAsync(Staff("jo@other.example.org"), As("Admin"), tenantId, CancellationToken.None);
        Assert.Equal(StaffCreateService.OtherOrganisationMessage, result.Error);
    }

    [Fact]
    public async Task Stage_refuses_the_admin_role_to_a_coordinator_and_asks_to_confirm_an_unusual_domain()
    {
        var (db, tenantId) = TwoOrganisations();
        using var _ = db;
        var service = new StaffCreateService(db, null);
        Assert.Equal("Only an Admin can assign the Admin role.",
            (await service.StageAsync(Staff("jo@own.example.com", UserRole.Admin), As("Coordinator"), tenantId, CancellationToken.None)).Error);
        Assert.Equal(AddressConfirmation.Code,
            (await service.StageAsync(Staff("jo@unusual.example.net"), As("Admin"), tenantId, CancellationToken.None)).ErrorCode);
    }
}
