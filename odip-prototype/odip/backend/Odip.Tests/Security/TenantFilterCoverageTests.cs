using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// Every entity either has a tenant query filter or is on the short, named list below, with the reason it is safe. A table added without a filter fails here, so its author must
/// either filter it or say in one line why it needs none. An entity on the list that has since been filtered, or removed, fails too, so the list cannot go stale.
///
/// "Through the trip" and the like mean the endpoints that read or write the entity by an id start from a tenant-filtered parent and answer "not found" for another organisation's row
/// (see the CrossTenant*Tests files, one test per route). Adding a TenantId column to these is a migration on live data and is deliberately not done yet.
/// </summary>
public class TenantFilterCoverageTests
{
    private static readonly Dictionary<string, string> Unfiltered = new()
    {
        // Reached only through a tenant-filtered parent.
        ["AccommodationReservation"] = "through its trip",
        ["ParticipantBooking"] = "through its trip",
        ["StaffAssignment"] = "through its trip",
        ["VehicleAssignment"] = "through its trip",
        ["TripDay"] = "through its trip",
        ["ScheduledActivity"] = "through its trip day",
        ["TripDocument"] = "through its trip",
        ["StaffAvailability"] = "through its user",
        ["SupportProfile"] = "through its participant",
        ["IncidentReport"] = "through its reporting user (a required join on reads, TenantIncidents on writes)",
        ["IncidentInjury"] = "through its incident",
        ["IncidentWitness"] = "through its incident, and own-row for the witness",
        ["TripClaim"] = "through its trip (Trip claims) or participant (Shift claims): ClaimsController.TenantClaims",
        ["ClaimLineItem"] = "through its claim",
        ["ServiceAgreementDraftBlock"] = "through its draft (ServiceAgreementDraft is filtered)",
        ["ServiceAgreementDraftLine"] = "through its draft (ServiceAgreementDraft is filtered)",
        ["ServiceBookingLine"] = "through its service booking (ServiceBooking is filtered)",
        ["AuditLog"] = "read only through AuditController, which checks the audited entity first",
        // Shared on purpose.
        ["Activity"] = "the shared activity library; per organisation or shared is the owner's decision (audit B1-2)",
        ["SupportCatalogueItem"] = "the NDIS catalogue, the same for every provider; written by SuperAdmin only",
        ["SupportActivityGroup"] = "the NDIS catalogue, the same for every provider; written by SuperAdmin only",
        ["PublicHoliday"] = "a state's calendar, the same for every provider; written by SuperAdmin only",
        ["PublicHolidayOverride"] = "a state's calendar, the same for every provider; written by the owner",
        ["Tenant"] = "the organisation table itself; TenantsController and AdminUsersController are SuperAdmin only",
        ["EarlyAccessRequest"] = "anonymous public submissions with no tenant (see the comment on its mapping)",
        // Legacy.
        ["Contact"] = "legacy; no endpoint reads or writes it, only the seeder",
        ["ParticipantContact"] = "legacy; no endpoint reads or writes it, only the seeder",
    };

    [Fact]
    public void EveryEntityHasAQueryFilterOrIsOnTheNamedAllowList()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        using var db = new OdipDbContext(options, tenant.Object);

        var unfiltered = db.Model.GetEntityTypes()
            .Where(t => t.BaseType == null && t.GetQueryFilter() == null)
            .Select(t => t.ClrType.Name)
            .ToHashSet();

        var missing = unfiltered.Except(Unfiltered.Keys).Order().ToList();
        Assert.True(missing.Count == 0, "No query filter and not on the allow-list (filter it, or add it with the reason it is safe): " + string.Join(", ", missing));

        var stale = Unfiltered.Keys.Except(unfiltered).Order().ToList();
        Assert.True(stale.Count == 0, "On the allow-list but now filtered or gone, remove: " + string.Join(", ", stale));
    }
}
