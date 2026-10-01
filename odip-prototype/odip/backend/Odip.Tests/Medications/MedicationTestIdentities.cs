using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Tests.Medications;

/// <summary>
/// Recording ANY medication administration now needs a current Medication Competency credential on the
/// recording user (the D3 gate), for every role. Tests that exercise the recording path (rather than the gate
/// itself) need an identity that holds it; this seeds one.
/// </summary>
internal static class MedicationTestIdentities
{
    /// <summary>A staff user whose Medication Competency is current (ticked, expiry far in the future).</summary>
    public static User SeedCompetentUser(
        OdipDbContext db, string firstName = "Casey", string lastName = "Recorder", Guid? id = null, Guid? tenantId = null,
        UserRole role = UserRole.SupportWorker)
    {
        var user = new User
        {
            Id = id ?? Guid.NewGuid(), TenantId = tenantId ?? Guid.Empty,
            Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = firstName, LastName = lastName, Role = role, IsActive = true,
            IsMedicationCompetent = true, MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChanges();
        return user;
    }
}
