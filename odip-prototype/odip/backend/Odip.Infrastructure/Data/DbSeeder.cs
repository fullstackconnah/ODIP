using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

/// <summary>
/// Seeds realistic Australian NDIS sample data for development and demonstration.
/// </summary>
public static partial class DbSeeder
{
    /// <summary>
    /// Checks whether ANY of the tables that <see cref="SeedAsync"/> populates via
    /// AddRange-with-fixed-GUIDs already contain rows. SeedAsync seeds one atomic,
    /// cross-referencing batch (Participants reference Users, TripInstances reference
    /// Vehicles/Users, etc.), so it must be all-or-nothing: if any table in the batch
    /// already has data — e.g. because Participants alone were cleared out via manual
    /// DB cleanup while Vehicles/etc. were left in place — re-running the seed
    /// would call AddRange with the same hardcoded IDs as existing rows and crash with
    /// an EF Core "already being tracked" / duplicate-key error. Treating any non-empty
    /// table as "already seeded" keeps this safe. The Marcus user id below stands in for the
    /// old Staff-table check — like Staff before it, this fixed-id user is only ever created by
    /// this atomic batch (the other 9 users in the batch are guarded individually and may
    /// already exist from an earlier partial run).
    /// Uses IgnoreQueryFilters([TenantFilter.Name]) throughout so the tenant query filter can't cause a
    /// false negative (mirrors the pattern already used elsewhere in this file).
    /// </summary>
    private static async Task<bool> HasExistingSeedDataAsync(OdipDbContext context, CancellationToken ct)
    {
        return await context.Users.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(u => u.Id == Guid.Parse("a2000000-0000-0000-0000-000000000001"), ct)
            || await context.EventTemplates.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.Participants.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.Contacts.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.AccommodationProperties.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.Vehicles.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.TripInstances.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.ParticipantBookings.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.AccommodationReservations.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.VehicleAssignments.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.StaffAssignments.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.StaffAvailabilities.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.Activities.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.TripDays.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.ScheduledActivities.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct)
            || await context.BookingTasks.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(ct);
    }

    /// <summary>
    /// Seeds the community access group with the real 2026-27 Access Community, Social and Rec Activities - Standard items (RG 0125), so a fresh
    /// database prices claims from codes that exist in the NDIA catalogue. Every field is what the importer would make of the same row of the
    /// 2026-27 Support Catalogue (national, remote and very remote prices from 1 July 2026), so importing the real file afterwards adds the rest of the
    /// catalogue and leaves these five rows exactly as they are. Like every seed, a no-op once any group exists: a live database keeps what it has, and
    /// the admin's catalogue import end-dates the old demo codes.
    /// </summary>
    public static async Task SeedNdisDataAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.SupportActivityGroups.AnyAsync(ct))
            return;

        var groupId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
        var group = new SupportActivityGroup
        {
            Id = groupId,
            GroupCode = "GRP_COMMUNITY_ACCESS",
            DisplayName = "Group Community Access",
            SupportCategory = 4,
            IsActive = true
        };
        context.SupportActivityGroups.Add(group);

        // (id suffix, item number, day type, national, remote MM6, very remote MM7) - NDIS-CODES 4.2, from the 2026-27 catalogue.
        var catalogue = new (int Id, string Code, string Name, ClaimDayType Day, decimal National, decimal Remote, decimal VeryRemote)[]
        {
            (11, "04_104_0125_6_1", "Access Community Social and Rec Activ - Standard - Weekday Daytime", ClaimDayType.Weekday, 73.58m, 103.01m, 110.37m),
            (12, "04_103_0125_6_1", "Access Community Social and Rec Activ - Standard - Weekday Evening", ClaimDayType.WeekdayEvening, 81.07m, 113.50m, 121.61m),
            (13, "04_105_0125_6_1", "Access Community Social and Rec Activ - Standard - Saturday", ClaimDayType.Saturday, 103.54m, 144.96m, 155.31m),
            (14, "04_106_0125_6_1", "Access Community Social and Rec Activ - Standard - Sunday", ClaimDayType.Sunday, 133.50m, 186.90m, 200.25m),
            (15, "04_102_0125_6_1", "Access Community Social and Rec Activ - Standard - Public Holiday", ClaimDayType.PublicHoliday, 163.46m, 228.84m, 245.19m),
        };

        foreach (var c in catalogue)
        {
            context.SupportCatalogueItems.Add(new SupportCatalogueItem
            {
                Id = Guid.Parse($"d0000000-0000-0000-0000-0000000000{c.Id}"),
                ActivityGroupId = groupId,
                ItemNumber = c.Code,
                Description = c.Name,
                Unit = "H",
                DayType = c.Day,
                IsIntensive = false,
                // The eight state limits stay because the claim screens still read them; every state has the National price.
                PriceLimit_ACT = c.National,
                PriceLimit_NSW = c.National,
                PriceLimit_NT = c.National,
                PriceLimit_QLD = c.National,
                PriceLimit_SA = c.National,
                PriceLimit_TAS = c.National,
                PriceLimit_VIC = c.National,
                PriceLimit_WA = c.National,
                PriceLimit_Remote = c.Remote,
                PriceLimit_VeryRemote = c.VeryRemote,
                CatalogueVersion = "2026-27",
                EffectiveFrom = new DateOnly(2026, 7, 1),
                EffectiveTo = null,
                IsActive = true,
                RegistrationGroup = "0125",
                SupportCategoryNumber = 4,
                PaceSupportCategoryNumber = 4,
                OutcomeDomain = 6,
                SupportPurpose = 1,
                CatalogueType = CatalogueItemType.Priced,
                NonFaceToFace = CatalogueClaimFlag.Yes,
                ProviderTravel = CatalogueClaimFlag.Yes,
                ShortNoticeCancellation = CatalogueClaimFlag.Yes,
                NdiaRequestedReports = CatalogueClaimFlag.No,
                IrregularSil = CatalogueClaimFlag.No,
                IsLegacy = false,
                PriceNational = c.National,
                PriceRemote = c.Remote,
                PriceVeryRemote = c.VeryRemote,
                SourceDocument = "NDIS Support Catalogue 2026-27 (demo seed)"
            });
        }

        await context.SaveChangesAsync(ct);
    }

}
