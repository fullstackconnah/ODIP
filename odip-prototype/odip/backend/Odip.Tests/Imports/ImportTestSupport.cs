using System.Security.Claims;
using System.Text;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Tests.Imports;

/// <summary>One place that builds the import service, so a new dependency changes one line.</summary>
internal static class ImportTestSupport
{
    public static readonly Guid AdminId = Guid.Parse("a0000000-0000-0000-0000-00000000ad01");

    public static ICurrentTenant Tenant(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    public static OnboardingImportService Service(OdipDbContext db, Guid tenantId) => Service(db, Tenant(tenantId));

    public static OnboardingImportService Service(OdipDbContext db, ICurrentTenant tenant) =>
        new(db, tenant,
            new ParticipantCreateService(db, new StaffCompatibilityLinkService(db), new SafetyNoteSyncService(db), new ParticipantIntakeSnapshotService(db), TimeProvider.System),
            new StaffCreateService(db, null),
            new FundingPlanService(db, TimeProvider.System),
            TimeProvider.System, null, new RosterWeekStarter(new RosterShiftGenerator(), new RosterAvailability(db, new StaffUnavailabilityQuery(db))),
            new RosterAvailability(db, new StaffUnavailabilityQuery(db)));

    public static byte[] Csv(params string[] lines) => Encoding.UTF8.GetBytes(string.Join("\r\n", lines) + "\r\n");

    public static ClaimsPrincipal Admin() => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.Role, "Admin"), new Claim(ClaimTypes.NameIdentifier, AdminId.ToString()), new Claim("fullName", "Ada Admin")], "Test"));
}
