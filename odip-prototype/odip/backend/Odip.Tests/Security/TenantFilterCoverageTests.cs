using System.Linq.Expressions;
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
        ["ParticipantGroupRevision"] = "through its participant",
        ["IncidentInjury"] = "through its incident",
        ["IncidentWitness"] = "through its incident, and own-row for the witness",
        ["TripClaim"] = "through its trip (Trip claims) or participant (Shift claims): ClaimsController.TenantClaims",
        ["ClaimLineItem"] = "through its claim",
        ["ImportBatchItem"] = "through its batch (ImportBatch is filtered)",
        ["ServiceAgreementDraftBlock"] = "through its draft (ServiceAgreementDraft is filtered)",
        ["ServiceAgreementDraftLine"] = "through its draft (ServiceAgreementDraft is filtered)",
        ["AuditLog"] = "read only through AuditController, which checks the audited entity first",
        // Shared on purpose.
        ["SupportCatalogueItem"] = "the NDIS catalogue, the same for every provider; written by SuperAdmin only",
        ["SupportActivityGroup"] = "the NDIS catalogue, the same for every provider; written by SuperAdmin only",
        ["PublicHoliday"] = "a state's calendar, the same for every provider; written by SuperAdmin only",
        ["PublicHolidayOverride"] = "a state's calendar, the same for every provider; written by the owner",
        ["Tenant"] = "the organisation table itself, written by SuperAdmin only (TenantsController, AdminUsersController); read across organisations on purpose for sign-in and the email-domain checks",
        ["WhatsNewEntry"] = "release notes from Bunya Support, the same for every organisation; written by SuperAdmin only",
        ["WhatsNewUserState"] = "one person's What's new read marks, keyed by user, read and written only for the signed-in user",
        ["EarlyAccessRequest"] = "anonymous public submissions with no tenant (see the comment on its mapping)",
        ["EarlyAccessLaterSubmission"] = "a repeat of an anonymous public submission, read only through its sign-up (EarlyAccessRequest)",
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

        // Unfiltered means no declared filter named TenantFilter.Name: a soft-delete filter alongside it does not count as tenant filtering.
        var unfiltered = db.Model.GetEntityTypes()
            .Where(t => t.BaseType == null && !t.GetDeclaredQueryFilters().Any(f => f.Key == TenantFilter.Name))
            .Select(t => t.ClrType.Name)
            .ToHashSet();

        var missing = unfiltered.Except(Unfiltered.Keys).Order().ToList();
        Assert.True(missing.Count == 0, "No tenant query filter and not on the allow-list (filter it, or add it with the reason it is safe): " + string.Join(", ", missing));

        // The filter named TenantFilter.Name must compare TenantId. Other named filters (soft delete, say) are allowed.
        var notTenantFilters = db.Model.GetEntityTypes()
            .Where(t => t.BaseType == null && t.GetDeclaredQueryFilters().Any(f => f.Key == TenantFilter.Name && !(f.Expression is { } filter && ComparesTenantId(filter))))
            .Select(t => t.ClrType.Name).Order().ToList();
        Assert.True(notTenantFilters.Count == 0, "Has a tenant query filter that does not compare the entity's TenantId: " + string.Join(", ", notTenantFilters));

        var stale = Unfiltered.Keys.Except(unfiltered).Order().ToList();
        Assert.True(stale.Count == 0, "On the allow-list but now filtered or gone, remove: " + string.Join(", ", stale));
    }

    private sealed class Probe { public Guid TenantId { get; set; } public string Name { get; set; } = ""; }

    [Fact]
    public void ATenantFilter_IsTold_FromOneThatIsNotAboutTheTenant()
    {
        var current = Guid.NewGuid();
        Expression<Func<Probe, bool>> tenant = e => e.TenantId == current;
        Expression<Func<Probe, bool>> other = e => e.Name != "x" && current != Guid.Empty;

        Assert.True(ComparesTenantId(tenant));
        Assert.False(ComparesTenantId(other));
    }

    private static bool ComparesTenantId(LambdaExpression filter)
    {
        var finder = new TenantIdFinder(filter.Parameters[0]);
        finder.Visit(filter.Body);
        return finder.Found;
    }

    private sealed class TenantIdFinder(ParameterExpression entity) : ExpressionVisitor
    {
        public bool Found { get; private set; }

        protected override Expression VisitMember(MemberExpression node)
        {
            if (node.Member.Name == "TenantId" && node.Expression == entity) Found = true;
            return base.VisitMember(node);
        }
    }
}
