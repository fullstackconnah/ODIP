using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.Data;

/// <summary>
/// Seeds realistic Australian NDIS sample data for development and demonstration.
/// </summary>
public static class DbSeeder
{
    public static async Task SeedAsync(OdipDbContext context, CancellationToken ct = default)
    {
        var hasExistingSeedData = await HasExistingSeedDataAsync(context, ct);

        // ── Tenant ───────────────────────────────────────────────
        // Always ensure the Odip tenant exists (runs unconditionally on every startup)
        var tenantId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
        var odipTenant = await context.Tenants
            .FirstOrDefaultAsync(t => t.EmailDomain == "odip.com.au", ct);
        if (odipTenant is null)
        {
            context.Tenants.Add(new Tenant
            {
                Id = tenantId,
                Name = "Odip",
                EmailDomain = "odip.com.au",
                IsActive = true
            });
            await context.SaveChangesAsync(ct);
        }
        else
        {
            tenantId = odipTenant.Id;
        }

        // ── Demo Tenant ───────────────────────────────────────────
        // Always ensure the Demo tenant exists (runs unconditionally on every startup)
        var demoTenantId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
        var demoTenant = await context.Tenants
            .FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
        {
            context.Tenants.Add(new Tenant
            {
                Id = demoTenantId,
                Name = "Demo",
                EmailDomain = "demo.odip.com.au",
                IsActive = true
            });
            await context.SaveChangesAsync(ct);
        }
        else
        {
            demoTenantId = demoTenant.Id;
        }

        // Seed fixed-ID users — guard each individually so this is safe on redeploy.
        // These 5 demo users carry the profile/qualification fields absorbed from the former
        // Staff entity directly (staff/user-unification design spec §3.4 "absorb" case) — every
        // staff member IS a user account now, so there is no separate Staff row to link.
        var sarahUser = new User { Id = Guid.Parse("b1000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, Username = "sarah.mitchell", Email = "sarah.mitchell@demo.odip.com.au", FirstName = "Sarah", LastName = "Mitchell", Role = UserRole.Coordinator, Position = Position.Coordinator, Mobile = "0412345001", Region = "South East QLD", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var jamesUser = new User { Id = Guid.Parse("b1000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, Username = "james.obrien", Email = "james.obrien@demo.odip.com.au", FirstName = "James", LastName = "O'Brien", Role = UserRole.SupportWorker, Position = Position.SeniorSupportWorker, Mobile = "0412345002", Region = "South East QLD", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var emilyUser = new User { Id = Guid.Parse("b2000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, Username = "emily.nguyen", Email = "emily.nguyen@demo.odip.com.au", FirstName = "Emily", LastName = "Nguyen", Role = UserRole.SupportWorker, Position = Position.SupportWorker, Mobile = "0412345003", Region = "Greater Sydney", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = false, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var danielUser = new User { Id = Guid.Parse("b2000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, Username = "daniel.williams", Email = "daniel.williams@demo.odip.com.au", FirstName = "Daniel", LastName = "Williams", Role = UserRole.SupportWorker, Position = Position.SupportWorker, Mobile = "0412345004", Region = "South East QLD", IsDriverEligible = false, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = false, IsOvernightEligible = false };
        var rachelUser = new User { Id = Guid.Parse("b2000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, Username = "rachel.thompson", Email = "rachel.thompson@demo.odip.com.au", FirstName = "Rachel", LastName = "Thompson", Role = UserRole.Coordinator, Position = Position.TeamLeader, Mobile = "0412345005", Region = "Melbourne Metro", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };

        var seedUsers = new[]
        {
            // Real SuperAdmin — stays on Odip tenant
            new User { Id = Guid.Parse("b1000000-0000-0000-0000-000000000001"), TenantId = tenantId, Username = "admin", Email = "admin@odip.com.au", FirstName = "System", LastName = "Admin", Role = UserRole.SuperAdmin },
            // Demo users — assigned to the Demo tenant
            sarahUser,
            jamesUser,
            rachelUser,
            emilyUser,
            danielUser,
            new User { Id = Guid.Parse("b2000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, Username = "coordinator.read", Email = "readonly@demo.odip.com.au", FirstName = "Read", LastName = "Only", Role = UserRole.ReadOnly },
        };

        var usersAdded = false;
        foreach (var user in seedUsers)
        {
            var exists = await context.Users.IgnoreQueryFilters().AnyAsync(u => u.Id == user.Id, ct);
            if (!exists)
            {
                context.Users.Add(user);
                usersAdded = true;
            }
        }
        if (usersAdded)
            await context.SaveChangesAsync(ct);

        // Ensure SuperAdmin user exists for Connah tenant
        var connahTenantId = new Guid("00000000-0000-0000-0000-000000000001");
        var superAdminExists = await context.Users
            .IgnoreQueryFilters()
            .AnyAsync(u => u.Email == "info@connah.com.au" && u.TenantId == connahTenantId, ct);
        if (!superAdminExists)
        {
            context.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                TenantId = connahTenantId,
                Username = "superadmin",
                Email = "info@connah.com.au",
                FirstName = "Super",
                LastName = "Admin",
                Role = UserRole.SuperAdmin,
                IsActive = true,
            });
            await context.SaveChangesAsync(ct);
        }

        // Fix any existing seeded users that have Guid.Empty TenantId
        var orphanedUsers = await context.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == Guid.Empty)
            .ToListAsync(ct);
        if (orphanedUsers.Count > 0)
        {
            foreach (var u in orphanedUsers) u.TenantId = tenantId;
            await context.SaveChangesAsync(ct);
        }

        // Fixup: reassign demo users previously placed on Odip tenant to Demo tenant
        var demoUserIds = new[]
        {
            Guid.Parse("b1000000-0000-0000-0000-000000000002"),
            Guid.Parse("b1000000-0000-0000-0000-000000000003"),
            Guid.Parse("b2000000-0000-0000-0000-000000000001"),
            Guid.Parse("b2000000-0000-0000-0000-000000000002"),
            Guid.Parse("b2000000-0000-0000-0000-000000000003"),
            Guid.Parse("b2000000-0000-0000-0000-000000000004"),
            // The 5 new SupportWorker users replacing the former orphaned Staff rows.
            Guid.Parse("a2000000-0000-0000-0000-000000000001"),
            Guid.Parse("a2000000-0000-0000-0000-000000000002"),
            Guid.Parse("a2000000-0000-0000-0000-000000000003"),
            Guid.Parse("a2000000-0000-0000-0000-000000000004"),
            Guid.Parse("a2000000-0000-0000-0000-000000000005"),
        };
        var misplacedDemoUsers = await context.Users
            .IgnoreQueryFilters()
            .Where(u => demoUserIds.Contains(u.Id) && u.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedDemoUsers.Count > 0)
        {
            foreach (var u in misplacedDemoUsers) u.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        // Ensure admin@odip.com.au has SuperAdmin role (upgrade from Admin if already seeded)
        var adminUser = await context.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Email == "admin@odip.com.au", ct);
        if (adminUser is not null && adminUser.Role != UserRole.SuperAdmin)
        {
            adminUser.Role = UserRole.SuperAdmin;
            await context.SaveChangesAsync(ct);
        }

        // Fixup: reassign existing demo entities (Participants, EventTemplates,
        // AccommodationProperties, Vehicles, TripInstances) to the Demo tenant if they
        // were previously seeded under the Odip tenant. The 10 staff/user accounts are covered
        // by the demoUserIds fixup above (Staff no longer exists as a separate entity).
        var demoTemplateIds = new[]
        {
            Guid.Parse("c1000000-0000-0000-0000-000000000001"), Guid.Parse("c1000000-0000-0000-0000-000000000002"),
            Guid.Parse("c1000000-0000-0000-0000-000000000003"), Guid.Parse("c2000000-0000-0000-0000-000000000001"),
        };
        var misplacedTemplates = await context.EventTemplates
            .IgnoreQueryFilters()
            .Where(t => demoTemplateIds.Contains(t.Id) && t.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedTemplates.Count > 0)
        {
            foreach (var t in misplacedTemplates) t.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        var demoParticipantIds = new[]
        {
            Guid.Parse("d1000000-0000-0000-0000-000000000001"), Guid.Parse("d1000000-0000-0000-0000-000000000002"),
            Guid.Parse("d1000000-0000-0000-0000-000000000003"), Guid.Parse("d1000000-0000-0000-0000-000000000004"),
            Guid.Parse("d1000000-0000-0000-0000-000000000005"), Guid.Parse("d1000000-0000-0000-0000-000000000006"),
            Guid.Parse("d1000000-0000-0000-0000-000000000007"), Guid.Parse("d1000000-0000-0000-0000-000000000008"),
            Guid.Parse("d1000000-0000-0000-0000-000000000009"), Guid.Parse("d1000000-0000-0000-0000-000000000010"),
            Guid.Parse("d2000000-0000-0000-0000-000000000001"), Guid.Parse("d2000000-0000-0000-0000-000000000002"),
            Guid.Parse("d2000000-0000-0000-0000-000000000003"), Guid.Parse("d2000000-0000-0000-0000-000000000004"),
            Guid.Parse("d2000000-0000-0000-0000-000000000005"), Guid.Parse("d2000000-0000-0000-0000-000000000006"),
            Guid.Parse("d2000000-0000-0000-0000-000000000007"), Guid.Parse("d2000000-0000-0000-0000-000000000008"),
            Guid.Parse("d2000000-0000-0000-0000-000000000009"), Guid.Parse("d2000000-0000-0000-0000-000000000010"),
        };
        var misplacedParticipants = await context.Participants
            .IgnoreQueryFilters()
            .Where(p => demoParticipantIds.Contains(p.Id) && p.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedParticipants.Count > 0)
        {
            foreach (var p in misplacedParticipants) p.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        var demoPropertyIds = new[]
        {
            Guid.Parse("f1000000-0000-0000-0000-000000000001"), Guid.Parse("f1000000-0000-0000-0000-000000000002"),
            Guid.Parse("f1000000-0000-0000-0000-000000000003"), Guid.Parse("f1000000-0000-0000-0000-000000000004"),
            Guid.Parse("f3000000-0000-0000-0000-000000000001"), Guid.Parse("f3000000-0000-0000-0000-000000000002"),
        };
        var misplacedProperties = await context.AccommodationProperties
            .IgnoreQueryFilters()
            .Where(p => demoPropertyIds.Contains(p.Id) && p.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedProperties.Count > 0)
        {
            foreach (var p in misplacedProperties) p.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        var demoVehicleIds = new[]
        {
            Guid.Parse("f2000000-0000-0000-0000-000000000001"), Guid.Parse("f2000000-0000-0000-0000-000000000002"),
            Guid.Parse("f4000000-0000-0000-0000-000000000001"), Guid.Parse("f4000000-0000-0000-0000-000000000002"),
        };
        var misplacedVehicles = await context.Vehicles
            .IgnoreQueryFilters()
            .Where(v => demoVehicleIds.Contains(v.Id) && v.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedVehicles.Count > 0)
        {
            foreach (var v in misplacedVehicles) v.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        var demoTripIds = new[]
        {
            Guid.Parse("01000000-0000-0000-0000-000000000001"), Guid.Parse("01000000-0000-0000-0000-000000000002"),
            Guid.Parse("01000000-0000-0000-0000-000000000003"), Guid.Parse("01000000-0000-0000-0000-000000000004"),
            Guid.Parse("01000000-0000-0000-0000-000000000005"), Guid.Parse("09000000-0000-0000-0000-000000000001"),
            Guid.Parse("09000000-0000-0000-0000-000000000002"), Guid.Parse("09000000-0000-0000-0000-000000000003"),
            Guid.Parse("09000000-0000-0000-0000-000000000004"), Guid.Parse("09000000-0000-0000-0000-000000000005"),
        };
        var misplacedTrips = await context.TripInstances
            .IgnoreQueryFilters()
            .Where(t => demoTripIds.Contains(t.Id) && t.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedTrips.Count > 0)
        {
            foreach (var t in misplacedTrips) t.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        // The 25 seeded activities (06000000-...-0001 to -0025) follow their templates and trips; the library is per organisation, so they must not stay behind.
        var demoActivityIds = Enumerable.Range(1, 25).Select(i => Guid.Parse($"06000000-0000-0000-0000-{i:D12}")).ToArray();
        var misplacedActivities = await context.Activities
            .IgnoreQueryFilters()
            .Where(a => demoActivityIds.Contains(a.Id) && a.TenantId != demoTenantId)
            .ToListAsync(ct);
        if (misplacedActivities.Count > 0)
        {
            foreach (var a in misplacedActivities) a.TenantId = demoTenantId;
            await context.SaveChangesAsync(ct);
        }

        if (hasExistingSeedData)
        {
            Console.WriteLine("[Seed] Skipping demo data seed: existing rows found in one or more " +
                "seeded tables (Staff/Participants/Vehicles/TripInstances/etc.). This batch is seeded " +
                "atomically with fixed cross-referencing GUIDs, so a partial/inconsistent DB state " +
                "(e.g. some tables cleared independently of others) is treated as \"already seeded\" " +
                "and skipped rather than risking duplicate-key/tracking conflicts on AddRange.");
            return;
        }

        // ── New SupportWorker Users (5) ───────────────────────────
        // Per the staff/user-unification design spec §3.4: the 5 previously-orphaned Staff rows
        // are replaced by 5 new SupportWorker users. Position preserves what would have been
        // their StaffRole title (display-only); UserRole (access) is SupportWorker per the
        // migration's auto-create rule.
        var marcusUser = new User { Id = Guid.Parse("a2000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, Username = "marcus.papadopoulos", Email = "marcus.papadopoulos@demo.odip.com.au", FirstName = "Marcus", LastName = "Papadopoulos", Role = UserRole.SupportWorker, Position = Position.SeniorSupportWorker, Mobile = "0412345006", Region = "Brisbane Metro", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var priyaUser = new User { Id = Guid.Parse("a2000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, Username = "priya.sharma", Email = "priya.sharma@demo.odip.com.au", FirstName = "Priya", LastName = "Sharma", Role = UserRole.SupportWorker, Position = Position.SupportWorker, Mobile = "0412345007", Region = "Melbourne Metro", IsDriverEligible = false, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var lachlanUser = new User { Id = Guid.Parse("a2000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, Username = "lachlan.robertson", Email = "lachlan.robertson@demo.odip.com.au", FirstName = "Lachlan", LastName = "Robertson", Role = UserRole.SupportWorker, Position = Position.SupportWorker, Mobile = "0412345008", Region = "South East QLD", IsDriverEligible = true, IsFirstAidQualified = false, IsMedicationCompetent = false, IsManualHandlingCompetent = true, IsOvernightEligible = false, Notes = "Currently completing First Aid renewal." };
        var jadeUser = new User { Id = Guid.Parse("a2000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, Username = "jade.watkins", Email = "jade.watkins@demo.odip.com.au", FirstName = "Jade", LastName = "Watkins", Role = UserRole.SupportWorker, Position = Position.Coordinator, Mobile = "0412345009", Region = "Greater Sydney", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        var brendanUser = new User { Id = Guid.Parse("a2000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, Username = "brendan.nguyen", Email = "brendan.nguyen@demo.odip.com.au", FirstName = "Brendan", LastName = "Nguyen", Role = UserRole.SupportWorker, Position = Position.TeamLeader, Mobile = "0412345010", Region = "Brisbane Metro", IsDriverEligible = true, IsFirstAidQualified = true, IsMedicationCompetent = true, IsManualHandlingCompetent = true, IsOvernightEligible = true };
        context.Users.AddRange(marcusUser, priyaUser, lachlanUser, jadeUser, brendanUser);

        // Index-aligned with the former Staff seed list: users[0]=Sarah .. users[9]=Brendan —
        // every later reference (trips/vehicle assignments/staff assignments/availability/tasks)
        // below uses this same ordering.
        var users = new List<User> { sarahUser, jamesUser, emilyUser, danielUser, rachelUser, marcusUser, priyaUser, lachlanUser, jadeUser, brendanUser };

        // ── Event Templates (4) ──────────────────────────────────
        var templates = new List<EventTemplate>
        {
            new() { Id = Guid.Parse("c1000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, EventCode = "GCBB", EventName = "Gold Coast Beach Break", DefaultDestination = "Gold Coast, QLD", DefaultRegion = "South East QLD", PreferredTimeOfYear = "March-May, September-November", StandardDurationDays = 5, AccessibilityNotes = "Beach wheelchair available from Surfers Paradise SLSC. Accessible boardwalk at Broadwater Parklands.", FullyModifiedAccommodationNotes = "Fully modified units available at Mermaid Waters complex", WheelchairAccessNotes = "Flat terrain, accessible tram and bus network" },
            new() { Id = Guid.Parse("c1000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, EventCode = "BMA", EventName = "Blue Mountains Adventure", DefaultDestination = "Katoomba, NSW", DefaultRegion = "Greater Sydney", PreferredTimeOfYear = "October-April", StandardDurationDays = 4, AccessibilityNotes = "Some lookouts wheelchair accessible. Scenic Railway has limited wheelchair access.", FullyModifiedAccommodationNotes = "Mountain Heritage Lodge has two fully modified rooms", WheelchairAccessNotes = "Steep terrain — plan carefully for wheelchair users" },
            new() { Id = Guid.Parse("c1000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, EventCode = "MAW", EventName = "Melbourne Arts Weekend", DefaultDestination = "Melbourne, VIC", DefaultRegion = "Melbourne Metro", PreferredTimeOfYear = "Year-round, avoid Jan school holidays", StandardDurationDays = 3, AccessibilityNotes = "Most galleries and museums are fully accessible. Trams have low-floor access.", FullyModifiedAccommodationNotes = "Several CBD hotels with accessible rooms", WheelchairAccessNotes = "Generally flat CBD, excellent public transport accessibility" },
            new() { Id = Guid.Parse("c2000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, EventCode = "CAIRNS", EventName = "Cairns Tropical Getaway", DefaultDestination = "Cairns, QLD", DefaultRegion = "North QLD", PreferredTimeOfYear = "May-October (dry season)", StandardDurationDays = 7, AccessibilityNotes = "Esplanade boardwalk fully accessible. Great Barrier Reef pontoon has accessible boarding. Some rainforest walks are not suitable for wheelchairs.", FullyModifiedAccommodationNotes = "Several accessible apartments available near the Esplanade", WheelchairAccessNotes = "Flat CBD. Esplanade and waterfront areas accessible. Plan ahead for reef tours." },
        };
        context.EventTemplates.AddRange(templates);

        // ── Participants (20) ────────────────────────────────────
        var participants = new List<Participant>
        {
            // Original 10
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Liam", LastName = "Johnson", DateOfBirth = new DateOnly(1995, 3, 15), NdisNumber = "430567891", PlanType = PlanType.PlanManaged, Region = "South East QLD", FundingOrganisation = "Maple Plan Management", IsRepeatClient = true, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle", "Transfers" }, IsHighSupport = false, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Manual wheelchair user, independent transfers", EquipmentRequirements = "Standard manual wheelchair", TransportRequirements = "Vehicle with wheelchair ramp", MedicalSummary = "Spinal cord injury L1-L2. Independent with ADLs.", PrimaryDiagnosis = "Spinal Cord Injury", Notes = "Loves the beach. Very social.", LivingArrangement = LivingArrangement.Family, MainSupportPersonName = "Karen Johnson", MainSupportPersonRelationship = "Mother", OthersLivingInAccommodation = "One younger sibling", ResidentialInfo = "Single-storey family home, ramp access installed", LivingArrangementNotes = "Family manage most day-to-day support.", AddressStreet = "14 Seabreeze Court", AddressSuburb = "Southport", AddressState = "QLD", AddressPostcode = "4215", MiddleName = "Robert", PlaceOfBirth = "Southport, QLD", Country = "Australia", Phone = "0400 111 222", Email = "liam.johnson@example.com.au", MedicareNumber = "2951 12345 1", MedicareExpiry = new DateOnly(2029, 4, 30), PensionCardNumber = "PCN1029384", PensionCardExpiry = new DateOnly(2027, 6, 30), HairColour = "Brown", EyeColour = "Blue", WeightKg = 78.5m, HeightCm = 179m, IsCald = true, IsAboriginalOrTorresStraitIslander = false, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = true, PersonalInterests = "Surfing, beach volleyball, watching rugby league.", ChoiceControlNotes = "Wants to build more independence with meal prep." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Sophie", LastName = "Brown", PreferredName = "Soph", DateOfBirth = new DateOnly(1988, 7, 22), NdisNumber = "430567892", PlanType = PlanType.AgencyManaged, Region = "South East QLD", FundingOrganisation = "NDIA", IsRepeatClient = true, IsHighSupport = true, OvernightSupport = OvernightSupportType.ActiveNight, OvernightRatio = SupportRatio.TwoToOne, HasRestrictivePracticeFlag = true, SupportRatio = SupportRatio.TwoToOne, MobilityNotes = "Ambulant with some support for balance", MedicalSummary = "Acquired brain injury. Epilepsy — breakthrough seizures.", PrimaryDiagnosis = "Acquired Brain Injury", OtherDiagnoses = new() { "Epilepsy" }, HidpaSupportCategories = HidpaSupportCategory.EpilepsyManagement, BehaviourRiskSummary = "Can become distressed in loud environments. De-escalation strategies in BSP.", Notes = "Enjoys art and music. Needs structured routine.", LivingArrangement = LivingArrangement.Independent, LivesWithOthers = true, WhoLivesWith = "Partner", AddressStreet = "8/22 Riverside Drive", AddressSuburb = "Southport", AddressState = "QLD", AddressPostcode = "4215", Phone = "0400 222 333", Email = "sophie.brown@example.com.au", MedicareNumber = "2951 22345 2", MedicareExpiry = new DateOnly(2028, 11, 30), CompanionCardNumber = "CC-58213", CompanionCardExpiry = new DateOnly(2027, 3, 31), IsLgbtqi = true, IsFamilyCommunity = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = false, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = false, PersonalInterests = "Painting, live music.", ChoiceControlNotes = "Prefers to choose her own support worker roster where possible." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Noah", LastName = "Taylor", DateOfBirth = new DateOnly(2001, 11, 5), NdisNumber = "430567893", PlanType = PlanType.SelfManaged, Region = "Greater Sydney", IsRepeatClient = false, IsHighSupport = false, SupportRatio = SupportRatio.SharedSupport, MobilityNotes = "Fully ambulant", Notes = "First trip with us. Interested in bushwalking.", LivingArrangement = LivingArrangement.Independent, LivesWithOthers = false, AddressStreet = "3 Fig Tree Lane", AddressSuburb = "Newtown", AddressState = "NSW", AddressPostcode = "2042" },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Olivia", LastName = "Wilson", DateOfBirth = new DateOnly(1992, 1, 30), NdisNumber = "430567894", PlanType = PlanType.PlanManaged, Region = "Melbourne Metro", FundingOrganisation = "MyCareSpace Plan Management", IsRepeatClient = true, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle", "Ceiling hoist" }, RequiresHoist = true, IsHighSupport = true, OvernightSupport = OvernightSupportType.Sleepover, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Electric wheelchair. Requires hoist for transfers.", EquipmentRequirements = "Electric wheelchair, ceiling hoist or mobile hoist", TransportRequirements = "Accessible vehicle with tie-down system", MedicalSummary = "Cerebral palsy — quadriplegia. PEG feeding.", PrimaryDiagnosis = "Cerebral Palsy", HidpaSupportCategories = HidpaSupportCategory.EnteralFeeding, Notes = "Loves galleries and live music.", LivingArrangement = LivingArrangement.SupportedAccommodation, SilProviderName = "Horizon SIL Services", SilProviderContactPhone = "(07) 3123 4567", AccommodationType = "Group home", OnSiteSupportHours = "24/7", LivingArrangementNotes = "Shares accommodation with two other residents.", AddressStreet = "5 Parkview Street", AddressSuburb = "Box Hill", AddressState = "VIC", AddressPostcode = "3128", Country = "Australia", Phone = "0400 444 555", Email = "olivia.wilson@example.com.au", MedicareNumber = "2951 44345 4", MedicareExpiry = new DateOnly(2027, 9, 30), PrivateHealthFund = "Bupa", PrivateHealthMembershipNumber = "BUP-773421", HairColour = "Black", EyeColour = "Brown", IsCald = false, IsAboriginalOrTorresStraitIslander = false, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = true, PersonalInterests = "Art galleries, live jazz.", ChoiceControlNotes = "Communicates preferences via her AAC device — always confirm before proceeding." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Ethan", LastName = "Davis", DateOfBirth = new DateOnly(1999, 5, 18), NdisNumber = "430567895", PlanType = PlanType.AgencyManaged, Region = "South East QLD", FundingOrganisation = "NDIA", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.OneToTwo, Notes = "Enjoys outdoor activities. Good swimmer.", Phone = "0400 555 666", Email = "ethan.davis@example.com.au" },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Mia", LastName = "Anderson", DateOfBirth = new DateOnly(1997, 9, 12), NdisNumber = "430567896", PlanType = PlanType.PlanManaged, Region = "South East QLD", FundingOrganisation = "My Plan Manager", IsRepeatClient = false, IsHighSupport = false, SupportRatio = SupportRatio.SharedSupport, Notes = "Quiet personality. Enjoys reading and cooking." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Jack", LastName = "Thomas", DateOfBirth = new DateOnly(1990, 12, 3), NdisNumber = "430567897", PlanType = PlanType.SelfManaged, Region = "Greater Sydney", IsRepeatClient = true, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle" }, IsHighSupport = false, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Manual wheelchair. Independent pusher.", TransportRequirements = "Accessible vehicle", Notes = "Very independent. Likes photography.", TaxiCardNumber = "TC-90211", CompanionCardNumber = "CC-70125", CompanionCardExpiry = new DateOnly(2028, 2, 28), IsFamilyCommunity = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, PersonalInterests = "Photography, urban exploring." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Charlotte", LastName = "White", PreferredName = "Charlie", DateOfBirth = new DateOnly(2003, 4, 25), NdisNumber = "430567898", PlanType = PlanType.AgencyManaged, Region = "Melbourne Metro", FundingOrganisation = "NDIA", IsRepeatClient = false, IsHighSupport = true, OvernightSupport = OvernightSupportType.PassiveNight, OvernightRatio = SupportRatio.OneToOne, HasRestrictivePracticeFlag = true, SupportRatio = SupportRatio.OneToOne, MedicalSummary = "Autism spectrum — level 3. Anxiety disorder.", PrimaryDiagnosis = "Autism Spectrum Disorder", OtherDiagnoses = new() { "Psychosocial Disability" }, BehaviourRiskSummary = "Flight risk in unfamiliar environments. Requires 1:1 line-of-sight supervision.", Notes = "Loves animals and nature.", IsAboriginalOrTorresStraitIslander = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = true, PersonalInterests = "Animals, nature walks.", ChoiceControlNotes = "Needs advance notice of any routine change — see BSP." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "William", LastName = "Martin", DateOfBirth = new DateOnly(1985, 8, 14), NdisNumber = "430567899", PlanType = PlanType.PlanManaged, Region = "South East QLD", FundingOrganisation = "Maple Plan Management", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.OneToTwo, Notes = "Experienced traveller. Enjoys sports.", IsDsoa = true, Phone = "0400 777 888", Email = "william.martin@example.com.au", WeightKg = 84m, HeightCm = 182m, IsCald = true, ReceivedRightsAndResponsibilitiesInfo = true, PersonalInterests = "Cricket, AFL, travelling." },
            new() { Id = Guid.Parse("d1000000-0000-0000-0000-000000000010"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Amelia", LastName = "Garcia", DateOfBirth = new DateOnly(1994, 6, 8), NdisNumber = "430567900", PlanType = PlanType.PlanManaged, Region = "Melbourne Metro", FundingOrganisation = "MyCareSpace Plan Management", IsRepeatClient = true, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle" }, IsHighSupport = false, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Electric wheelchair. Independent.", TransportRequirements = "Accessible vehicle with ramp", Notes = "Very social. Enjoys cafes and shopping.", Phone = "0400 888 999", Email = "amelia.garcia@example.com.au", PensionCardNumber = "PCN2093841", PensionCardExpiry = new DateOnly(2028, 8, 31) },
            // New 10
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Isabella", LastName = "Clarke", DateOfBirth = new DateOnly(1993, 2, 14), NdisNumber = "430567901", PlanType = PlanType.PlanManaged, Region = "Brisbane Metro", FundingOrganisation = "Maple Plan Management", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.OneToTwo, Notes = "Enthusiastic traveller. Loves live music and cafes.", MiddleName = "Rose", Phone = "0400 101 202", Email = "isabella.clarke@example.com.au", MedicareNumber = "2951 55345 5", MedicareExpiry = new DateOnly(2029, 1, 31), IsFamilyCommunity = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, PersonalInterests = "Live music, cafes." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Mason", LastName = "Nguyen", DateOfBirth = new DateOnly(1998, 7, 3), NdisNumber = "430567902", PlanType = PlanType.AgencyManaged, Region = "South East QLD", FundingOrganisation = "NDIA", IsRepeatClient = false, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle", "Transfers" }, IsHighSupport = false, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Power wheelchair user. Independent with transfers on level surfaces.", TransportRequirements = "Accessible vehicle with power wheelchair capacity", Notes = "First-time traveller. Very excited about the Cairns trip.", CompanionCardNumber = "CC-84420", CompanionCardExpiry = new DateOnly(2027, 12, 31), HairColour = "Black", EyeColour = "Brown", IsCald = true, ReceivedRightsAndResponsibilitiesInfo = false, PersonalInterests = "Gaming, Vietnamese cooking with family." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Chloe", LastName = "Robinson", PreferredName = "Chlo", DateOfBirth = new DateOnly(2000, 10, 20), NdisNumber = "430567903", PlanType = PlanType.SelfManaged, Region = "Greater Sydney", IsRepeatClient = true, IsHighSupport = true, OvernightSupport = OvernightSupportType.Sleepover, OvernightRatio = SupportRatio.TwoToOne, HasRestrictivePracticeFlag = true, SupportRatio = SupportRatio.TwoToOne, MedicalSummary = "Down syndrome. Congenital heart condition — cleared for travel.", PrimaryDiagnosis = "Down Syndrome", BehaviourRiskSummary = "Can become upset with sudden changes. Needs prior warning and visual schedule.", Notes = "Loves dancing and craft activities." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Thomas", LastName = "Patel", DateOfBirth = new DateOnly(1987, 4, 11), NdisNumber = "430567904", PlanType = PlanType.PlanManaged, Region = "Melbourne Metro", FundingOrganisation = "My Plan Manager", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.SharedSupport, Notes = "Avid sports fan. Happy to share room with others.", IsDsoa = true, Country = "Australia", PlaceOfBirth = "Melbourne, VIC", WeightKg = 91m, HeightCm = 175m, IsCald = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = true, PersonalInterests = "Cricket, Bollywood films." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Grace", LastName = "O'Sullivan", DateOfBirth = new DateOnly(1996, 12, 1), NdisNumber = "430567905", PlanType = PlanType.AgencyManaged, Region = "South East QLD", FundingOrganisation = "NDIA", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.OneToTwo, Notes = "Loves cooking and gardening. Good communicator.", Phone = "0400 303 404", Email = "grace.osullivan@example.com.au", PrivateHealthFund = "Medibank", PrivateHealthMembershipNumber = "MED-551029", IsFamilyCommunity = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, PersonalInterests = "Cooking, gardening." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Harrison", LastName = "Lee", DateOfBirth = new DateOnly(1991, 9, 7), NdisNumber = "430567906", PlanType = PlanType.PlanManaged, Region = "Brisbane Metro", FundingOrganisation = "Maple Plan Management", IsRepeatClient = false, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle", "Transfers" }, RequiresShowerChair = true, RequiresCommode = true, IsHighSupport = true, OvernightSupport = OvernightSupportType.SleepoverSupport, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Manual wheelchair. Requires two-person assist for some transfers.", EquipmentRequirements = "Manual wheelchair, shower commode", TransportRequirements = "Accessible vehicle with ramp", MedicalSummary = "Multiple sclerosis. Fatigue management important.", PrimaryDiagnosis = "Multiple Sclerosis", Notes = "Keen to travel north. Prefers morning activities.", MedicareNumber = "2951 66345 6", MedicareExpiry = new DateOnly(2027, 5, 31), TaxiCardNumber = "TC-40318", IsCald = true, IsLgbtqi = false, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = false, PersonalInterests = "Rugby league, fishing." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Zoe", LastName = "Campbell", DateOfBirth = new DateOnly(2002, 5, 28), NdisNumber = "430567907", PlanType = PlanType.SelfManaged, Region = "Greater Sydney", IsRepeatClient = false, IsHighSupport = false, SupportRatio = SupportRatio.OneToTwo, Notes = "Interested in art and photography. Very independent." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Ryan", LastName = "Murphy", PreferredName = "Ry", DateOfBirth = new DateOnly(1989, 3, 18), NdisNumber = "430567908", PlanType = PlanType.AgencyManaged, Region = "Melbourne Metro", FundingOrganisation = "NDIA", IsRepeatClient = true, IsHighSupport = true, OvernightSupport = OvernightSupportType.ActiveNight, OvernightRatio = SupportRatio.OneToOne, HasRestrictivePracticeFlag = true, SupportRatio = SupportRatio.OneToOne, MedicalSummary = "Acquired brain injury — stroke at 32. Aphasia and right-side weakness.", PrimaryDiagnosis = "Acquired Brain Injury", OtherDiagnoses = new() { "Stroke" }, BehaviourRiskSummary = "Can become frustrated when communication is difficult. Allow extra time.", Notes = "Loves AFL. Comfortable traveller since ABI rehab.", IsAboriginalOrTorresStraitIslander = true, ReceivedRightsAndResponsibilitiesInfo = true, ReceivedPrivacyAndConfidentialityInfo = true, ReceivedFeedbackInfo = true, ReceivedBeingSafeInfo = true, ReceivedAdvocacyInfo = true, PersonalInterests = "AFL, family gatherings.", ChoiceControlNotes = "Allow extra time to communicate — aphasia post-ABI." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, Gender = Gender.Female, FirstName = "Natalie", LastName = "Walsh", DateOfBirth = new DateOnly(1994, 8, 22), NdisNumber = "430567909", PlanType = PlanType.PlanManaged, Region = "South East QLD", FundingOrganisation = "Maple Plan Management", IsRepeatClient = true, IsHighSupport = false, SupportRatio = SupportRatio.OneToThree, Notes = "Social butterfly. Gets on well with everyone.", IsLgbtqi = true, IsFamilyCommunity = true, ReceivedRightsAndResponsibilitiesInfo = true, PersonalInterests = "Socialising, board games." },
            new() { Id = Guid.Parse("d2000000-0000-0000-0000-000000000010"), TenantId = demoTenantId, Gender = Gender.Male, FirstName = "Dylan", LastName = "Foster", DateOfBirth = new DateOnly(1997, 1, 9), NdisNumber = "430567910", PlanType = PlanType.PlanManaged, Region = "Brisbane Metro", FundingOrganisation = "My Plan Manager", IsRepeatClient = false, MobilityAidWheelchair = true, MobilitySupportOptions = new() { "Wheelchair in vehicle" }, IsHighSupport = false, SupportRatio = SupportRatio.OneToOne, MobilityNotes = "Manual wheelchair. Active pusher, independent outdoors on flat terrain.", TransportRequirements = "Accessible vehicle", Notes = "Loves the outdoors. Eager to try the reef." },
            // INTAKE-08: one demo draft — an intake stopped after just the first name and a
            // phone-screening note, no NDIS number/living arrangement/funding detail yet.
            // Demonstrates the participants-list Draft badge + resume-into-wizard flow without
            // being picked up by any of the roster/claims/portal/alerts surfaces below (all of
            // which gate on `!IsDraft`), or by any of the per-index seed data further down this
            // method (medications/notes/routines/risk entries all key off specific indices that
            // stop at 19).
            new() { Id = Guid.Parse("d3000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, FirstName = "Priya", IsDraft = true, Notes = "Phone screening only — still need DOB, NDIS number, funding source, and living arrangement." },
        };
        // FUND-02: derive FundingSource from the pre-existing FundingOrganisation text using the
        // exact same rule the AddParticipantFundingSource migration applies to real rows on
        // backfill — non-empty FundingOrganisation implies "Other" (the pre-FUND-02 seed data
        // never distinguished the two), empty/null defaults to "Ndis".
        foreach (var p in participants)
            p.FundingSource = string.IsNullOrWhiteSpace(p.FundingOrganisation) ? ParticipantFundingSource.Ndis : ParticipantFundingSource.Other;

        // ── Coherence pass (seed-expansion task) ─────────────────
        // Participants[0..3] already carry address/living-arrangement data from earlier waves
        // (LIVING-01..04, INTAKE-06) — backfill address/living-arrangement for the remaining 16
        // below. No participant had PlanStartDate/PlanEndDate set before this task, so the ??=
        // loop backfills plan dates for all 20, giving every demo participant a plan date so the
        // dashboard's plan-expiry alerts (ParticipantAlertsService rule 4) have something to key
        // off. Gender is already set on every seed row above, so it needs no backfill here.
        var planToday = DateOnly.FromDateTime(DateTime.UtcNow);
        foreach (var p in participants)
        {
            p.PlanStartDate ??= planToday.AddMonths(-6);
            p.PlanEndDate ??= planToday.AddMonths(6);
        }

        void SetAddress(Participant p, string street, string suburb, string state, string postcode)
        {
            p.AddressStreet = street; p.AddressSuburb = suburb; p.AddressState = state; p.AddressPostcode = postcode;
        }

        // Ethan Davis — Independent, lives with housemates.
        participants[4].LivingArrangement = LivingArrangement.Independent;
        participants[4].LivesWithOthers = true;
        participants[4].WhoLivesWith = "Two housemates";
        SetAddress(participants[4], "9 Currumbin Court", "Robina", "QLD", "4226");

        // Mia Anderson — Family arrangement.
        participants[5].LivingArrangement = LivingArrangement.Family;
        participants[5].MainSupportPersonName = "Karen Anderson";
        participants[5].MainSupportPersonRelationship = "Mother";
        participants[5].OthersLivingInAccommodation = "Two younger siblings";
        participants[5].ResidentialInfo = "Single-storey family home";
        SetAddress(participants[5], "21 Jacaranda Avenue", "Sunnybank", "QLD", "4109");

        // Jack Thomas — Independent, lives alone.
        participants[6].LivingArrangement = LivingArrangement.Independent;
        participants[6].LivesWithOthers = false;
        SetAddress(participants[6], "56 Glebe Point Road", "Glebe", "NSW", "2037");

        // Charlotte White — Supported accommodation (group home), matches her SIL-style support profile.
        participants[7].LivingArrangement = LivingArrangement.SupportedAccommodation;
        participants[7].SilProviderName = "Yarra Living Supports";
        participants[7].SilProviderContactPhone = "(03) 9555 2211";
        participants[7].AccommodationType = "Group home";
        participants[7].OnSiteSupportHours = "24/7";
        SetAddress(participants[7], "10/48 Hoddle Street", "Richmond", "VIC", "3121");

        // William Martin — Independent, lives with partner.
        participants[8].LivingArrangement = LivingArrangement.Independent;
        participants[8].LivesWithOthers = true;
        participants[8].WhoLivesWith = "Partner";
        SetAddress(participants[8], "3 Ipswich Road", "Woodridge", "QLD", "4114");

        // Amelia Garcia — Independent, lives alone. Deliberately given an EXPIRED plan while
        // remaining IsActive=true — the plan-expired Critical alert demo (ParticipantAlertsService
        // excludes only inactive participants from the aggregate, so a genuinely active client
        // with a lapsed plan is exactly the scenario that alert exists to surface).
        participants[9].LivingArrangement = LivingArrangement.Independent;
        participants[9].LivesWithOthers = false;
        SetAddress(participants[9], "88 Chapel Street", "Windsor", "VIC", "3181");
        participants[9].PlanStartDate = planToday.AddYears(-1).AddDays(-5);
        participants[9].PlanEndDate = planToday.AddDays(-5);

        // Isabella Clarke — Family arrangement.
        participants[10].LivingArrangement = LivingArrangement.Family;
        participants[10].MainSupportPersonName = "Anne Clarke";
        participants[10].MainSupportPersonRelationship = "Mother";
        participants[10].ResidentialInfo = "Townhouse, ground floor unit";
        SetAddress(participants[10], "17 Vulture Street", "West End", "QLD", "4101");

        // Mason Nguyen — Family arrangement.
        participants[11].LivingArrangement = LivingArrangement.Family;
        participants[11].MainSupportPersonName = "Linh Nguyen";
        participants[11].MainSupportPersonRelationship = "Mother";
        participants[11].OthersLivingInAccommodation = "Younger brother";
        participants[11].ResidentialInfo = "Single-storey home with ramp access";
        SetAddress(participants[11], "42 Logan Road", "Mount Gravatt", "QLD", "4122");

        // Chloe Robinson — Supported accommodation (group home).
        participants[12].LivingArrangement = LivingArrangement.SupportedAccommodation;
        participants[12].SilProviderName = "Harbourview SIL Services";
        participants[12].SilProviderContactPhone = "(02) 9555 8890";
        participants[12].AccommodationType = "Group home";
        participants[12].OnSiteSupportHours = "24/7";
        SetAddress(participants[12], "6/120 Oxford Street", "Bondi Junction", "NSW", "2022");

        // Thomas Patel — Independent, lives with a housemate.
        participants[13].LivingArrangement = LivingArrangement.Independent;
        participants[13].LivesWithOthers = true;
        participants[13].WhoLivesWith = "Housemate";
        SetAddress(participants[13], "29 Church Street", "Brighton", "VIC", "3186");

        // Grace O'Sullivan — Independent, lives alone.
        participants[14].LivingArrangement = LivingArrangement.Independent;
        participants[14].LivesWithOthers = false;
        SetAddress(participants[14], "15 Nerang Street", "Nerang", "QLD", "4211");

        // Harrison Lee — Supported accommodation (group home).
        participants[15].LivingArrangement = LivingArrangement.SupportedAccommodation;
        participants[15].SilProviderName = "Riverstone SIL";
        participants[15].SilProviderContactPhone = "(07) 3555 4410";
        participants[15].AccommodationType = "Group home";
        participants[15].OnSiteSupportHours = "Overnight sleepover support";
        SetAddress(participants[15], "80 Vulture Street", "Woolloongabba", "QLD", "4102");

        // Zoe Campbell — churned: marked inactive with an already-lapsed plan. This is the
        // "genuinely expired plan on an inactive participant" case the alerts aggregate's
        // activeOnly filter correctly excludes (still visible on her own detail page).
        participants[16].IsActive = false;
        participants[16].LivingArrangement = LivingArrangement.Independent;
        participants[16].LivesWithOthers = false;
        SetAddress(participants[16], "5 King Street", "Erskineville", "NSW", "2043");
        participants[16].PlanStartDate = planToday.AddYears(-1).AddDays(-60);
        participants[16].PlanEndDate = planToday.AddDays(-60);

        // Ryan Murphy — Family arrangement (spouse/carer).
        participants[17].LivingArrangement = LivingArrangement.Family;
        participants[17].MainSupportPersonName = "Sandra Lee";
        participants[17].MainSupportPersonRelationship = "Spouse / Carer";
        participants[17].ResidentialInfo = "Single-storey home, modified bathroom";
        SetAddress(participants[17], "11 Station Street", "Camberwell", "VIC", "3124");

        // Natalie Walsh — Independent, lives with partner. Warning-band plan demo: expires within
        // the 30-day plan-expiring-soon window.
        participants[18].LivingArrangement = LivingArrangement.Independent;
        participants[18].LivesWithOthers = true;
        participants[18].WhoLivesWith = "Partner";
        SetAddress(participants[18], "34 Wellington Road", "East Brisbane", "QLD", "4169");
        participants[18].PlanStartDate = planToday.AddYears(-1).AddDays(12);
        participants[18].PlanEndDate = planToday.AddDays(12);

        // Dylan Foster — Family arrangement. Second Warning-band plan demo, further out than
        // Natalie's so the two don't read as duplicates of the same date.
        participants[19].LivingArrangement = LivingArrangement.Family;
        participants[19].MainSupportPersonName = "Local guardian";
        participants[19].MainSupportPersonRelationship = "Father";
        participants[19].ResidentialInfo = "Family home";
        SetAddress(participants[19], "22 Riverside Parade", "Kangaroo Point", "QLD", "4169");
        participants[19].PlanStartDate = planToday.AddYears(-1).AddDays(24);
        participants[19].PlanEndDate = planToday.AddDays(24);

        context.Participants.AddRange(participants);

        // ── Support Profiles (8) ─────────────────────────────────
        var supportProfiles = new List<SupportProfile>
        {
            new() { Id = Guid.NewGuid(), ParticipantId = participants[1].Id, CommunicationNotes = "Uses key word signing and some verbal communication. Allow extra processing time.", BehaviourSupportNotes = "BSP in place. Avoid loud/crowded environments. Use visual schedule. De-escalation: quiet space, deep pressure.", RestrictivePracticeDetails = "Environmental restriction — locked doors during sleep. Authorised by NDIS Commission.", MedicationHealthSummary = "Epilepsy medication — Keppra 500mg BD. PRN Midazolam nasal spray for prolonged seizures.", EmergencyConsiderations = "Seizure first aid protocol attached. Ambulance if seizure > 5 min.", TravelSpecificNotes = "Needs own room with staff nearby. Extra transition time between activities.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(3)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[3].Id, CommunicationNotes = "Uses AAC device (Proloquo2Go on iPad). Understands verbal communication well.", ManualHandlingNotes = "Requires ceiling hoist or mobile hoist for all transfers. Two-person assist for bed positioning.", MedicationHealthSummary = "Multiple medications — see medication chart. PEG feeding schedule attached.", EmergencyConsiderations = "Autonomic dysreflexia risk — see emergency protocol.", TravelSpecificNotes = "Equipment list attached. Check accommodation has ceiling hoists or book mobile hoist.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[7].Id, CommunicationNotes = "Limited verbal. Uses PECS. Responds well to visual schedules and social stories.", BehaviourSupportNotes = "Runs when anxious — line-of-sight supervision required at all times in community. Social stories prepared before each new environment.", RestrictivePracticeDetails = "Continuous supervision in community settings. GPS tracker watch. Authorised.", EmergencyConsiderations = "If missing — call 000 immediately. Has limited safety awareness around roads and water.", TravelSpecificNotes = "Pre-trip social stories essential. Visit photos of accommodation/activities sent to family 2 weeks prior.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(2)) },
            // New support profiles
            new() { Id = Guid.NewGuid(), ParticipantId = participants[12].Id, CommunicationNotes = "Verbal with good receptive language. Responds well to calm, clear instructions. Upset by raised voices.", BehaviourSupportNotes = "BSP in place. Provide 5-minute warnings before transitions. Comfort item (stress ball) always in bag.", RestrictivePracticeDetails = "No restrictive practices. BSP preventative strategies only.", MedicationHealthSummary = "Cardiac medication — Digoxin 0.25mg daily. Take with breakfast. No missed doses.", EmergencyConsiderations = "Cardiac history — if chest pain or SOB, call 000. Do not wait.", TravelSpecificNotes = "Shorter activity sessions preferred. Rest periods mid-morning and mid-afternoon.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(4)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[15].Id, CommunicationNotes = "Limited verbal output. Uses communication board and gestures. Responds to simple instructions.", ManualHandlingNotes = "Two-person assist for all transfers from wheelchair. Shower commode required. Morning routine takes 45 min.", MedicationHealthSummary = "Baclofen 20mg TDS for spasticity. Movicol daily. Pain management — Panadol PRN.", EmergencyConsiderations = "Skin integrity — check pressure areas every 2 hrs during day trips. Report any redness immediately.", TravelSpecificNotes = "Needs fully accessible room with wide doorways. Morning routine must not be rushed. Fatigue management — no more than 4 hours active per day.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(2)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[17].Id, CommunicationNotes = "Aphasia — expressive language impaired. Uses word board and yes/no responses. Understands most conversation.", BehaviourSupportNotes = "Frustration possible when communication fails. Allow 20+ seconds for responses. Do not finish sentences for him.", MedicationHealthSummary = "Aspirin 100mg daily. Atorvastatin 40mg nocte. Clopidogrel 75mg daily.", EmergencyConsiderations = "Stroke history — FAST signs. Call 000 immediately if new neurological symptoms.", TravelSpecificNotes = "Seat near window on vehicles. Prefers quiet environments. Group size 4-6 maximum.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(6)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[5].Id, CommunicationNotes = "Verbal. Friendly and communicative. May repeat questions when anxious — respond consistently.", BehaviourSupportNotes = "Mild anxiety in new environments. Positive reinforcement. Predictable routine reduces anxiety.", MedicationHealthSummary = "Sertraline 50mg morning. No other regular medications.", TravelSpecificNotes = "Introduce new environments with photos/videos beforehand. Carry fidget toy.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(12)) },
            new() { Id = Guid.NewGuid(), ParticipantId = participants[19].Id, CommunicationNotes = "Verbal with good communication skills.", ManualHandlingNotes = "Independent on flat terrain. Requires assistance on uneven ground and ramps.", MedicationHealthSummary = "No regular medications.", TravelSpecificNotes = "Enthusiastic about reef tours. Confirm snorkelling suitability with GP.", ReviewDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(8)) },
        };
        context.SupportProfiles.AddRange(supportProfiles);

        // ── Contacts (10) ────────────────────────────────────────
        var contacts = new List<Contact>
        {
            new() { Id = Guid.Parse("e1000000-0000-0000-0000-000000000001"), FirstName = "Margaret", LastName = "Johnson", RoleRelationship = "Mother", Email = "margaret.johnson@email.com.au", Mobile = "0498765001", Phone = "07 3456 7891", Address = "42 Jacaranda Street", Suburb = "Coorparoo", State = "QLD", Postcode = "4151", PreferredContactMethod = PreferredContactMethod.Mobile },
            new() { Id = Guid.Parse("e1000000-0000-0000-0000-000000000002"), FirstName = "David", LastName = "Brown", RoleRelationship = "Father / Guardian", Email = "david.brown@email.com.au", Mobile = "0498765002", Address = "18 Banksia Avenue", Suburb = "Toowong", State = "QLD", Postcode = "4066", PreferredContactMethod = PreferredContactMethod.Email },
            new() { Id = Guid.Parse("e1000000-0000-0000-0000-000000000003"), FirstName = "Karen", LastName = "Wilson", RoleRelationship = "Support Coordinator", Organisation = "Inclusive Support Solutions", Email = "karen.wilson@iss.com.au", Mobile = "0498765003", PreferredContactMethod = PreferredContactMethod.Email },
            new() { Id = Guid.Parse("e1000000-0000-0000-0000-000000000004"), FirstName = "Robert", LastName = "White", RoleRelationship = "Father", Email = "robert.white@email.com.au", Mobile = "0498765004", Address = "7 Elm Court", Suburb = "Hawthorn", State = "VIC", Postcode = "3122", PreferredContactMethod = PreferredContactMethod.Phone, Phone = "03 9876 5432" },
            new() { Id = Guid.Parse("e1000000-0000-0000-0000-000000000005"), FirstName = "Lisa", LastName = "Thomas", RoleRelationship = "House Manager", Organisation = "Compass Living", Email = "lisa.thomas@compassliving.com.au", Mobile = "0498765005", PreferredContactMethod = PreferredContactMethod.Mobile },
            // New contacts
            new() { Id = Guid.Parse("e2000000-0000-0000-0000-000000000001"), FirstName = "Anne", LastName = "Clarke", RoleRelationship = "Mother", Email = "anne.clarke@email.com.au", Mobile = "0498765006", Address = "14 Wattle Drive", Suburb = "Sunnybank", State = "QLD", Postcode = "4109", PreferredContactMethod = PreferredContactMethod.Mobile },
            new() { Id = Guid.Parse("e2000000-0000-0000-0000-000000000002"), FirstName = "Peter", LastName = "Robinson", RoleRelationship = "Father / Guardian", Email = "peter.robinson@email.com.au", Mobile = "0498765007", Phone = "02 9876 1234", Address = "9 Frangipani Close", Suburb = "Penrith", State = "NSW", Postcode = "2750", PreferredContactMethod = PreferredContactMethod.Phone },
            new() { Id = Guid.Parse("e2000000-0000-0000-0000-000000000003"), FirstName = "Sandra", LastName = "Lee", RoleRelationship = "Spouse / Carer", Email = "sandra.lee@email.com.au", Mobile = "0498765008", Address = "22 Coral Street", Suburb = "Chermside", State = "QLD", Postcode = "4032", PreferredContactMethod = PreferredContactMethod.SMS },
            new() { Id = Guid.Parse("e2000000-0000-0000-0000-000000000004"), FirstName = "Dr Jason", LastName = "Park", RoleRelationship = "GP", Organisation = "Southside Medical Centre", Email = "j.park@southsidemedical.com.au", Phone = "07 3211 5555", PreferredContactMethod = PreferredContactMethod.Phone },
            new() { Id = Guid.Parse("e2000000-0000-0000-0000-000000000005"), FirstName = "Belinda", LastName = "Murphy", RoleRelationship = "Sister / Next of Kin", Email = "belinda.murphy@email.com.au", Mobile = "0498765010", Address = "3 Kurrajong Way", Suburb = "Box Hill", State = "VIC", Postcode = "3128", PreferredContactMethod = PreferredContactMethod.Email },
        };
        context.Contacts.AddRange(contacts);

        // ── ParticipantContacts ──────────────────────────────────
        var participantContacts = new List<ParticipantContact>
        {
            new() { ParticipantId = participants[0].Id, ContactId = contacts[0].Id },
            new() { ParticipantId = participants[1].Id, ContactId = contacts[1].Id },
            new() { ParticipantId = participants[3].Id, ContactId = contacts[2].Id },
            new() { ParticipantId = participants[3].Id, ContactId = contacts[3].Id },
            new() { ParticipantId = participants[7].Id, ContactId = contacts[3].Id },
            new() { ParticipantId = participants[6].Id, ContactId = contacts[4].Id },
            // New participant contacts
            new() { ParticipantId = participants[10].Id, ContactId = contacts[5].Id },
            new() { ParticipantId = participants[12].Id, ContactId = contacts[6].Id },
            new() { ParticipantId = participants[15].Id, ContactId = contacts[7].Id },
            new() { ParticipantId = participants[15].Id, ContactId = contacts[8].Id },
            new() { ParticipantId = participants[17].Id, ContactId = contacts[9].Id },
        };
        context.ParticipantContacts.AddRange(participantContacts);

        // ── People / ParticipantContactRoles (CONTACT-01/02/03) ──
        // Independent of the legacy Contacts/ParticipantContacts block above (see the
        // AddContactsModel migration's data-copy for how *existing* legacy rows migrate — this is
        // separately-seeded demo data for the new model, not a re-seeding of the same contacts).
        // Deliberately covers 13 of the 14 ContactRoleType values and several multi-role-per-person
        // examples (research §5's core CONTACT-03 scenario): ChildRepresentative is the one type
        // NOT seeded — every seeded participant is an adult (see the DateOfBirth values above), and
        // ContactRoleRules.Validate would reject a ChildRepresentative row for an 18+ participant's
        // DOB if it ever reached the controller, so seeding one here (which bypasses that
        // validator entirely via a direct EF add) would model a state the API itself refuses.
        var people = new List<Person>
        {
            // Liam Johnson (participants[0], PlanManaged) — one person, two roles.
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, FirstName = "Karen", LastName = "Johnson", Phone = "07 3456 1001", Mobile = "0412 345 001", Email = "karen.johnson@email.com.au", Organisation = null },
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, FirstName = "Diane", LastName = "Cooper", Mobile = "0412 345 002", Email = "diane.cooper@mapleplan.com.au", Organisation = "Maple Plan Management" },
            // Olivia Wilson (participants[3], PlanManaged) — one person holding both Guardian and
            // Plan Nominee (research §5: "the same person may be appointed as both guardian and
            // nominee"), plus a separate Plan Manager contact.
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, FirstName = "Denise", LastName = "Wilson", Phone = "03 9123 1003", Mobile = "0412 345 003", Email = "denise.wilson@email.com.au", Organisation = null },
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, FirstName = "Farah", LastName = "Nasser", Mobile = "0412 345 004", Email = "farah.nasser@mycarespace.com.au", Organisation = "MyCareSpace Plan Management" },
            // Sophie Brown (participants[1], AgencyManaged) — Support Coordinator, GP, and a
            // registered Provider Contact (RegisteredProviderFlag required for Agency-managed).
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, FirstName = "Karen", LastName = "Wilson", Mobile = "0412 345 005", Email = "karen.wilson@iss.com.au", Organisation = "Inclusive Support Solutions" },
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, FirstName = "Dr Jason", LastName = "Park", Phone = "07 3211 5555", Email = "j.park@southsidemedical.com.au", Organisation = "Southside Medical Centre" },
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, FirstName = "Amanda", LastName = "Ho", Mobile = "0412 345 007", Email = "amanda.ho@sunrisecs.com.au", Organisation = "Sunrise Community Services" },
            // Charlotte White (participants[7]) — Specialist.
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, FirstName = "Dr Priya", LastName = "Singh", Phone = "03 9555 1008", Email = "p.singh@mindcarepsych.com.au", Organisation = "Mindcare Psychiatry" },
            // Amelia Garcia (participants[9]) — Pharmacy (person-record standing in for the org,
            // per Person.cs's type doc — pharmacy contacts don't quite have an individual name).
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, FirstName = "Riverside", LastName = "Pharmacy", Phone = "03 9555 1009", Organisation = "Riverside Pharmacy" },
            // William Martin (participants[8]) — Financial Administrator (PF-10.2: this demo
            // person is a solicitor by profession, but the ROLE recorded for the participant is
            // "who administers their finances", not "what is their job title" — see the
            // ScopeNotes/AuthorisationDocumentReference on the contact-role row below).
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000010"), TenantId = demoTenantId, FirstName = "David", LastName = "Osei", Phone = "07 3555 1010", Email = "d.osei@baysidelegal.com.au", Organisation = "Bayside Legal" },
            // Isabella Clarke (participants[10]) — Advocate.
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000011"), TenantId = demoTenantId, FirstName = "Tanya", LastName = "Brooks", Mobile = "0412 345 011", Email = "tanya.brooks@communityvoices.org.au", Organisation = "Community Voices Advocacy" },
            // Mason Nguyen (participants[11]) — Interpreter/language support.
            new() { Id = Guid.Parse("e3000000-0000-0000-0000-000000000012"), TenantId = demoTenantId, FirstName = "Miguel", LastName = "Torres", Phone = "1300 655 010", Organisation = "TIS National" },
        };
        context.People.AddRange(people);

        var contactRoles = new List<ParticipantContactRole>
        {
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = participants[0].Id, PersonId = people[0].Id, RoleType = ContactRoleType.NextOfKin, RelationshipToParticipant = "Mother", IsPrimary = true },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = participants[0].Id, PersonId = people[0].Id, RoleType = ContactRoleType.EmergencyContact, RelationshipToParticipant = "Mother", PriorityOrder = 1, AuthorisedForMedicalInfo = true },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = participants[0].Id, PersonId = people[1].Id, RoleType = ContactRoleType.PlanManager, OrganisationName = "Maple Plan Management", StartDate = new DateOnly(2024, 1, 1) },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = participants[3].Id, PersonId = people[2].Id, RoleType = ContactRoleType.Guardian, RelationshipToParticipant = "Mother", AppointingTribunal = "QCAT", OrderScopeDomains = new() { "Health", "Accommodation" }, OrderStartDate = new DateOnly(2022, 6, 1), OrderReviewDate = new DateOnly(2027, 6, 1) },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = participants[3].Id, PersonId = people[2].Id, RoleType = ContactRoleType.PlanNominee, RelationshipToParticipant = "Mother", NomineeScope = NomineeScope.Plan, AppointmentDate = new DateOnly(2022, 7, 15) },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = participants[3].Id, PersonId = people[3].Id, RoleType = ContactRoleType.PlanManager, OrganisationName = "MyCareSpace Plan Management", StartDate = new DateOnly(2023, 3, 1) },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = participants[1].Id, PersonId = people[4].Id, RoleType = ContactRoleType.SupportCoordinator, OrganisationName = "Inclusive Support Solutions", FundingLineItemType = "Coordination of Supports", StartDate = new DateOnly(2024, 2, 1) },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, ParticipantId = participants[1].Id, PersonId = people[5].Id, RoleType = ContactRoleType.Gp, OrganisationName = "Southside Medical Centre", ConsentToShare = true },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, ParticipantId = participants[1].Id, PersonId = people[6].Id, RoleType = ContactRoleType.ProviderContact, RoleTitle = "Support Worker", OrganisationName = "Sunrise Community Services", RegisteredProviderFlag = true },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-00000000000a"), TenantId = demoTenantId, ParticipantId = participants[7].Id, PersonId = people[7].Id, RoleType = ContactRoleType.Specialist, Discipline = "Psychiatry", OrganisationName = "Mindcare Psychiatry", FrequencyOfContact = "Monthly" },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-00000000000b"), TenantId = demoTenantId, ParticipantId = participants[9].Id, PersonId = people[8].Id, RoleType = ContactRoleType.Pharmacy, OrganisationName = "Riverside Pharmacy", WebsterPackFlag = true },
            // PF-10.2: reclassified from ContactRoleType.Solicitor — this row's ScopeNotes
            // ("Financial administration order") and AuthorisationDocumentReference (a QCAT
            // order) describe a court-appointed Financial Administrator, exactly the mislabelled
            // case this branch's new enum member exists to distinguish. This seed fixture is
            // updated directly (not left as a stale "Solicitor" example) since it is demo data,
            // not a real deployed row — see this branch's report for why real rows are NOT
            // auto-reclassified.
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-00000000000c"), TenantId = demoTenantId, ParticipantId = participants[8].Id, PersonId = people[9].Id, RoleType = ContactRoleType.FinancialAdministrator, OrganisationName = "Bayside Legal", ScopeNotes = "Financial administration order", AuthorisationDocumentReference = "QCAT Order 2023/4471" },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-00000000000d"), TenantId = demoTenantId, ParticipantId = participants[10].Id, PersonId = people[10].Id, RoleType = ContactRoleType.Advocate, OrganisationName = "Community Voices Advocacy", ScopeNotes = "Formal" },
            new() { Id = Guid.Parse("e4000000-0000-0000-0000-00000000000e"), TenantId = demoTenantId, ParticipantId = participants[11].Id, PersonId = people[11].Id, RoleType = ContactRoleType.Interpreter, PreferredLanguage = "Vietnamese", OrganisationName = "TIS National" },
        };
        context.ParticipantContactRoles.AddRange(contactRoles);

        // ── Accommodation Properties (6) ─────────────────────────
        var properties = new List<AccommodationProperty>
        {
            new() { Id = Guid.Parse("f1000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, PropertyName = "Mermaid Waters Accessible Villas", ProviderOwner = "Accessible Holidays QLD", Location = "Gold Coast, QLD", Region = "South East QLD", Address = "123 Markeri Street", Suburb = "Mermaid Waters", State = "QLD", Postcode = "4218", ContactPerson = "Jenny Park", Email = "bookings@accessibleholidaysqld.com.au", Phone = "07 5555 1234", IsFullyModified = true, IsWheelchairAccessible = true, BedroomCount = 4, BedCount = 6, MaxCapacity = 8, BeddingConfiguration = "2x king (adjustable), 2x single, 1x double", HoistBathroomNotes = "Ceiling hoists in master and bedroom 2. Roll-in showers both bathrooms.", AccessibilityNotes = "Fully ramped entry, wide doorways, accessible kitchen." },
            new() { Id = Guid.Parse("f1000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, PropertyName = "Mountain Heritage Lodge", ProviderOwner = "Blue Mountains Retreats", Location = "Katoomba, NSW", Region = "Greater Sydney", Address = "45 Great Western Highway", Suburb = "Katoomba", State = "NSW", Postcode = "2780", ContactPerson = "Tom Henderson", Email = "stays@mountainheritage.com.au", Phone = "02 4782 1234", IsFullyModified = false, IsSemiModified = true, IsWheelchairAccessible = true, BedroomCount = 6, BedCount = 10, MaxCapacity = 12, BeddingConfiguration = "3x queen, 4x single, 1x double", AccessibilityNotes = "Ground floor rooms accessible. Upper floor via stairs only." },
            new() { Id = Guid.Parse("f1000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, PropertyName = "CBD Accessible Apartments", ProviderOwner = "Inclusive Stay Melbourne", Location = "Melbourne, VIC", Region = "Melbourne Metro", Address = "200 Spencer Street", Suburb = "Melbourne", State = "VIC", Postcode = "3000", ContactPerson = "Alicia Tran", Email = "reservations@inclusivestay.com.au", Phone = "03 9000 1234", IsFullyModified = true, IsWheelchairAccessible = true, BedroomCount = 3, BedCount = 4, MaxCapacity = 6, BeddingConfiguration = "1x king (adjustable), 2x single, 1x sofa bed", HoistBathroomNotes = "Mobile hoist available. Roll-in shower.", AccessibilityNotes = "Lift access, auto doors, close to Southern Cross Station." },
            new() { Id = Guid.Parse("f1000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, PropertyName = "Surfers Paradise Holiday Unit", ProviderOwner = "GC Stays", Location = "Gold Coast, QLD", Region = "South East QLD", Address = "88 Surfers Paradise Boulevard", Suburb = "Surfers Paradise", State = "QLD", Postcode = "4217", ContactPerson = "Mark Chen", Email = "bookings@gcstays.com.au", Phone = "07 5555 5678", IsFullyModified = false, IsSemiModified = true, IsWheelchairAccessible = false, BedroomCount = 3, BedCount = 5, MaxCapacity = 6, BeddingConfiguration = "1x queen, 2x single, 1x double", AccessibilityNotes = "Step-free entry but narrow bathroom doorway. Not suitable for wheelchair users." },
            // New properties
            new() { Id = Guid.Parse("f3000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, PropertyName = "Kangaroo Point Accessible Units", ProviderOwner = "Brisbane River Stays", Location = "Brisbane, QLD", Region = "Brisbane Metro", Address = "42 River Terrace", Suburb = "Kangaroo Point", State = "QLD", Postcode = "4169", ContactPerson = "Wayne Burns", Email = "stays@brisbaneriverstays.com.au", Phone = "07 3391 2200", IsFullyModified = true, IsWheelchairAccessible = true, BedroomCount = 4, BedCount = 7, MaxCapacity = 9, BeddingConfiguration = "2x king (adjustable), 3x single, 1x double", HoistBathroomNotes = "Mobile hoist available. Roll-in shower in master. Grab rails throughout.", AccessibilityNotes = "Level entry from car park. Wide doorways. Lift to all floors. City views." },
            new() { Id = Guid.Parse("f3000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, PropertyName = "Cairns Esplanade Accessible Apartments", ProviderOwner = "North QLD Accessible Travel", Location = "Cairns, QLD", Region = "North QLD", Address = "212 The Esplanade", Suburb = "Cairns", State = "QLD", Postcode = "4870", ContactPerson = "Trish Lawson", Email = "bookings@nqat.com.au", Phone = "07 4031 8800", IsFullyModified = true, IsWheelchairAccessible = true, BedroomCount = 5, BedCount = 8, MaxCapacity = 10, BeddingConfiguration = "2x king (adjustable), 2x queen, 2x single", HoistBathroomNotes = "Ceiling hoist in master. Two roll-in showers. Shower commode available.", AccessibilityNotes = "Ground floor. 50m to Esplanade boardwalk. Pool with hoist. Parking onsite." },
        };
        context.AccommodationProperties.AddRange(properties);

        // ── Vehicles (4) ─────────────────────────────────────────
        var vehicles = new List<Vehicle>
        {
            new() { Id = Guid.Parse("f2000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, VehicleName = "Toyota HiAce Accessible Van", Registration = "123ABC", VehicleType = VehicleType.AccessibleVan, TotalSeats = 8, WheelchairPositions = 2, RampHoistDetails = "Electric rear ramp, 300kg capacity. Wheelchair tie-down system.", DriverRequirements = "LR licence. Manual handling cert for ramp operation.", IsInternal = true, ServiceDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(2)), RegistrationDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(8)) },
            new() { Id = Guid.Parse("f2000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, VehicleName = "Kia Carnival", Registration = "456XYZ", VehicleType = VehicleType.Van, TotalSeats = 8, WheelchairPositions = 0, DriverRequirements = "Standard C licence", IsInternal = true, ServiceDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(4)), RegistrationDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(10)) },
            // New vehicles
            new() { Id = Guid.Parse("f4000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, VehicleName = "Toyota HiAce Accessible Van 2", Registration = "789DEF", VehicleType = VehicleType.AccessibleVan, TotalSeats = 9, WheelchairPositions = 2, RampHoistDetails = "Hydraulic side ramp, 350kg capacity. 2x Q-straint tie-down positions.", DriverRequirements = "LR licence. Manual handling cert for ramp operation.", IsInternal = true, ServiceDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(6)), RegistrationDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(14)), Notes = "Newer model. Air suspension for smoother ride." },
            new() { Id = Guid.Parse("f4000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, VehicleName = "Toyota Coaster Minibus", Registration = "321GHI", VehicleType = VehicleType.MiniBus, TotalSeats = 21, WheelchairPositions = 0, DriverRequirements = "MR licence required.", IsInternal = false, ServiceDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(1)), RegistrationDueDate = DateOnly.FromDateTime(DateTime.UtcNow.AddMonths(5)), Notes = "Hire vehicle. Contact Gold Coast Charter Bus for booking." },
        };
        context.Vehicles.AddRange(vehicles);

        // ── Trip Instances (10) ──────────────────────────────────
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var trips = new List<TripInstance>
        {
            // Original 5
            new() { Id = Guid.Parse("01000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, TripName = "Gold Coast Beach Break — Autumn 2026", TripCode = "GCBB-2026A", EventTemplateId = templates[0].Id, Destination = "Gold Coast, QLD", Region = "South East QLD", StartDate = today.AddDays(45), DurationDays = 5, Status = TripStatus.OpenForBookings, LeadCoordinatorId = users[0].Id, MinParticipants = 4, MaxParticipants = 6, RequiredWheelchairCapacity = 2, RequiredBeds = 6, RequiredBedrooms = 4, MinStaffRequired = 3, Notes = "Main autumn trip. Focus on beach and water activities." },
            new() { Id = Guid.Parse("01000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, TripName = "Blue Mountains Adventure — Spring 2026", TripCode = "BMA-2026S", EventTemplateId = templates[1].Id, Destination = "Katoomba, NSW", Region = "Greater Sydney", StartDate = today.AddDays(90), DurationDays = 4, Status = TripStatus.Planning, LeadCoordinatorId = users[0].Id, MinParticipants = 3, MaxParticipants = 5, RequiredBeds = 5, RequiredBedrooms = 3, MinStaffRequired = 2, Notes = "Nature and adventure focus." },
            new() { Id = Guid.Parse("01000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, TripName = "Melbourne Arts Weekend — June 2026", TripCode = "MAW-2026J", EventTemplateId = templates[2].Id, Destination = "Melbourne, VIC", Region = "Melbourne Metro", StartDate = today.AddDays(120), DurationDays = 3, Status = TripStatus.Draft, LeadCoordinatorId = users[4].Id, MinParticipants = 2, MaxParticipants = 4, RequiredWheelchairCapacity = 1, RequiredBeds = 4, RequiredBedrooms = 3, MinStaffRequired = 2, Notes = "Arts and culture experience." },
            new() { Id = Guid.Parse("01000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, TripName = "Gold Coast Beach Break — Summer 2025/26", TripCode = "GCBB-2025S", EventTemplateId = templates[0].Id, Destination = "Gold Coast, QLD", Region = "South East QLD", StartDate = today.AddDays(-30), DurationDays = 5, Status = TripStatus.Completed, LeadCoordinatorId = users[0].Id, MaxParticipants = 6, MinStaffRequired = 3, Notes = "Successfully completed." },
            new() { Id = Guid.Parse("01000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, TripName = "Adelaide Food & Wine", TripCode = "AFW-2026", Destination = "Adelaide, SA", Region = "Adelaide", StartDate = today.AddDays(60), DurationDays = 3, Status = TripStatus.Cancelled, Notes = "Cancelled due to insufficient bookings." },
            // New 5
            new() { Id = Guid.Parse("09000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, TripName = "Cairns Tropical Getaway — July 2026", TripCode = "CAIRNS-2026J", EventTemplateId = templates[3].Id, Destination = "Cairns, QLD", Region = "North QLD", StartDate = today.AddDays(150), DurationDays = 7, Status = TripStatus.Planning, LeadCoordinatorId = users[9].Id, MinParticipants = 4, MaxParticipants = 8, RequiredWheelchairCapacity = 2, RequiredBeds = 8, RequiredBedrooms = 5, MinStaffRequired = 3, Notes = "First Cairns trip. Reef and rainforest focus. Confirm wheelchair access for reef pontoon." },
            new() { Id = Guid.Parse("09000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, TripName = "Gold Coast Beach Break — Winter 2026", TripCode = "GCBB-2026W", EventTemplateId = templates[0].Id, Destination = "Gold Coast, QLD", Region = "South East QLD", StartDate = today.AddDays(200), DurationDays = 5, Status = TripStatus.OpenForBookings, LeadCoordinatorId = users[0].Id, MinParticipants = 4, MaxParticipants = 7, RequiredWheelchairCapacity = 2, RequiredBeds = 7, RequiredBedrooms = 4, MinStaffRequired = 3, Notes = "Winter break — mild weather ideal for outdoor activities." },
            new() { Id = Guid.Parse("09000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, TripName = "Blue Mountains Adventure — Autumn 2026", TripCode = "BMA-2026A", EventTemplateId = templates[1].Id, Destination = "Katoomba, NSW", Region = "Greater Sydney", StartDate = today.AddDays(-90), DurationDays = 4, Status = TripStatus.Completed, LeadCoordinatorId = users[3].Id, MaxParticipants = 5, MinStaffRequired = 2, Notes = "Autumn colours trip. Completed successfully." },
            new() { Id = Guid.Parse("09000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, TripName = "Melbourne Arts Weekend — March 2026", TripCode = "MAW-2026M", EventTemplateId = templates[2].Id, Destination = "Melbourne, VIC", Region = "Melbourne Metro", StartDate = today.AddDays(-1), DurationDays = 3, Status = TripStatus.InProgress, LeadCoordinatorId = users[4].Id, MinParticipants = 2, MaxParticipants = 5, RequiredWheelchairCapacity = 1, RequiredBeds = 5, RequiredBedrooms = 3, MinStaffRequired = 2, Notes = "In progress. Day 2 of 3." },
            new() { Id = Guid.Parse("09000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, TripName = "Brisbane Day Trips — April 2026", TripCode = "BDT-2026", Destination = "Brisbane, QLD", Region = "Brisbane Metro", StartDate = today.AddDays(30), DurationDays = 2, Status = TripStatus.Cancelled, LeadCoordinatorId = users[5].Id, Notes = "Cancelled — lead coordinator unavailable. Rescheduling for later in year." },
        };
        context.TripInstances.AddRange(trips);

        // ── Bookings (30) ────────────────────────────────────────
        var bookings = new List<ParticipantBooking>
        {
            // Trip 1 — Gold Coast Autumn (OpenForBookings)
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000001"), TripInstanceId = trips[0].Id, ParticipantId = participants[0].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-20), WheelchairRequired = true, SupportRatioOverride = SupportRatio.OneToOne },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000002"), TripInstanceId = trips[0].Id, ParticipantId = participants[1].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-18), HighSupportRequired = true, NightSupportRequired = true, HasRestrictivePracticeFlag = true, SupportRatioOverride = SupportRatio.TwoToOne, RiskSupportNotes = "See BSP. Seizure protocol in place." },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000003"), TripInstanceId = trips[0].Id, ParticipantId = participants[4].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-15) },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000004"), TripInstanceId = trips[0].Id, ParticipantId = participants[5].Id, BookingStatus = BookingStatus.Held, BookingDate = today.AddDays(-10), BookingNotes = "Awaiting OOC payment confirmation" },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000005"), TripInstanceId = trips[0].Id, ParticipantId = participants[8].Id, BookingStatus = BookingStatus.Waitlist, BookingDate = today.AddDays(-5) },
            // Trip 2 — Blue Mountains (Planning)
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000006"), TripInstanceId = trips[1].Id, ParticipantId = participants[2].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today.AddDays(-7) },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000007"), TripInstanceId = trips[1].Id, ParticipantId = participants[6].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today.AddDays(-3), WheelchairRequired = true },
            // Trip 3 — Melbourne Arts (Draft)
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000008"), TripInstanceId = trips[2].Id, ParticipantId = participants[3].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today, WheelchairRequired = true, HighSupportRequired = true, NightSupportRequired = true },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000009"), TripInstanceId = trips[2].Id, ParticipantId = participants[9].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today, WheelchairRequired = true },
            // Trip 4 — Completed
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000010"), TripInstanceId = trips[3].Id, ParticipantId = participants[0].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-60), WheelchairRequired = true },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000011"), TripInstanceId = trips[3].Id, ParticipantId = participants[4].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-55) },
            new() { Id = Guid.Parse("02000000-0000-0000-0000-000000000012"), TripInstanceId = trips[3].Id, ParticipantId = participants[8].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-50) },
            // New bookings
            // Trip 6 — Cairns (Planning)
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000001"), TripInstanceId = trips[5].Id, ParticipantId = participants[19].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today.AddDays(-14), WheelchairRequired = true, BookingNotes = "Keen on reef tour. Confirm wheelchair access for pontoon." },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000002"), TripInstanceId = trips[5].Id, ParticipantId = participants[10].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-20) },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000003"), TripInstanceId = trips[5].Id, ParticipantId = participants[14].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-18) },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000004"), TripInstanceId = trips[5].Id, ParticipantId = participants[15].Id, BookingStatus = BookingStatus.Held, BookingDate = today.AddDays(-10), WheelchairRequired = true, HighSupportRequired = true, NightSupportRequired = true, BookingNotes = "Awaiting medical clearance from GP." },
            // Trip 7 — GC Winter (OpenForBookings)
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000005"), TripInstanceId = trips[6].Id, ParticipantId = participants[0].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-5), WheelchairRequired = true },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000006"), TripInstanceId = trips[6].Id, ParticipantId = participants[11].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-3), WheelchairRequired = true },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000007"), TripInstanceId = trips[6].Id, ParticipantId = participants[4].Id, BookingStatus = BookingStatus.Enquiry, BookingDate = today.AddDays(-2) },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000008"), TripInstanceId = trips[6].Id, ParticipantId = participants[18].Id, BookingStatus = BookingStatus.Waitlist, BookingDate = today },
            // Trip 8 — BMA Completed
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000009"), TripInstanceId = trips[7].Id, ParticipantId = participants[2].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-120), WheelchairRequired = false },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000010"), TripInstanceId = trips[7].Id, ParticipantId = participants[6].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-115), WheelchairRequired = true },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000011"), TripInstanceId = trips[7].Id, ParticipantId = participants[16].Id, BookingStatus = BookingStatus.Completed, BookingDate = today.AddDays(-110) },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000012"), TripInstanceId = trips[7].Id, ParticipantId = participants[12].Id, BookingStatus = BookingStatus.Cancelled, BookingDate = today.AddDays(-100), CancellationReason = "Medical — cardiac clearance not obtained in time." },
            // Trip 9 — Melbourne InProgress
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000013"), TripInstanceId = trips[8].Id, ParticipantId = participants[3].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-40), WheelchairRequired = true, HighSupportRequired = true, NightSupportRequired = true },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000014"), TripInstanceId = trips[8].Id, ParticipantId = participants[13].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-35) },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000015"), TripInstanceId = trips[8].Id, ParticipantId = participants[17].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-30), HighSupportRequired = true, NightSupportRequired = true, HasRestrictivePracticeFlag = true },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000016"), TripInstanceId = trips[8].Id, ParticipantId = participants[7].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-28), HighSupportRequired = true, HasRestrictivePracticeFlag = true, RiskSupportNotes = "Flight risk in unfamiliar environments. Line-of-sight at all times." },
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000017"), TripInstanceId = trips[8].Id, ParticipantId = participants[9].Id, BookingStatus = BookingStatus.NoLongerAttending, BookingDate = today.AddDays(-45), CancellationReason = "Family obligations — withdrew 2 weeks prior." },
            // Trip 1 extra — Cairns additional confirmed
            new() { Id = Guid.Parse("0a000000-0000-0000-0000-000000000018"), TripInstanceId = trips[5].Id, ParticipantId = participants[16].Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today.AddDays(-8) },
        };
        context.ParticipantBookings.AddRange(bookings);

        // ── Accommodation Reservations (6) ───────────────────────
        var reservations = new List<AccommodationReservation>
        {
            new() { Id = Guid.Parse("03000000-0000-0000-0000-000000000001"), TripInstanceId = trips[0].Id, AccommodationPropertyId = properties[0].Id, CheckInDate = trips[0].StartDate, CheckOutDate = trips[0].StartDate.AddDays(trips[0].DurationDays), ReservationStatus = ReservationStatus.Confirmed, ConfirmationReference = "AHQ-2026-0451", DateBooked = today.AddDays(-15), DateConfirmed = today.AddDays(-10), BedroomsReserved = 4, BedsReserved = 6, Cost = 2800.00m, Comments = "Full villa booked. Confirmed ceiling hoist in master bedroom." },
            new() { Id = Guid.Parse("03000000-0000-0000-0000-000000000002"), TripInstanceId = trips[1].Id, AccommodationPropertyId = properties[1].Id, CheckInDate = trips[1].StartDate, CheckOutDate = trips[1].StartDate.AddDays(trips[1].DurationDays), ReservationStatus = ReservationStatus.Requested, RequestSentDate = today.AddDays(-5), BedroomsReserved = 3, BedsReserved = 5, Comments = "Awaiting confirmation from Mountain Heritage." },
            // New reservations
            new() { Id = Guid.Parse("0b000000-0000-0000-0000-000000000001"), TripInstanceId = trips[5].Id, AccommodationPropertyId = properties[5].Id, CheckInDate = trips[5].StartDate, CheckOutDate = trips[5].StartDate.AddDays(trips[5].DurationDays), ReservationStatus = ReservationStatus.Requested, RequestSentDate = today.AddDays(-10), BedroomsReserved = 5, BedsReserved = 8, Comments = "Requested for 8 participants + 3 staff. Confirm hoist availability." },
            new() { Id = Guid.Parse("0b000000-0000-0000-0000-000000000002"), TripInstanceId = trips[6].Id, AccommodationPropertyId = properties[0].Id, CheckInDate = trips[6].StartDate, CheckOutDate = trips[6].StartDate.AddDays(trips[6].DurationDays), ReservationStatus = ReservationStatus.Booked, DateBooked = today.AddDays(-2), BedroomsReserved = 4, BedsReserved = 7, Cost = 3150.00m, ConfirmationReference = "AHQ-2026-0612" },
            new() { Id = Guid.Parse("0b000000-0000-0000-0000-000000000003"), TripInstanceId = trips[8].Id, AccommodationPropertyId = properties[2].Id, CheckInDate = trips[8].StartDate, CheckOutDate = trips[8].StartDate.AddDays(trips[8].DurationDays), ReservationStatus = ReservationStatus.Confirmed, DateBooked = today.AddDays(-35), DateConfirmed = today.AddDays(-30), BedroomsReserved = 3, BedsReserved = 5, Cost = 1650.00m, ConfirmationReference = "ISM-2026-8831", Comments = "CBD apartments. Mobile hoist confirmed. In progress." },
            new() { Id = Guid.Parse("0b000000-0000-0000-0000-000000000004"), TripInstanceId = trips[7].Id, AccommodationPropertyId = properties[1].Id, CheckInDate = trips[7].StartDate, CheckOutDate = trips[7].StartDate.AddDays(trips[7].DurationDays), ReservationStatus = ReservationStatus.Confirmed, DateBooked = today.AddDays(-110), DateConfirmed = today.AddDays(-105), BedroomsReserved = 3, BedsReserved = 5, Cost = 1900.00m, ConfirmationReference = "MHL-2025-4422", Comments = "Completed stay. No issues reported." },
        };
        context.AccommodationReservations.AddRange(reservations);

        // ── Vehicle Assignments (6) ──────────────────────────────
        var vehicleAssignments = new List<VehicleAssignment>
        {
            new() { Id = Guid.Parse("04000000-0000-0000-0000-000000000001"), TripInstanceId = trips[0].Id, VehicleId = vehicles[0].Id, Status = VehicleAssignmentStatus.Confirmed, ConfirmedDate = today.AddDays(-10), DriverUserId = users[1].Id, SeatRequirement = 6, WheelchairPositionRequirement = 1, PickupTravelNotes = "Pickup from Coorparoo 7:00 AM, then Toowong 7:30 AM" },
            new() { Id = Guid.Parse("04000000-0000-0000-0000-000000000002"), TripInstanceId = trips[0].Id, VehicleId = vehicles[1].Id, Status = VehicleAssignmentStatus.Requested, DriverUserId = users[2].Id, SeatRequirement = 4 },
            // New vehicle assignments
            new() { Id = Guid.Parse("0c000000-0000-0000-0000-000000000001"), TripInstanceId = trips[5].Id, VehicleId = vehicles[0].Id, Status = VehicleAssignmentStatus.Requested, DriverUserId = users[9].Id, SeatRequirement = 8, WheelchairPositionRequirement = 2, PickupTravelNotes = "Airport transfers required. Confirm flight times 2 weeks prior." },
            new() { Id = Guid.Parse("0c000000-0000-0000-0000-000000000002"), TripInstanceId = trips[6].Id, VehicleId = vehicles[2].Id, Status = VehicleAssignmentStatus.Confirmed, ConfirmedDate = today.AddDays(-2), DriverUserId = users[5].Id, SeatRequirement = 7, WheelchairPositionRequirement = 2 },
            new() { Id = Guid.Parse("0c000000-0000-0000-0000-000000000003"), TripInstanceId = trips[8].Id, VehicleId = vehicles[1].Id, Status = VehicleAssignmentStatus.Confirmed, ConfirmedDate = today.AddDays(-30), DriverUserId = users[4].Id, SeatRequirement = 5, PickupTravelNotes = "Depart Melbourne CBD. Southern Cross Station pickup." },
            new() { Id = Guid.Parse("0c000000-0000-0000-0000-000000000004"), TripInstanceId = trips[7].Id, VehicleId = vehicles[1].Id, Status = VehicleAssignmentStatus.Confirmed, ConfirmedDate = today.AddDays(-100), DriverUserId = users[3].Id, SeatRequirement = 5, WheelchairPositionRequirement = 1, Comments = "Completed. No issues." },
        };
        context.VehicleAssignments.AddRange(vehicleAssignments);

        // ── Staff Assignments (10) ───────────────────────────────
        var staffAssignments = new List<StaffAssignment>
        {
            new() { Id = Guid.Parse("05000000-0000-0000-0000-000000000001"), TripInstanceId = trips[0].Id, UserId = users[0].Id, AssignmentRole = "Lead Coordinator", AssignmentStart = trips[0].StartDate, AssignmentEnd = trips[0].StartDate.AddDays(trips[0].DurationDays - 1), Status = AssignmentStatus.Confirmed, SleepoverType = SleepoverType.ActiveNight },
            new() { Id = Guid.Parse("05000000-0000-0000-0000-000000000002"), TripInstanceId = trips[0].Id, UserId = users[1].Id, AssignmentRole = "Senior Support / Driver", AssignmentStart = trips[0].StartDate, AssignmentEnd = trips[0].StartDate.AddDays(trips[0].DurationDays - 1), Status = AssignmentStatus.Confirmed, IsDriver = true, SleepoverType = SleepoverType.Sleepover },
            new() { Id = Guid.Parse("05000000-0000-0000-0000-000000000003"), TripInstanceId = trips[0].Id, UserId = users[2].Id, AssignmentRole = "Support Worker", AssignmentStart = trips[0].StartDate, AssignmentEnd = trips[0].StartDate.AddDays(trips[0].DurationDays - 1), Status = AssignmentStatus.Proposed, SleepoverType = SleepoverType.Sleepover },
            // New staff assignments
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000001"), TripInstanceId = trips[5].Id, UserId = users[9].Id, AssignmentRole = "Lead Coordinator / Driver", AssignmentStart = trips[5].StartDate, AssignmentEnd = trips[5].StartDate.AddDays(trips[5].DurationDays - 1), Status = AssignmentStatus.Confirmed, IsDriver = true, SleepoverType = SleepoverType.ActiveNight },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000002"), TripInstanceId = trips[5].Id, UserId = users[5].Id, AssignmentRole = "Senior Support", AssignmentStart = trips[5].StartDate, AssignmentEnd = trips[5].StartDate.AddDays(trips[5].DurationDays - 1), Status = AssignmentStatus.Confirmed, SleepoverType = SleepoverType.Sleepover },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000003"), TripInstanceId = trips[5].Id, UserId = users[6].Id, AssignmentRole = "Support Worker", AssignmentStart = trips[5].StartDate, AssignmentEnd = trips[5].StartDate.AddDays(trips[5].DurationDays - 1), Status = AssignmentStatus.Proposed, SleepoverType = SleepoverType.PassiveNight },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000004"), TripInstanceId = trips[6].Id, UserId = users[0].Id, AssignmentRole = "Lead Coordinator", AssignmentStart = trips[6].StartDate, AssignmentEnd = trips[6].StartDate.AddDays(trips[6].DurationDays - 1), Status = AssignmentStatus.Confirmed, SleepoverType = SleepoverType.ActiveNight },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000005"), TripInstanceId = trips[6].Id, UserId = users[5].Id, AssignmentRole = "Support Worker / Driver", AssignmentStart = trips[6].StartDate, AssignmentEnd = trips[6].StartDate.AddDays(trips[6].DurationDays - 1), Status = AssignmentStatus.Confirmed, IsDriver = true, SleepoverType = SleepoverType.Sleepover },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000006"), TripInstanceId = trips[8].Id, UserId = users[4].Id, AssignmentRole = "Lead Coordinator / Driver", AssignmentStart = trips[8].StartDate, AssignmentEnd = trips[8].StartDate.AddDays(trips[8].DurationDays - 1), Status = AssignmentStatus.Confirmed, IsDriver = true, SleepoverType = SleepoverType.ActiveNight },
            new() { Id = Guid.Parse("0d000000-0000-0000-0000-000000000007"), TripInstanceId = trips[8].Id, UserId = users[6].Id, AssignmentRole = "Support Worker", AssignmentStart = trips[8].StartDate, AssignmentEnd = trips[8].StartDate.AddDays(trips[8].DurationDays - 1), Status = AssignmentStatus.Confirmed, SleepoverType = SleepoverType.Sleepover },
        };
        context.StaffAssignments.AddRange(staffAssignments);

        // ── Staff Availability ───────────────────────────────────
        var staffAvailability = new List<StaffAvailability>
        {
            new() { Id = Guid.NewGuid(), UserId = users[0].Id, StartDateTime = trips[0].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[0].StartDate.AddDays(trips[0].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available, Notes = "Booked for GC Autumn trip" },
            new() { Id = Guid.NewGuid(), UserId = users[1].Id, StartDateTime = trips[0].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[0].StartDate.AddDays(trips[0].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available },
            new() { Id = Guid.NewGuid(), UserId = users[3].Id, StartDateTime = trips[0].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[0].StartDate.AddDays(3).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Leave, Notes = "Annual leave" },
            new() { Id = Guid.NewGuid(), UserId = users[4].Id, StartDateTime = trips[8].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[8].StartDate.AddDays(trips[8].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available, Notes = "Melbourne trip in progress" },
            new() { Id = Guid.NewGuid(), UserId = users[6].Id, StartDateTime = trips[8].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[8].StartDate.AddDays(trips[8].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available },
            new() { Id = Guid.NewGuid(), UserId = users[2].Id, StartDateTime = today.AddDays(10).ToDateTime(TimeOnly.MinValue), EndDateTime = today.AddDays(17).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Training, Notes = "Manual handling refresher course" },
            new() { Id = Guid.NewGuid(), UserId = users[5].Id, StartDateTime = trips[5].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[5].StartDate.AddDays(trips[5].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available, Notes = "Booked for Cairns trip" },
            new() { Id = Guid.NewGuid(), UserId = users[9].Id, StartDateTime = trips[5].StartDate.ToDateTime(TimeOnly.MinValue), EndDateTime = trips[5].StartDate.AddDays(trips[5].DurationDays).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Available, Notes = "Lead for Cairns trip" },
            new() { Id = Guid.NewGuid(), UserId = users[7].Id, StartDateTime = today.AddDays(20).ToDateTime(TimeOnly.MinValue), EndDateTime = today.AddDays(27).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Unavailable, Notes = "Personal leave — approved" },
            new() { Id = Guid.NewGuid(), UserId = users[8].Id, StartDateTime = today.ToDateTime(TimeOnly.MinValue), EndDateTime = today.AddDays(60).ToDateTime(TimeOnly.MinValue), AvailabilityType = AvailabilityType.Preferred, Notes = "Available for all Sydney-region trips" },
        };
        context.StaffAvailabilities.AddRange(staffAvailability);

        // ── Activities (25) ──────────────────────────────────────
        var starter = StarterActivities.For(demoTenantId, keepSeedIds: true);   // the generic activities, shared with tenant set-up (see StarterActivities)
        var activities = new List<Activity>
        {
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, EventTemplateId = templates[0].Id, ActivityName = "Beach Morning — Surfers Paradise", Category = ActivityCategory.Leisure, Location = "Surfers Paradise Beach", AccessibilityNotes = "Beach wheelchair available", SuitabilityNotes = "All abilities" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, EventTemplateId = templates[0].Id, ActivityName = "Currumbin Wildlife Sanctuary", Category = ActivityCategory.Sightseeing, Location = "Currumbin", AccessibilityNotes = "Fully wheelchair accessible", SuitabilityNotes = "All abilities. Some animal encounters may not suit sensory sensitivities." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, EventTemplateId = templates[0].Id, ActivityName = "Broadwater Parklands Picnic", Category = ActivityCategory.Leisure, Location = "Southport", AccessibilityNotes = "Accessible paths and facilities" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, EventTemplateId = templates[0].Id, ActivityName = "Pacific Fair Shopping", Category = ActivityCategory.Leisure, Location = "Broadbeach", AccessibilityNotes = "Fully accessible shopping centre" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, EventTemplateId = templates[0].Id, ActivityName = "Gold Coast Aquatic Centre", Category = ActivityCategory.Sport, Location = "Southport", AccessibilityNotes = "Pool hoist available. Accessible change rooms.", SuitabilityNotes = "Swimming ability varies — assess individually" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, EventTemplateId = templates[1].Id, ActivityName = "Three Sisters Lookout", Category = ActivityCategory.Sightseeing, Location = "Echo Point, Katoomba", AccessibilityNotes = "Main lookout wheelchair accessible", SuitabilityNotes = "All abilities at lookout. Walking tracks require mobility." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, EventTemplateId = templates[1].Id, ActivityName = "Scenic World", Category = ActivityCategory.Adventure, Location = "Katoomba", AccessibilityNotes = "Skyway and Railway have accessibility limitations. Cableway is accessible.", SuitabilityNotes = "May not suit anxiety/heights" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, EventTemplateId = templates[1].Id, ActivityName = "Leura Village Walk", Category = ActivityCategory.Leisure, Location = "Leura", AccessibilityNotes = "Footpaths mostly level. Some shops have steps." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, EventTemplateId = templates[1].Id, ActivityName = "Govetts Leap Lookout", Category = ActivityCategory.Sightseeing, Location = "Blackheath", AccessibilityNotes = "Lookout accessible. Walking tracks are not." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000010"), TenantId = demoTenantId, EventTemplateId = templates[2].Id, ActivityName = "National Gallery of Victoria", Category = ActivityCategory.Cultural, Location = "Melbourne CBD", AccessibilityNotes = "Fully accessible", SuitabilityNotes = "All abilities. Quiet hours available." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000011"), TenantId = demoTenantId, EventTemplateId = templates[2].Id, ActivityName = "Melbourne Museum", Category = ActivityCategory.Cultural, Location = "Carlton", AccessibilityNotes = "Fully accessible. Sensory guides available." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000012"), TenantId = demoTenantId, EventTemplateId = templates[2].Id, ActivityName = "Lygon Street Lunch", Category = ActivityCategory.Dining, Location = "Carlton", AccessibilityNotes = "Most restaurants have step-free access" },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000013"), TenantId = demoTenantId, EventTemplateId = templates[2].Id, ActivityName = "Queen Victoria Market", Category = ActivityCategory.Sightseeing, Location = "Melbourne CBD", AccessibilityNotes = "Outdoor areas accessible. Some indoor sheds have narrow aisles." },
            starter[0],
            starter[1],
            starter[2],
            starter[3],
            starter[4],
            starter[5],
            starter[6],
            // New activities for Cairns
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000021"), TenantId = demoTenantId, EventTemplateId = templates[3].Id, ActivityName = "Cairns Esplanade Lagoon", Category = ActivityCategory.Leisure, Location = "Cairns Esplanade", AccessibilityNotes = "Free public pool. Accessible entry ramps. Changing facilities accessible.", SuitabilityNotes = "All abilities. Lifeguards on duty." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000022"), TenantId = demoTenantId, EventTemplateId = templates[3].Id, ActivityName = "Great Barrier Reef Pontoon Tour", Category = ActivityCategory.Adventure, Location = "Outer Great Barrier Reef", AccessibilityNotes = "Accessible boarding ramp on pontoon. Semi-submersible suitable for non-swimmers. Call ahead for wheelchair boarding.", SuitabilityNotes = "Confirm medical suitability. Not suitable for participants with severe epilepsy unless cleared." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000023"), TenantId = demoTenantId, EventTemplateId = templates[3].Id, ActivityName = "Kuranda Scenic Railway & Village", Category = ActivityCategory.Sightseeing, Location = "Kuranda, QLD", AccessibilityNotes = "Train carriages accessible. Kuranda village mostly accessible.", SuitabilityNotes = "All abilities. Long journey — bring snacks." },
            new() { Id = Guid.Parse("06000000-0000-0000-0000-000000000024"), TenantId = demoTenantId, EventTemplateId = templates[3].Id, ActivityName = "Cairns Night Markets", Category = ActivityCategory.Dining, Location = "Cairns CBD", AccessibilityNotes = "Accessible paths. Some vendor stalls may have narrow access.", SuitabilityNotes = "Evening sensory environment — assess individually." },
            // Generic
            starter[7],
        };
        context.Activities.AddRange(activities);

        // ── Trip Days + Scheduled Activities (Trips 1, 2, 3) ─────
        var tripDays = new List<TripDay>();
        var scheduledActivities = new List<ScheduledActivity>();

        // Trip 1 — Gold Coast Autumn
        for (int i = 0; i < trips[0].DurationDays; i++)
        {
            var day = new TripDay
            {
                Id = Guid.Parse($"07000000-0000-0000-0000-00000000000{i + 1}"),
                TripInstanceId = trips[0].Id,
                DayNumber = i + 1,
                Date = trips[0].StartDate.AddDays(i),
                DayTitle = i == 0 ? "Arrival Day" : i == trips[0].DurationDays - 1 ? "Departure Day" : $"Day {i + 1} — {(i == 1 ? "Beach Day" : i == 2 ? "Wildlife & Shopping" : "Pool & Relaxation")}"
            };
            tripDays.Add(day);

            if (i == 0)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[15].Id, Title = "Arrival & Settling In", StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), SortOrder = 1, Status = ScheduledActivityStatus.Confirmed, Notes = "Meet at accommodation. Unpack, room allocation, house orientation." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[2].Id, Title = "Broadwater Parklands Picnic", StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(17, 0), SortOrder = 2, Status = ScheduledActivityStatus.Booked, BookingReference = "BPK-2026-0503", ProviderName = "Gold Coast City Council Parks", EstimatedCost = 0m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[13].Id, Title = "Group Dinner Out", StartTime = new TimeOnly(18, 0), EndTime = new TimeOnly(20, 0), SortOrder = 3, Status = ScheduledActivityStatus.Booked, BookingReference = "RES-88412", ProviderName = "The Fish House", ProviderPhone = "07 5527 1122", EstimatedCost = 320.00m });
            }
            else if (i == 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[0].Id, Title = "Beach Morning — Surfers Paradise", StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0), SortOrder = 1, Status = ScheduledActivityStatus.Confirmed, EstimatedCost = 0m, Location = "Surfers Paradise Beach" });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[17].Id, Title = "Free Time / Rest", StartTime = new TimeOnly(12, 30), EndTime = new TimeOnly(14, 0), SortOrder = 2, Status = ScheduledActivityStatus.Planned });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[14].Id, Title = "Movie Night In", StartTime = new TimeOnly(19, 0), EndTime = new TimeOnly(21, 0), SortOrder = 3, Status = ScheduledActivityStatus.Planned, EstimatedCost = 45.00m });
            }
            else if (i == 2)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[1].Id, Title = "Currumbin Wildlife Sanctuary", StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(13, 0), SortOrder = 1, Status = ScheduledActivityStatus.Booked, BookingReference = "CWS-GRP-4821", ProviderName = "Currumbin Wildlife Sanctuary", ProviderPhone = "07 5534 1266", EstimatedCost = 270.00m, Location = "28 Tomewin St, Currumbin" });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[17].Id, Title = "Lunch & Rest", StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(14, 30), SortOrder = 2, Status = ScheduledActivityStatus.Planned, EstimatedCost = 90.00m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[3].Id, Title = "Pacific Fair Shopping", StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(17, 30), SortOrder = 3, Status = ScheduledActivityStatus.Confirmed, EstimatedCost = 50.00m, Location = "Hooker Blvd, Broadbeach" });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[13].Id, Title = "Pizza Night", StartTime = new TimeOnly(18, 30), EndTime = new TimeOnly(20, 0), SortOrder = 4, Status = ScheduledActivityStatus.Planned, EstimatedCost = 120.00m, Location = "Accommodation" });
            }
            else if (i == 3)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[4].Id, Title = "Gold Coast Aquatic Centre", StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(12, 0), SortOrder = 1, Status = ScheduledActivityStatus.Booked, BookingReference = "GCAC-20260506-AM", ProviderName = "Gold Coast Aquatic Centre", ProviderPhone = "07 5581 7946", EstimatedCost = 72.00m, Location = "Marine Pde, Southport" });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[17].Id, Title = "Free Time / Rest", StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(15, 0), SortOrder = 2, Status = ScheduledActivityStatus.Planned });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[18].Id, Title = "Bowling", StartTime = new TimeOnly(15, 30), EndTime = new TimeOnly(17, 30), SortOrder = 3, Status = ScheduledActivityStatus.Confirmed, BookingReference = "INF-BK-7743", ProviderName = "Infinity Bowling Gold Coast", EstimatedCost = 108.00m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[19].Id, Title = "Farewell Dinner — Local Café", StartTime = new TimeOnly(18, 30), EndTime = new TimeOnly(20, 30), SortOrder = 4, Status = ScheduledActivityStatus.Booked, ProviderName = "The Banana Grind Café", EstimatedCost = 280.00m });
            }
            else if (i == trips[0].DurationDays - 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[16].Id, Title = "Departure & Travel Home", StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(14, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Notes = "Pack up by 10am. Checkout 10:30am. Estimated arrival back 2pm." });
            }
        }

        // Trip 2 — Blue Mountains Adventure (4 days)
        var bmaTrip = trips[1];
        var bmaDayTitles = new[] { "Arrival Day", "Day 2 — Blue Mountains & Scenic World", "Day 3 — Leura & Blackheath", "Departure Day" };
        for (int i = 0; i < bmaTrip.DurationDays; i++)
        {
            var day = new TripDay
            {
                Id = Guid.Parse($"17000000-0000-0000-0000-00000000000{i + 1}"),
                TripInstanceId = bmaTrip.Id,
                DayNumber = i + 1,
                Date = bmaTrip.StartDate.AddDays(i),
                DayTitle = bmaDayTitles[i]
            };
            tripDays.Add(day);

            if (i == 0)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[15].Id, Title = "Arrival & Settling In", StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(15, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Notes = "Check in at Mountain Heritage Lodge. Room allocation." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[13].Id, Title = "Welcome Dinner", StartTime = new TimeOnly(18, 0), EndTime = new TimeOnly(20, 0), SortOrder = 2, Status = ScheduledActivityStatus.Planned, Location = "Mountain Heritage Lodge dining room", EstimatedCost = 180.00m });
            }
            else if (i == 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[5].Id, Title = "Three Sisters Lookout", StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(11, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Location = "Echo Point, Katoomba", AccessibilityNotes = "Main lookout accessible. Giant Stairway not suitable for wheelchairs." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[6].Id, Title = "Scenic World", StartTime = new TimeOnly(11, 30), EndTime = new TimeOnly(14, 0), SortOrder = 2, Status = ScheduledActivityStatus.Planned, Location = "Scenic World, Katoomba", EstimatedCost = 220.00m, Notes = "Skyway and Cableway recommended. Assess anxiety re: heights." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[19].Id, Title = "Lunch at Katoomba Café", StartTime = new TimeOnly(14, 30), EndTime = new TimeOnly(15, 30), SortOrder = 3, Status = ScheduledActivityStatus.Planned, EstimatedCost = 120.00m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[17].Id, Title = "Free Time / Rest", StartTime = new TimeOnly(16, 0), EndTime = new TimeOnly(18, 0), SortOrder = 4, Status = ScheduledActivityStatus.Planned });
            }
            else if (i == 2)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[7].Id, Title = "Leura Village Walk & Shopping", StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 30), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Location = "Leura Mall, Leura" });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[13].Id, Title = "Leura Lunch", StartTime = new TimeOnly(12, 30), EndTime = new TimeOnly(14, 0), SortOrder = 2, Status = ScheduledActivityStatus.Planned, EstimatedCost = 150.00m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[8].Id, Title = "Govetts Leap Lookout", StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(16, 30), SortOrder = 3, Status = ScheduledActivityStatus.Planned, Location = "Blackheath", Notes = "Afternoon light excellent for photos." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[14].Id, Title = "Movie Night In", StartTime = new TimeOnly(19, 0), EndTime = new TimeOnly(21, 0), SortOrder = 4, Status = ScheduledActivityStatus.Planned, EstimatedCost = 30.00m });
            }
            else if (i == bmaTrip.DurationDays - 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[16].Id, Title = "Departure & Travel Home", StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(15, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Notes = "Checkout by 10am. Return trip to Sydney. Drop-off by 3pm." });
            }
        }

        // Trip 3 — Melbourne Arts Weekend (3 days)
        var mawTrip = trips[2];
        var mawDayTitles = new[] { "Arrival Day — Gallery & Dinner", "Day 2 — Museum & Market", "Departure Day" };
        for (int i = 0; i < mawTrip.DurationDays; i++)
        {
            var day = new TripDay
            {
                Id = Guid.Parse($"27000000-0000-0000-0000-00000000000{i + 1}"),
                TripInstanceId = mawTrip.Id,
                DayNumber = i + 1,
                Date = mawTrip.StartDate.AddDays(i),
                DayTitle = mawDayTitles[i]
            };
            tripDays.Add(day);

            if (i == 0)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[15].Id, Title = "Arrival & Settling In", StartTime = new TimeOnly(11, 0), EndTime = new TimeOnly(14, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Notes = "Check in at CBD Accessible Apartments. Southern Cross station nearby." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[9].Id, Title = "National Gallery of Victoria", StartTime = new TimeOnly(14, 30), EndTime = new TimeOnly(17, 30), SortOrder = 2, Status = ScheduledActivityStatus.Confirmed, Location = "180 St Kilda Rd, Melbourne", AccessibilityNotes = "Fully accessible. Free entry to permanent collection.", EstimatedCost = 0m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[11].Id, Title = "Lygon Street Dinner", StartTime = new TimeOnly(18, 30), EndTime = new TimeOnly(20, 30), SortOrder = 3, Status = ScheduledActivityStatus.Planned, Location = "Lygon Street, Carlton", EstimatedCost = 260.00m });
            }
            else if (i == 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[10].Id, Title = "Melbourne Museum", StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(13, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Location = "11 Nicholson St, Carlton", EstimatedCost = 60.00m, AccessibilityNotes = "Fully accessible. Sensory guide available at entry." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[17].Id, Title = "Lunch & Rest", StartTime = new TimeOnly(13, 0), EndTime = new TimeOnly(14, 30), SortOrder = 2, Status = ScheduledActivityStatus.Planned, EstimatedCost = 80.00m });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[12].Id, Title = "Queen Victoria Market", StartTime = new TimeOnly(15, 0), EndTime = new TimeOnly(17, 0), SortOrder = 3, Status = ScheduledActivityStatus.Planned, Location = "Queen St, Melbourne", Notes = "Afternoon session less crowded. Budget $20pp for souvenirs." });
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[13].Id, Title = "Farewell Dinner", StartTime = new TimeOnly(18, 30), EndTime = new TimeOnly(20, 30), SortOrder = 4, Status = ScheduledActivityStatus.Planned, Location = "Melbourne CBD", EstimatedCost = 300.00m });
            }
            else if (i == mawTrip.DurationDays - 1)
            {
                scheduledActivities.Add(new() { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activities[16].Id, Title = "Departure & Travel Home", StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(14, 0), SortOrder = 1, Status = ScheduledActivityStatus.Planned, Notes = "Checkout by 10am. Transfers to airport or Southern Cross Station." });
            }
        }

        context.TripDays.AddRange(tripDays);
        context.ScheduledActivities.AddRange(scheduledActivities);

        // ── Tasks (20) ───────────────────────────────────────────
        var tasks = new List<BookingTask>
        {
            // Original tasks — Trip 1
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000001"), TripInstanceId = trips[0].Id, TaskType = TaskType.AccommodationConfirmation, Title = "Confirm accommodation booking — Mermaid Waters Villas", OwnerId = users[0].Id, Priority = TaskPriority.High, DueDate = today.AddDays(-5), Status = TaskItemStatus.Completed, CompletedDate = today.AddDays(-6) },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000002"), TripInstanceId = trips[0].Id, ParticipantBookingId = bookings[1].Id, TaskType = TaskType.RiskReview, Title = "Review BSP and seizure protocol — Sophie Brown", OwnerId = users[0].Id, Priority = TaskPriority.Urgent, DueDate = today.AddDays(7), Status = TaskItemStatus.InProgress },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000003"), TripInstanceId = trips[0].Id, ParticipantBookingId = bookings[3].Id, TaskType = TaskType.InvoiceOop, Title = "Chase OOC payment — Mia Anderson", OwnerId = users[0].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(14), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000004"), TripInstanceId = trips[0].Id, TaskType = TaskType.VehicleConfirmation, Title = "Confirm second vehicle — Kia Carnival", OwnerId = users[1].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(21), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000005"), TripInstanceId = trips[0].Id, TaskType = TaskType.StaffingAllocation, Title = "Confirm third staff member for GC trip", OwnerId = users[0].Id, Priority = TaskPriority.High, DueDate = today.AddDays(14), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000006"), TripInstanceId = trips[0].Id, TaskType = TaskType.MedicationCheck, Title = "Medication chart updated — all confirmed participants", OwnerId = users[1].Id, Priority = TaskPriority.High, DueDate = today.AddDays(30), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000007"), TripInstanceId = trips[0].Id, TaskType = TaskType.PreDeparture, Title = "Send pre-trip info packs to families", OwnerId = users[0].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(35), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000008"), TripInstanceId = trips[1].Id, TaskType = TaskType.AccommodationRequest, Title = "Send accommodation request — Mountain Heritage Lodge", OwnerId = users[0].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(10), Status = TaskItemStatus.InProgress },
            new() { Id = Guid.Parse("08000000-0000-0000-0000-000000000009"), TripInstanceId = trips[0].Id, TaskType = TaskType.FamilyContact, Title = "Contact Sophie's guardian re: trip consent", OwnerId = users[0].Id, Priority = TaskPriority.High, DueDate = today.AddDays(-3), Status = TaskItemStatus.Overdue },
            // New tasks
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000001"), TripInstanceId = trips[5].Id, TaskType = TaskType.AccommodationRequest, Title = "Send accommodation request — Cairns Esplanade Apartments", OwnerId = users[9].Id, Priority = TaskPriority.High, DueDate = today.AddDays(14), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000002"), TripInstanceId = trips[5].Id, ParticipantBookingId = bookings[15].Id, TaskType = TaskType.RiskReview, Title = "Review support profile — Harrison Lee (Cairns)", OwnerId = users[9].Id, Priority = TaskPriority.Urgent, DueDate = today.AddDays(7), Status = TaskItemStatus.InProgress, Notes = "Manual handling assessment required for reef tour. Two-person assist confirmed?" },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000003"), TripInstanceId = trips[5].Id, TaskType = TaskType.InsuranceConfirmation, Title = "Confirm travel insurance — all Cairns participants", OwnerId = users[9].Id, Priority = TaskPriority.High, DueDate = today.AddDays(21), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000004"), TripInstanceId = trips[5].Id, TaskType = TaskType.VehicleRequest, Title = "Request accessible transport — Cairns airport transfers", OwnerId = users[9].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(30), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000005"), TripInstanceId = trips[6].Id, TaskType = TaskType.AccommodationConfirmation, Title = "Confirm Mermaid Waters booking — GC Winter", OwnerId = users[0].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(5), Status = TaskItemStatus.Completed, CompletedDate = today.AddDays(-1) },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000006"), TripInstanceId = trips[6].Id, TaskType = TaskType.ParticipantConfirmation, Title = "Confirm all bookings and send info pack — GC Winter", OwnerId = users[0].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(20), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000007"), TripInstanceId = trips[8].Id, TaskType = TaskType.PostTrip, Title = "Post-trip report — Melbourne Arts March 2026", OwnerId = users[4].Id, Priority = TaskPriority.Medium, DueDate = today.AddDays(5), Status = TaskItemStatus.InProgress, Notes = "Trip in progress. Complete within 48hrs of return." },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000008"), TripInstanceId = trips[8].Id, ParticipantBookingId = bookings[25].Id, TaskType = TaskType.FamilyContact, Title = "Contact Ryan Murphy's next of kin — post-trip update", OwnerId = users[4].Id, Priority = TaskPriority.Low, DueDate = today.AddDays(4), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000009"), TripInstanceId = trips[1].Id, TaskType = TaskType.StaffingAllocation, Title = "Allocate second staff for Blue Mountains trip", OwnerId = users[3].Id, Priority = TaskPriority.High, DueDate = today.AddDays(20), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000010"), TripInstanceId = trips[5].Id, ParticipantBookingId = bookings[15].Id, TaskType = TaskType.MedicationCheck, Title = "Medication chart review — Harrison Lee pre-Cairns", OwnerId = users[5].Id, Priority = TaskPriority.High, DueDate = today.AddDays(45), Status = TaskItemStatus.NotStarted },
            new() { Id = Guid.Parse("0e000000-0000-0000-0000-000000000011"), TripInstanceId = trips[2].Id, TaskType = TaskType.AccommodationRequest, Title = "Research accessible accommodation options — Melbourne June", OwnerId = users[4].Id, Priority = TaskPriority.Low, DueDate = today.AddDays(40), Status = TaskItemStatus.NotStarted },
        };
        // BookingTask is now ITenantEntity (item 9 of the connection map) — SaveChangesAsync's
        // ambient auto-stamp doesn't fire during seeding (no HTTP context / ICurrentTenant is
        // unauthenticated here, same as every other tenant-scoped seed row), so stamp explicitly.
        // Every seeded trip above is demoTenantId, so every seeded task is too.
        foreach (var t in tasks) t.TenantId = demoTenantId;
        context.BookingTasks.AddRange(tasks);

        await context.SaveChangesAsync(ct);
    }

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
    /// Uses IgnoreQueryFilters() throughout so the tenant query filter can't cause a
    /// false negative (mirrors the pattern already used elsewhere in this file).
    /// </summary>
    private static async Task<bool> HasExistingSeedDataAsync(OdipDbContext context, CancellationToken ct)
    {
        return await context.Users.IgnoreQueryFilters().AnyAsync(u => u.Id == Guid.Parse("a2000000-0000-0000-0000-000000000001"), ct)
            || await context.EventTemplates.IgnoreQueryFilters().AnyAsync(ct)
            || await context.Participants.IgnoreQueryFilters().AnyAsync(ct)
            || await context.Contacts.IgnoreQueryFilters().AnyAsync(ct)
            || await context.AccommodationProperties.IgnoreQueryFilters().AnyAsync(ct)
            || await context.Vehicles.IgnoreQueryFilters().AnyAsync(ct)
            || await context.TripInstances.IgnoreQueryFilters().AnyAsync(ct)
            || await context.ParticipantBookings.IgnoreQueryFilters().AnyAsync(ct)
            || await context.AccommodationReservations.IgnoreQueryFilters().AnyAsync(ct)
            || await context.VehicleAssignments.IgnoreQueryFilters().AnyAsync(ct)
            || await context.StaffAssignments.IgnoreQueryFilters().AnyAsync(ct)
            || await context.StaffAvailabilities.IgnoreQueryFilters().AnyAsync(ct)
            || await context.Activities.IgnoreQueryFilters().AnyAsync(ct)
            || await context.TripDays.IgnoreQueryFilters().AnyAsync(ct)
            || await context.ScheduledActivities.IgnoreQueryFilters().AnyAsync(ct)
            || await context.BookingTasks.IgnoreQueryFilters().AnyAsync(ct);
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

    /// <summary>
    /// Seeds sample medication charts + a day of administration history for a handful of
    /// existing demo participants — deliberately covers PRN dosing limits, a chemical-restraint
    /// medication (BSP + authorisation in place), a high-risk/high-intensity injectable, and one
    /// overdue review to exercise the ReviewOverdue compliance flag. Idempotent: bails out if
    /// any ParticipantMedication already exists, and again per-participant if the demo
    /// participants this seed targets haven't been created yet (e.g. a fresh DB where
    /// SeedAsync hasn't run first).
    /// </summary>
    public static async Task SeedMedicationsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantMedications.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task: additional demo participants that now carry their own medication charts.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var miaId = Guid.Parse("d1000000-0000-0000-0000-000000000006");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var isabellaId = Guid.Parse("d2000000-0000-0000-0000-000000000001");
        var chloeId = Guid.Parse("d2000000-0000-0000-0000-000000000003");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var zoeId = Guid.Parse("d2000000-0000-0000-0000-000000000007");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");
        var natalieId = Guid.Parse("d2000000-0000-0000-0000-000000000009");

        var targetIds = new[]
        {
            sophieId, charlotteId, harrisonId,
            liamId, oliviaId, miaId, williamId, isabellaId, chloeId, graceId, zoeId, ryanId, natalieId,
        };
        var existingParticipants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var today = DateTime.UtcNow.Date;

        var levetiracetamId = Guid.Parse("70000000-0000-0000-0000-000000000001");
        var paracetamolId = Guid.Parse("70000000-0000-0000-0000-000000000002");
        var risperidoneId = Guid.Parse("70000000-0000-0000-0000-000000000003");
        var sertralineId = Guid.Parse("70000000-0000-0000-0000-000000000004");
        var insulinId = Guid.Parse("70000000-0000-0000-0000-000000000005");
        // Seed-expansion task — new medication charts covering the remaining schedule/packaging
        // variety the brief calls out (SpecificDays, EveryNDays, extra PRN/high-risk/forms).
        var prednisoloneId = Guid.Parse("70000000-0000-0000-0000-000000000006");
        var ferrousSulfateId = Guid.Parse("70000000-0000-0000-0000-000000000007");
        var warfarinId = Guid.Parse("70000000-0000-0000-0000-000000000008");
        var omeprazoleId = Guid.Parse("70000000-0000-0000-0000-000000000009");
        var movicolId = Guid.Parse("70000000-0000-0000-0000-00000000000a");
        var digoxinId = Guid.Parse("70000000-0000-0000-0000-00000000000b");
        var salbutamolId = Guid.Parse("70000000-0000-0000-0000-00000000000c");
        var betamethasoneId = Guid.Parse("70000000-0000-0000-0000-00000000000d");
        var latanoprostId = Guid.Parse("70000000-0000-0000-0000-00000000000e");
        var miaSertralineId = Guid.Parse("70000000-0000-0000-0000-00000000000f");

        var medications = new List<ParticipantMedication>();

        if (existingParticipants.Contains(sophieId))
        {
            // Sophie Brown already carries "Epilepsy medication — Keppra 500mg BD" in her
            // SupportProfile free text (Keppra is the brand name for levetiracetam) — this is
            // the structured record backing that note.
            medications.Add(new ParticipantMedication
            {
                Id = levetiracetamId, TenantId = demoTenantId, ParticipantId = sophieId,
                Name = "Levetiracetam", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (500mg)", Directions = "Take with food, morning and evening.",
                Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
                Purpose = "Seizure prophylaxis — acquired brain injury with breakthrough seizures.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Coorparoo Chemist Warehouse", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-8), NextReviewDue = today.AddMonths(4),
                ConsentObtained = true, ConsentGivenBy = "Margaret Johnson (mother)", ConsentDate = today.AddMonths(-8),
                StorageRequirements = "Store below 25°C, away from light.", Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = paracetamolId, TenantId = demoTenantId, ParticipantId = sophieId,
                Name = "Paracetamol", Strength = "500mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "2 tablets (1000mg)", Directions = "May repeat every 4-6 hours as required.",
                Type = MedicationType.Prn, PrnIndication = "Mild-moderate pain or fever",
                PrnMaxDosesPer24h = 4, PrnMinIntervalMinutes = 240,
                Purpose = "Analgesia / antipyretic.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Assist,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Coorparoo Chemist Warehouse",
                Packaging = PackagingType.Sachet,
                StartDate = today.AddMonths(-8),
                // Deliberately in the past — demonstrates the ReviewOverdue compliance flag.
                NextReviewDue = today.AddDays(-14),
                ConsentObtained = true, ConsentGivenBy = "Margaret Johnson (mother)", ConsentDate = today.AddMonths(-8),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = risperidoneId, TenantId = demoTenantId, ParticipantId = charlotteId,
                Name = "Risperidone", Strength = "0.5mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (0.5mg)", Directions = "Dissolve under tongue if severely distressed.",
                Type = MedicationType.Prn, PrnIndication = "Acute behavioural escalation posing risk to self or others",
                PrnMaxDosesPer24h = 2, PrnMinIntervalMinutes = 360,
                Purpose = "Used primarily to manage episodes of severe behavioural escalation.",
                IsPsychotropic = true, IsChemicalRestraint = true, BspInPlace = true,
                RestrictivePracticeAuthorisationRef = "QLD-RP-2026-00417",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Toowong Community Pharmacy",
                StartDate = today.AddMonths(-5), NextReviewDue = today.AddMonths(1),
                ConsentObtained = true, ConsentGivenBy = "David Brown (father/guardian)", ConsentDate = today.AddMonths(-5),
                StorageRequirements = "Store in locked medication cabinet.", Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = sertralineId, TenantId = demoTenantId, ParticipantId = charlotteId,
                Name = "Sertraline", Strength = "50mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (50mg)", Directions = "Take each morning with breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Ongoing management of generalised anxiety disorder.",
                IsPsychotropic = true, DrugSchedule = DrugSchedule.Schedule4,
                SupportLevel = MedicationSupportLevel.PromptOnly, PrescriberName = "Dr. Farid Haidari",
                PharmacyName = "Toowong Community Pharmacy", StartDate = today.AddMonths(-10),
                NextReviewDue = today.AddMonths(2), ConsentObtained = true,
                ConsentGivenBy = "David Brown (father/guardian)", ConsentDate = today.AddMonths(-10),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = insulinId, TenantId = demoTenantId, ParticipantId = harrisonId,
                Name = "Insulin Glargine", Strength = "100units/mL", Form = MedicationForm.Injection, Route = MedicationRoute.Subcutaneous,
                DoseDescription = "18 units subcutaneously", Directions = "Rotate injection site — abdomen or thigh.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Type 1 diabetes mellitus — basal insulin.",
                IsHighRisk = true, IsHighIntensitySupport = true,
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Priya Chandran", PharmacyName = "Chermside Pharmacy",
                StartDate = today.AddYears(-2), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "Harrison Lee (self)", ConsentDate = today.AddYears(-2),
                StorageRequirements = "Refrigerate 2-8°C; in-use pen may be kept below 25°C for up to 28 days.",
                Status = MedicationStatus.Active,
            });
        }

        // ── Seed-expansion task: additional medication charts ──
        if (existingParticipants.Contains(williamId))
        {
            // EveryNDays — alternate-day dosing to minimise side effects, anchored 40 days back.
            medications.Add(new ParticipantMedication
            {
                Id = prednisoloneId, TenantId = demoTenantId, ParticipantId = williamId,
                Name = "Prednisolone", Strength = "5mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (5mg)", Directions = "Take with breakfast on dosing days only.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Frequency = MedicationFrequency.EveryNDays, IntervalDays = 2, AnchorDate = DateOnly.FromDateTime(today.AddDays(-40)),
                Purpose = "Chronic inflammatory condition maintenance — alternate-day regimen to minimise long-term corticosteroid side effects.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Sanjay Mehta", PharmacyName = "Woodridge Family Pharmacy", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-3), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "William Martin (self)", ConsentDate = today.AddMonths(-3),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            // SpecificDays — Mon/Wed/Fri alternate-day iron dosing (reduces GI side effects vs daily).
            medications.Add(new ParticipantMedication
            {
                Id = ferrousSulfateId, TenantId = demoTenantId, ParticipantId = graceId,
                Name = "Ferrous Sulfate", Strength = "325mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (325mg)", Directions = "Take on an empty stomach where tolerated.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Frequency = MedicationFrequency.SpecificDays, DaysOfWeek = Weekdays.Monday | Weekdays.Wednesday | Weekdays.Friday,
                Purpose = "Iron-deficiency anaemia — alternate-day dosing per current GP guidance.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Underwood Pharmacy", Packaging = PackagingType.DosetteBox,
                StartDate = today.AddMonths(-2), NextReviewDue = today.AddMonths(4),
                ConsentObtained = true, ConsentGivenBy = "Grace O'Sullivan (self)", ConsentDate = today.AddMonths(-2),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            // High-risk (witness required) — post-stroke anticoagulation.
            medications.Add(new ParticipantMedication
            {
                Id = warfarinId, TenantId = demoTenantId, ParticipantId = ryanId,
                Name = "Warfarin", Strength = "3mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (3mg)", Directions = "Take at the same time each evening. Do not double up if a dose is missed.",
                Type = MedicationType.Regular, TimesOfDay = "18:00",
                Purpose = "Anticoagulation — atrial fibrillation following ischaemic stroke.",
                IsHighRisk = true,
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-9), NextReviewDue = today.AddMonths(1),
                ConsentObtained = true, ConsentGivenBy = "Sandra Lee (spouse/carer)", ConsentDate = today.AddMonths(-9),
                StorageRequirements = "Store below 25°C, away from light. Bleeding risk — report any unusual bruising immediately.",
                Status = MedicationStatus.Active,
            });

            medications.Add(new ParticipantMedication
            {
                Id = omeprazoleId, TenantId = demoTenantId, ParticipantId = ryanId,
                Name = "Omeprazole", Strength = "20mg", Form = MedicationForm.Capsule, Route = MedicationRoute.Oral,
                DoseDescription = "1 capsule (20mg)", Directions = "Take before breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Gastroprotection alongside anticoagulant therapy.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr. Farid Haidari", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-9), NextReviewDue = today.AddMonths(3),
                ConsentObtained = true, ConsentGivenBy = "Sandra Lee (spouse/carer)", ConsentDate = today.AddMonths(-9),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            // Enteral route/Powder form — matches Olivia's existing "PEG feeding schedule" support-profile note.
            medications.Add(new ParticipantMedication
            {
                Id = movicolId, TenantId = demoTenantId, ParticipantId = oliviaId,
                Name = "Movicol (Macrogol)", Strength = "13.7g/sachet", Form = MedicationForm.Powder, Route = MedicationRoute.Enteral,
                DoseDescription = "1 sachet dissolved in 125mL water, via PEG", Directions = "Flush PEG line before and after administration.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Bowel management — chronic constipation prophylaxis.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr. Amina Yusuf", PharmacyName = "Box Hill Amcal Pharmacy", Packaging = PackagingType.Sachet,
                StartDate = today.AddMonths(-11), NextReviewDue = today.AddMonths(2),
                ConsentObtained = true, ConsentGivenBy = "Robert White (father)", ConsentDate = today.AddMonths(-11),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(chloeId))
        {
            medications.Add(new ParticipantMedication
            {
                Id = digoxinId, TenantId = demoTenantId, ParticipantId = chloeId,
                Name = "Digoxin", Strength = "0.25mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (0.25mg)", Directions = "Take with breakfast. No missed doses — contact GP if a dose is missed.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Congenital heart condition — rate control.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Administer,
                PrescriberName = "Dr Jason Park", PharmacyName = "Bondi Junction Chemist", Packaging = PackagingType.Other,
                StartDate = today.AddYears(-3), NextReviewDue = today.AddMonths(6),
                ConsentObtained = true, ConsentGivenBy = "Peter Robinson (father/guardian)", ConsentDate = today.AddYears(-3),
                StorageRequirements = "Narrow therapeutic index — double-check dose against the MAR before every administration.",
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            // PRN with max/24h + min-interval, Inhaler form.
            medications.Add(new ParticipantMedication
            {
                Id = salbutamolId, TenantId = demoTenantId, ParticipantId = zoeId,
                Name = "Salbutamol", Strength = "100mcg/actuation", Form = MedicationForm.Inhaler, Route = MedicationRoute.Inhaled,
                DoseDescription = "2 puffs via spacer", Directions = "Use spacer device. Rinse mouth after use if more than occasional.",
                Type = MedicationType.Prn, PrnIndication = "Wheeze or shortness of breath (asthma)",
                PrnMaxDosesPer24h = 8, PrnMinIntervalMinutes = 240,
                Purpose = "Reliever for mild intermittent asthma.",
                DrugSchedule = DrugSchedule.Unscheduled, SupportLevel = MedicationSupportLevel.SelfAdministered,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Newtown Community Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddYears(-1), NextReviewDue = today.AddMonths(6),
                ConsentObtained = true, ConsentGivenBy = "Zoe Campbell (self)", ConsentDate = today.AddYears(-1),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            // Daily multi-time, Cream/Topical form.
            medications.Add(new ParticipantMedication
            {
                Id = betamethasoneId, TenantId = demoTenantId, ParticipantId = natalieId,
                Name = "Betamethasone", Strength = "0.05%", Form = MedicationForm.Cream, Route = MedicationRoute.Topical,
                DoseDescription = "Thin layer to affected areas", Directions = "Apply sparingly, avoid face and skin folds.",
                Type = MedicationType.Regular, TimesOfDay = "08:00,20:00",
                Purpose = "Eczema flare management.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.Assist,
                PrescriberName = "Dr. Wendy Cho", PharmacyName = "Underwood Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-1), NextReviewDue = today.AddMonths(2),
                ConsentObtained = true, ConsentGivenBy = "Natalie Walsh (self)", ConsentDate = today.AddMonths(-1),
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            // Drops/Ocular form.
            medications.Add(new ParticipantMedication
            {
                Id = latanoprostId, TenantId = demoTenantId, ParticipantId = isabellaId,
                Name = "Latanoprost", Strength = "0.005%", Form = MedicationForm.Drops, Route = MedicationRoute.Ocular,
                DoseDescription = "1 drop each eye", Directions = "Instil at night. Wait 5 minutes if using other eye drops.",
                Type = MedicationType.Regular, TimesOfDay = "21:00",
                Purpose = "Open-angle glaucoma — intraocular pressure control.",
                DrugSchedule = DrugSchedule.Schedule4, SupportLevel = MedicationSupportLevel.PromptOnly,
                PrescriberName = "Dr Jason Park", PharmacyName = "Kangaroo Point Pharmacy", Packaging = PackagingType.OriginalPackaging,
                StartDate = today.AddMonths(-4), NextReviewDue = today.AddMonths(5),
                ConsentObtained = true, ConsentGivenBy = "Isabella Clarke (self)", ConsentDate = today.AddMonths(-4),
                StorageRequirements = "Refrigerate unopened bottle; discard 4 weeks after opening.",
                Status = MedicationStatus.Active,
            });
        }

        if (existingParticipants.Contains(miaId))
        {
            // Structured record backing Mia's existing SupportProfile free text ("Sertraline 50mg morning").
            medications.Add(new ParticipantMedication
            {
                Id = miaSertralineId, TenantId = demoTenantId, ParticipantId = miaId,
                Name = "Sertraline", Strength = "50mg", Form = MedicationForm.Tablet, Route = MedicationRoute.Oral,
                DoseDescription = "1 tablet (50mg)", Directions = "Take each morning with breakfast.",
                Type = MedicationType.Regular, TimesOfDay = "08:00",
                Purpose = "Ongoing management of mild anxiety.",
                IsPsychotropic = true, DrugSchedule = DrugSchedule.Schedule4,
                SupportLevel = MedicationSupportLevel.PromptOnly, PrescriberName = "Dr. Wendy Cho",
                PharmacyName = "Sunnybank Community Pharmacy", Packaging = PackagingType.WebsterPack,
                StartDate = today.AddMonths(-7), NextReviewDue = today.AddMonths(5),
                ConsentObtained = true, ConsentGivenBy = "Mia Anderson (self)", ConsentDate = today.AddMonths(-7),
                Status = MedicationStatus.Active,
            });
        }

        if (medications.Count == 0)
            return;

        context.ParticipantMedications.AddRange(medications);
        await context.SaveChangesAsync(ct);

        // ── Sample administration history — a two-week scatter across Administered/Refused/
        // Withheld/Missed/WrongMedication, witness states across NotRequired/Pending/Approved/
        // Declined, RecordedByUserId set from the seeded demo users, and a couple of records with
        // AdministeredAtTimeZone set (seed-expansion task). The original "yesterday" records above
        // this comment (IDs ...0001-...0004) are left exactly as they were.
        var yesterday = today.AddDays(-1);
        var administrations = new List<MedicationAdministration>();

        // Fixed demo-user ids (see SeedAsync) — used directly rather than re-querying, since this
        // method only runs after SeedAsync has already created them.
        var jamesUserId = Guid.Parse("b1000000-0000-0000-0000-000000000003");
        var emilyUserId = Guid.Parse("b2000000-0000-0000-0000-000000000002");
        var danielUserId = Guid.Parse("b2000000-0000-0000-0000-000000000003");
        var rachelUserId = Guid.Parse("b2000000-0000-0000-0000-000000000001");
        var sarahUserId = Guid.Parse("b1000000-0000-0000-0000-000000000002");
        var marcusUserId = Guid.Parse("a2000000-0000-0000-0000-000000000001");
        var priyaUserId = Guid.Parse("a2000000-0000-0000-0000-000000000002");
        var lachlanUserId = Guid.Parse("a2000000-0000-0000-0000-000000000003");
        var jadeUserId = Guid.Parse("a2000000-0000-0000-0000-000000000004");
        var brendanUserId = Guid.Parse("a2000000-0000-0000-0000-000000000005");

        // Most recent Monday/Wednesday/Friday on or before today — used for Grace's SpecificDays
        // (Mon/Wed/Fri) Ferrous Sulfate history so the dates line up with her actual schedule
        // regardless of what day the seeder happens to run on.
        DateTime MostRecentWeekday(DateTime from, DayOfWeek day)
        {
            var diff = ((int)from.DayOfWeek - (int)day + 7) % 7;
            return from.AddDays(-diff);
        }
        var recentMonday = MostRecentWeekday(today, DayOfWeek.Monday);
        var recentWednesday = MostRecentWeekday(today, DayOfWeek.Wednesday);
        var recentFriday = MostRecentWeekday(today, DayOfWeek.Friday);

        if (existingParticipants.Contains(sophieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien",
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = yesterday.AddHours(20), Status = MedicationAdministrationStatus.Refused,
                RecordedByName = "James O'Brien",
                Reason = "Participant declined the evening dose; settled after 20 minutes. GP notified next business day.",
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000003"), TenantId = demoTenantId,
                ParticipantMedicationId = sertralineId, ParticipantId = charlotteId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(10),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (50mg)",
                RecordedByName = "Emily Nguyen",
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000004"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = yesterday.AddHours(8), AdministeredAt = yesterday.AddHours(8).AddMinutes(2),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Daniel Williams", WitnessName = "Rachel Thompson",
            });

            // Two more, further back — one Approved witness, one Declined (the compliance queue
            // demo: a witness that raised a discrepancy rather than rubber-stamping it).
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000d"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = today.AddDays(-6).AddHours(8), AdministeredAt = today.AddDays(-6).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
                WitnessName = "Rachel Thompson", WitnessUserId = rachelUserId,
                WitnessStatus = WitnessStatus.Approved,
                WitnessRequestedAt = today.AddDays(-6).AddHours(8).AddMinutes(3), WitnessRespondedAt = today.AddDays(-6).AddHours(8).AddMinutes(6),
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000e"), TenantId = demoTenantId,
                ParticipantMedicationId = insulinId, ParticipantId = harrisonId,
                ScheduledAt = today.AddDays(-13).AddHours(8), AdministeredAt = today.AddDays(-13).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
                RecordedByName = "Marcus Papadopoulos", RecordedByUserId = marcusUserId,
                WitnessName = "Priya Sharma", WitnessUserId = priyaUserId,
                WitnessStatus = WitnessStatus.Declined,
                WitnessRequestedAt = today.AddDays(-13).AddHours(8).AddMinutes(4), WitnessRespondedAt = today.AddDays(-13).AddHours(8).AddMinutes(11),
                Notes = "Witness queried the pen dial reading against the MAR before declining to confirm; recount matched the prescribed dose and was resolved with the coordinator same day.",
            });
        }

        if (existingParticipants.Contains(sophieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000000f"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000010"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-3).AddHours(20), AdministeredAt = today.AddDays(-3).AddHours(20).AddMinutes(6),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (500mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000011"), TenantId = demoTenantId,
                ParticipantMedicationId = levetiracetamId, ParticipantId = sophieId,
                ScheduledAt = today.AddDays(-7).AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
                Reason = "Staff shift changeover — dose not given within the window; escalated to the on-call coordinator and given late once identified.",
            });

            // PRN Paracetamol — no fixed schedule, so ScheduledAt is null.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000012"), TenantId = demoTenantId,
                ParticipantMedicationId = paracetamolId, ParticipantId = sophieId,
                AdministeredAt = today.AddDays(-2).AddHours(11), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 tablets (1000mg)", PrnReason = "Mild headache reported after a busy morning.", PrnOutcome = "Resolved within an hour.",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000013"), TenantId = demoTenantId,
                ParticipantMedicationId = paracetamolId, ParticipantId = sophieId,
                AdministeredAt = today.AddDays(-9).AddHours(15), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 tablets (1000mg)", PrnReason = "Reported mild fever.", PrnOutcome = "Settled by evening; no further doses needed that day.",
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000014"), TenantId = demoTenantId,
                ParticipantMedicationId = sertralineId, ParticipantId = charlotteId,
                ScheduledAt = today.AddDays(-8).AddHours(8), AdministeredAt = today.AddDays(-8).AddHours(8).AddMinutes(8),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (50mg)",
                RecordedByName = "Emily Nguyen", RecordedByUserId = emilyUserId,
                AdministeredAtTimeZone = "Australia/Melbourne",
            });

            // PRN Risperidone (chemical restraint) — one Administered, one Withheld.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000015"), TenantId = demoTenantId,
                ParticipantMedicationId = risperidoneId, ParticipantId = charlotteId,
                AdministeredAt = today.AddDays(-4).AddHours(16), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "1 tablet (0.5mg)",
                PrnReason = "Became distressed and attempted to leave the property unsupervised.",
                PrnOutcome = "Settled within 20 minutes with quiet space and noise-cancelling headphones.",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000016"), TenantId = demoTenantId,
                ParticipantMedicationId = risperidoneId, ParticipantId = charlotteId,
                Status = MedicationAdministrationStatus.Withheld,
                Reason = "Participant was asleep when the escalation resolved on its own before symptoms met the PRN threshold — dose withheld on RN phone advice.",
                RecordedByName = "Daniel Williams", RecordedByUserId = danielUserId,
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            // High-risk med, recent Administered dose with an outstanding (Pending) witness —
            // deliberately triggers ParticipantAlertsService's high-risk-medication-witness-gap
            // Critical alert for Ryan.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000017"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-2).AddHours(18), AdministeredAt = today.AddDays(-2).AddHours(18).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (3mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                WitnessName = "Sarah Mitchell", WitnessUserId = sarahUserId, WitnessStatus = WitnessStatus.Pending,
                WitnessRequestedAt = today.AddDays(-2).AddHours(18).AddMinutes(5),
                AdministeredAtTimeZone = "Australia/Melbourne",
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000018"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-9).AddHours(18), AdministeredAt = today.AddDays(-9).AddHours(18).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (3mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                WitnessName = "Sarah Mitchell", WitnessUserId = sarahUserId, WitnessStatus = WitnessStatus.Approved,
                WitnessRequestedAt = today.AddDays(-9).AddHours(18).AddMinutes(4), WitnessRespondedAt = today.AddDays(-9).AddHours(18).AddMinutes(9),
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000019"), TenantId = demoTenantId,
                ParticipantMedicationId = warfarinId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-14).AddHours(18), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
                Reason = "Participant unwell overnight — GP consulted next morning, dose resumed as normal from the following day.",
            });

            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001a"), TenantId = demoTenantId,
                ParticipantMedicationId = omeprazoleId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-2).AddHours(8), AdministeredAt = today.AddDays(-2).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 capsule (20mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001b"), TenantId = demoTenantId,
                ParticipantMedicationId = omeprazoleId, ParticipantId = ryanId,
                ScheduledAt = today.AddDays(-9).AddHours(8), AdministeredAt = today.AddDays(-9).AddHours(8).AddMinutes(2),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 capsule (20mg)",
                RecordedByName = "James O'Brien", RecordedByUserId = jamesUserId,
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001c"), TenantId = demoTenantId,
                ParticipantMedicationId = movicolId, ParticipantId = oliviaId,
                ScheduledAt = today.AddDays(-4).AddHours(8), AdministeredAt = today.AddDays(-4).AddHours(8).AddMinutes(12),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 sachet via PEG",
                RecordedByName = "Lachlan Robertson", RecordedByUserId = lachlanUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001d"), TenantId = demoTenantId,
                ParticipantMedicationId = movicolId, ParticipantId = oliviaId,
                ScheduledAt = today.AddDays(-11).AddHours(8), Status = MedicationAdministrationStatus.Withheld,
                RecordedByName = "Lachlan Robertson", RecordedByUserId = lachlanUserId,
                Reason = "Participant reported nausea overnight; RN phone advice was to withhold and reassess before the next dose. GP updated same day.",
            });
        }

        if (existingParticipants.Contains(chloeId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001e"), TenantId = demoTenantId,
                ParticipantMedicationId = digoxinId, ParticipantId = chloeId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (0.25mg)",
                RecordedByName = "Priya Sharma", RecordedByUserId = priyaUserId,
            });

            // MED-03 wrong-medication demo — Reason (required for non-Administered) and Notes
            // (required for WrongMedication) both populated.
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-00000000001f"), TenantId = demoTenantId,
                ParticipantMedicationId = digoxinId, ParticipantId = chloeId,
                ScheduledAt = today.AddDays(-10).AddHours(8), AdministeredAt = today.AddDays(-10).AddHours(8).AddMinutes(6),
                Status = MedicationAdministrationStatus.WrongMedication,
                DoseGiven = "1 Paracetamol tablet (500mg) — given in error",
                Reason = "Incorrect blister-pack row administered — participant received a Paracetamol tablet instead of the scheduled Digoxin dose.",
                Notes = "Error identified within 10 minutes when checking the MAR against the blister pack. GP phoned for advice — monitor only, no intervention required. Digoxin given once confirmed safe, 45 minutes later. Incident report completed.",
                RecordedByName = "Priya Sharma", RecordedByUserId = priyaUserId,
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000020"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentMonday.AddHours(8), AdministeredAt = recentMonday.AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (325mg)",
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000021"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentWednesday.AddHours(8), AdministeredAt = recentWednesday.AddHours(8).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (325mg)",
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000022"), TenantId = demoTenantId,
                ParticipantMedicationId = ferrousSulfateId, ParticipantId = graceId,
                ScheduledAt = recentFriday.AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Sarah Mitchell", RecordedByUserId = sarahUserId,
                Reason = "Missed during a full-day community outing — dose box wasn't packed; resumed on the next scheduled day.",
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000023"), TenantId = demoTenantId,
                ParticipantMedicationId = prednisoloneId, ParticipantId = williamId,
                ScheduledAt = today.AddDays(-2).AddHours(8), AdministeredAt = today.AddDays(-2).AddHours(8).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 tablet (5mg)",
                RecordedByName = "Brendan Nguyen", RecordedByUserId = brendanUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000024"), TenantId = demoTenantId,
                ParticipantMedicationId = prednisoloneId, ParticipantId = williamId,
                ScheduledAt = today.AddDays(-12).AddHours(8), Status = MedicationAdministrationStatus.Missed,
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
                Reason = "Dosing day missed while William was away with family — resumed on schedule from the next dosing day.",
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000025"), TenantId = demoTenantId,
                ParticipantMedicationId = betamethasoneId, ParticipantId = natalieId,
                ScheduledAt = today.AddDays(-3).AddHours(8), AdministeredAt = today.AddDays(-3).AddHours(8).AddMinutes(5),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "Thin layer to affected areas",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000026"), TenantId = demoTenantId,
                ParticipantMedicationId = betamethasoneId, ParticipantId = natalieId,
                ScheduledAt = today.AddDays(-3).AddHours(20), AdministeredAt = today.AddDays(-3).AddHours(20).AddMinutes(4),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "Thin layer to affected areas",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000027"), TenantId = demoTenantId,
                ParticipantMedicationId = latanoprostId, ParticipantId = isabellaId,
                ScheduledAt = today.AddDays(-5).AddHours(21), AdministeredAt = today.AddDays(-5).AddHours(21).AddMinutes(3),
                Status = MedicationAdministrationStatus.Administered, DoseGiven = "1 drop each eye",
                RecordedByName = "Marcus Papadopoulos", RecordedByUserId = marcusUserId,
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            administrations.Add(new MedicationAdministration
            {
                Id = Guid.Parse("71000000-0000-0000-0000-000000000028"), TenantId = demoTenantId,
                ParticipantMedicationId = salbutamolId, ParticipantId = zoeId,
                AdministeredAt = today.AddDays(-6).AddHours(10), Status = MedicationAdministrationStatus.Administered,
                DoseGiven = "2 puffs via spacer", PrnReason = "Wheeze noted after morning walk.", PrnOutcome = "Resolved within 5 minutes.",
                RecordedByName = "Jade Watkins", RecordedByUserId = jadeUserId,
            });
        }

        if (administrations.Count > 0)
        {
            context.MedicationAdministrations.AddRange(administrations);
            await context.SaveChangesAsync(ct);
        }
    }

    /// <summary>
    /// Seeds a handful of sample participant notes — a mix of pinned, plain, and archived —
    /// for the same demo participants <see cref="SeedMedicationsAsync"/> targets. Idempotent:
    /// bails out if any ParticipantNote already exists, and again per-participant if the demo
    /// participants haven't been created yet.
    /// </summary>
    public static async Task SeedParticipantNotesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantNotes.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task — additional demo participants that now carry their own notes.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var jackId = Guid.Parse("d1000000-0000-0000-0000-000000000007");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");

        var targetIds = new[] { sophieId, charlotteId, harrisonId, liamId, oliviaId, jackId, williamId, graceId, ryanId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var notes = new List<ParticipantNote>();

        if (existingParticipants.Contains(sophieId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Haircut preference", Description = "Sophie prefers a short bob, above the shoulders, cut by Marie at Coorparoo Hair Studio — she becomes distressed with unfamiliar hairdressers. Book a quiet mid-morning slot where possible.",
                IsPinned = true, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });

            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Old transport note — superseded", Description = "Previously required the accessible van for all outings; this has since been reassessed and no longer applies. Kept for historical reference only.",
                IsPinned = false, IsArchived = true, CreatedByName = "Emily Nguyen",
                CreatedAt = now.AddMonths(-9), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Preferred de-escalation approach", Description = "When Charlotte becomes agitated, offer a quiet space and her noise-cancelling headphones before any verbal redirection — verbal prompts too early tend to escalate rather than help.",
                IsPinned = false, IsArchived = false, CreatedByName = "Daniel Williams",
                CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Dietary note", Description = "Harrison manages his own insulin dosing around meals — support staff should confirm carb counts with him before he eats but not dose on his behalf unless asked.",
                IsPinned = false, IsArchived = false, CreatedByName = "Rachel Thompson",
                CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        // ── Seed-expansion task: additional notes ──
        if (existingParticipants.Contains(liamId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = liamId,
                Title = "Beach access preference", Description = "Liam prefers the beach wheelchair kept at Surfers Paradise SLSC over the Broadwater Parklands one — the tyres are better maintained. Ring ahead to reserve it on busy weekends.",
                IsPinned = false, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = oliviaId,
                Title = "Gallery visit preparation", Description = "Confirm venue accessibility (hoist/accessible bathroom) at least a week ahead for any gallery or live-music outing, and build in extra time either side for her PEG feeding schedule.",
                IsPinned = true, IsArchived = false, CreatedByName = "Rachel Thompson",
                CreatedAt = now.AddMonths(-5), UpdatedAt = now.AddMonths(-5),
            });
        }

        if (existingParticipants.Contains(jackId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = jackId,
                Title = "Photography equipment", Description = "Jack carries his own camera bag on the back of his wheelchair — no need to offer to carry it for him. He's fully independent with his wheelchair; let him lead rather than push.",
                IsPinned = false, IsArchived = false, CreatedByName = "Sarah Mitchell",
                CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, ParticipantId = williamId,
                Title = "Sports viewing preference", Description = "William follows the NRL closely — where the trip schedule allows, try to keep weekend afternoons free for him to catch live games on TV or at a local pub screening.",
                IsPinned = false, IsArchived = false, CreatedByName = "Marcus Papadopoulos",
                CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, ParticipantId = graceId,
                Title = "Cooking involvement", Description = "Grace loves being included in group meal prep — give her a real task (chopping, stirring, plating) rather than having meals done for her. She's proud of her cooking and likes to be asked for tips.",
                IsPinned = false, IsArchived = false, CreatedByName = "Sarah Mitchell",
                CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            notes.Add(new ParticipantNote
            {
                Id = Guid.Parse("73000000-0000-0000-0000-00000000000a"), TenantId = demoTenantId, ParticipantId = ryanId,
                Title = "Communication support — allow response time", Description = "Ryan has expressive aphasia and uses a word board alongside speech. Allow at least 20 seconds for him to respond before repeating or rephrasing a question, and never finish his sentences for him.",
                IsPinned = true, IsArchived = false, CreatedByName = "James O'Brien",
                CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (notes.Count == 0)
            return;

        context.ParticipantNotes.AddRange(notes);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Seeds a few demo <see cref="ParticipantRoutine"/> rows — per-day routines and
    /// shift-critical specifics support workers must know — for the same demo participants
    /// as <see cref="SeedParticipantNotesAsync"/>. Idempotent via fixed GUIDs + an existence
    /// check, same pattern as that method.
    /// </summary>
    public static async Task SeedParticipantRoutinesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantRoutines.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");
        // Seed-expansion task — additional demo participants that now carry their own routines.
        // Chloe Robinson (d2-3) is deliberately NOT given a routine here despite being
        // high-support/overnight — see SeedRestrictivePracticesAsync's note on her flag — so
        // ParticipantAlertsService's routine-coverage-gap rule has one real instance to surface
        // rather than the register being suspiciously complete everywhere.
        var liamId = Guid.Parse("d1000000-0000-0000-0000-000000000001");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var jackId = Guid.Parse("d1000000-0000-0000-0000-000000000007");
        var williamId = Guid.Parse("d1000000-0000-0000-0000-000000000009");
        var graceId = Guid.Parse("d2000000-0000-0000-0000-000000000005");
        var natalieId = Guid.Parse("d2000000-0000-0000-0000-000000000009");
        var isabellaId = Guid.Parse("d2000000-0000-0000-0000-000000000001");
        var zoeId = Guid.Parse("d2000000-0000-0000-0000-000000000007");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");

        var targetIds = new[]
        {
            sophieId, charlotteId, harrisonId,
            liamId, oliviaId, jackId, williamId, graceId, natalieId, isabellaId, zoeId, ryanId,
        };
        var existingParticipants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var routines = new List<ParticipantRoutine>();

        if (existingParticipants.Contains(sophieId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Epilepsy medication window", Description = "Keppra 500mg BD — must be given within 30 minutes of the scheduled time. If a dose is missed, follow the seizure medication protocol in her file, not the standard PRN process.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = sophieId,
                Title = "Morning routine", Description = "Wake gently — avoid sudden noise or lights. Offer a warm drink before getting up. Takes about 45 minutes; do not rush transitions.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(8, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Line-of-sight supervision", Description = "Flight risk in unfamiliar environments — maintain continuous line-of-sight supervision whenever off the property. Do not rely on verbal check-ins alone.",
                Category = RoutineCategory.Behaviour, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Title = "Saturday swimming session", Description = "Local pool 10am — bring noise-cancelling headphones for the change rooms, which can get loud and crowded.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Saturday, StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(11, 30),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Insulin — confirm, don't dose", Description = "Harrison manages his own insulin dosing around meals. Confirm carb counts with him before he eats, but do not administer on his behalf unless he asks.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });

            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Title = "Evening meal prep", Description = "Prefers to help prep dinner rather than have it made for him — offer him a task (chopping, stirring) rather than taking over.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(17, 30), EndTime = new TimeOnly(18, 30),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        // ── Seed-expansion task: additional routines ──
        if (existingParticipants.Contains(liamId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = liamId,
                Title = "Bedtime wind-down", Description = "Prefers a quiet 30 minutes before lights-out — no screens, TV off. A short chat about the day's activities helps him settle.",
                Category = RoutineCategory.Sleep, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(21, 0), EndTime = new TimeOnly(22, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(oliviaId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000008"), TenantId = demoTenantId, ParticipantId = oliviaId,
                Title = "Hoist transfer routine", Description = "Requires a ceiling hoist or mobile hoist for every transfer — never attempt a manual transfer. Two staff must be present. Check sling fit before each use.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-5), UpdatedAt = now.AddMonths(-5),
            });
        }

        if (existingParticipants.Contains(jackId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-000000000009"), TenantId = demoTenantId, ParticipantId = jackId,
                Title = "Weekly photography outing", Description = "Sunday morning outing to a local spot of Jack's choosing to take photos — he plans the location himself; staff just provide transport and are on hand if needed.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Sunday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (existingParticipants.Contains(williamId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000a"), TenantId = demoTenantId, ParticipantId = williamId,
                Title = "Breakfast preference", Description = "Prefers a cooked breakfast (eggs on toast) over cereal where the venue allows it — happy with cereal on travel days, just checks first.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(8, 0),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(graceId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000b"), TenantId = demoTenantId, ParticipantId = graceId,
                Title = "Meal prep involvement", Description = "Always offer Grace a role in group meal prep — she especially enjoys planning the menu the day before.",
                Category = RoutineCategory.Meals, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(natalieId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000c"), TenantId = demoTenantId, ParticipantId = natalieId,
                Title = "Skin cream application", Description = "Betamethasone cream applied morning and evening for eczema — apply sparingly to affected areas only, avoiding the face.",
                Category = RoutineCategory.PersonalCare, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(8, 15),
                IsCritical = false, IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (existingParticipants.Contains(isabellaId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000d"), TenantId = demoTenantId, ParticipantId = isabellaId,
                Title = "Evening eye drops", Description = "Latanoprost eye drops each night for glaucoma — must not be skipped. If a dose is missed, do not double up the next night; note it in the medication chart instead.",
                Category = RoutineCategory.Medication, Days = ParticipantRoutineDays.All, StartTime = new TimeOnly(21, 0), EndTime = new TimeOnly(21, 15),
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
        }

        if (existingParticipants.Contains(zoeId))
        {
            // Deliberately inactive — demonstrates a retired routine (the register keeps history
            // via IsActive rather than deleting it).
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000e"), TenantId = demoTenantId, ParticipantId = zoeId,
                Title = "Weekly photography walk — discontinued", Description = "Previously a standing Thursday photography walk; discontinued when Zoe's engagement with the service changed. Kept for history only.",
                Category = RoutineCategory.Activity, Days = ParticipantRoutineDays.Thursday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(11, 30),
                IsCritical = false, IsActive = false, CreatedAt = now.AddMonths(-10), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(ryanId))
        {
            routines.Add(new ParticipantRoutine
            {
                Id = Guid.Parse("74000000-0000-0000-0000-00000000000f"), TenantId = demoTenantId, ParticipantId = ryanId,
                Title = "Allow processing/response time", Description = "Ryan has expressive aphasia — allow at least 20 seconds for him to respond before repeating or rephrasing. Frustration is more likely when staff finish sentences for him or rush the conversation.",
                Category = RoutineCategory.Behaviour, Days = ParticipantRoutineDays.All, StartTime = null, EndTime = null,
                IsCritical = true, IsActive = true, CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
            });
        }

        if (routines.Count == 0)
            return;

        context.ParticipantRoutines.AddRange(routines);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Seeds a few demo <see cref="RestrictivePractice"/> register rows for the demo participants
    /// whose OTHER seed data already implies a restrictive practice, mirroring exactly what the
    /// AddRestrictivePractices migration's SQL backfill would produce for this data if it were
    /// pre-existing production rows: an Unclassified entry from Sophie Brown's and Charlotte
    /// White's <see cref="SupportProfile.RestrictivePracticeDetails"/> free text, plus a
    /// ChemicalRestraint entry linked to Charlotte's Risperidone PRN (seeded with
    /// <see cref="ParticipantMedication.IsChemicalRestraint"/> = true in
    /// <see cref="SeedMedicationsAsync"/>). Deliberately does NOT invoke the migration's backfill
    /// service — this covers the fact that migrations run against an empty database before this
    /// seeder populates the legacy fields, so the real backfill never sees this seed data. Also
    /// sets each participant's derived <see cref="Participant.HasRestrictivePracticeFlag"/> to
    /// match, the same sync-write <see cref="Api.Controllers.RestrictivePracticesController"/>
    /// performs on every register mutation. Idempotent via fixed GUIDs + an existence check, same
    /// pattern as <see cref="SeedParticipantRoutinesAsync"/>.
    /// </summary>
    public static async Task SeedRestrictivePracticesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.RestrictivePractices.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        // Fixed ID from SeedMedicationsAsync — Charlotte's Risperidone PRN (IsChemicalRestraint = true).
        var risperidoneId = Guid.Parse("70000000-0000-0000-0000-000000000003");
        // Seed-expansion task — Chloe Robinson and Ryan Murphy's Participant rows already carry
        // HasRestrictivePracticeFlag = true from SeedAsync (their behaviour-risk narrative implies
        // an in-place restrictive practice) but had no backing register row until now — this
        // method is what makes that flag consistent (see the entity's remarks on the flag being
        // derived, never independently writable, going forward). Harrison Lee gets a new
        // MechanicalRestraint row and is newly flagged here for the same reason.
        var chloeId = Guid.Parse("d2000000-0000-0000-0000-000000000003");
        var ryanId = Guid.Parse("d2000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");

        var targetIds = new[] { sophieId, charlotteId, chloeId, ryanId, harrisonId };
        var participants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        if (participants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var practices = new List<RestrictivePractice>();

        if (participants.TryGetValue(sophieId, out var sophie))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                Type = RestrictivePracticeType.Unclassified,
                Description = "Environmental restriction — locked doors during sleep. Authorised by NDIS Commission.",
                IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
            sophie.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(charlotteId, out var charlotte))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Type = RestrictivePracticeType.Unclassified,
                Description = "Continuous supervision in community settings. GPS tracker watch. Authorised.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            // Only add the ChemicalRestraint link if the medication was actually seeded (guards
            // against SeedMedicationsAsync having been skipped for any reason).
            if (await context.ParticipantMedications.IgnoreQueryFilters().AnyAsync(m => m.Id == risperidoneId, ct))
            {
                practices.Add(new RestrictivePractice
                {
                    Id = Guid.Parse("75000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                    Type = RestrictivePracticeType.ChemicalRestraint, RelatedMedicationId = risperidoneId,
                    Description = "Risperidone",
                    IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
            }

            // Seed-expansion task — Seclusion, and the "recently reviewed" demo: freshly
            // authorised/reviewed rather than overdue, so the register shows a healthy example
            // alongside the two deliberately-overdue ones below.
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = charlotteId,
                Type = RestrictivePracticeType.Seclusion,
                Description = "Brief supervised time in a low-stimulus room (door unlocked, staff immediately outside) used only when Charlotte is at risk of harm to self during acute sensory overload. Least-restrictive option confirmed with BSP.",
                AuthorisedBy = "Dr. Farid Haidari (Behaviour Support Practitioner)", AuthorisationDate = today.AddDays(-10), ReviewDate = today.AddMonths(6),
                IsActive = true, CreatedAt = now.AddDays(-10), UpdatedAt = now.AddDays(-10),
            });

            charlotte.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(chloeId, out var chloe))
        {
            // Overdue review (#1 of 2) — exercises ParticipantAlertsService's
            // restrictive-practice-review-overdue rule.
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000005"), TenantId = demoTenantId, ParticipantId = chloeId,
                Type = RestrictivePracticeType.EnvironmentalRestraint,
                Description = "Bedroom door alarm fitted — alerts staff if Chloe leaves her room overnight, due to elopement risk when her routine is disrupted.",
                AuthorisedBy = "NDIS Quality and Safeguards Commission", AuthorisationDate = today.AddMonths(-8), ReviewDate = today.AddDays(-10),
                IsActive = true, CreatedAt = now.AddMonths(-8), UpdatedAt = now.AddMonths(-8),
            });
            chloe.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(ryanId, out var ryan))
        {
            // Overdue review (#2 of 2).
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000006"), TenantId = demoTenantId, ParticipantId = ryanId,
                Type = RestrictivePracticeType.PhysicalRestraint,
                Description = "Two-person supported physical guiding technique, used only during acute frustration episodes affecting safety when communication support alone hasn't de-escalated. Authorised per BSP.",
                AuthorisedBy = "Dr. Farid Haidari (Behaviour Support Practitioner)", AuthorisationDate = today.AddMonths(-9), ReviewDate = today.AddDays(-25),
                IsActive = true, CreatedAt = now.AddMonths(-9), UpdatedAt = now.AddMonths(-9),
            });
            ryan.HasRestrictivePracticeFlag = true;
        }

        if (participants.TryGetValue(harrisonId, out var harrison))
        {
            practices.Add(new RestrictivePractice
            {
                Id = Guid.Parse("75000000-0000-0000-0000-000000000007"), TenantId = demoTenantId, ParticipantId = harrisonId,
                Type = RestrictivePracticeType.MechanicalRestraint,
                Description = "Postural support harness used during vehicle transport due to risk of releasing the seatbelt when fatigued/unwell. Reviewed with OT — least restrictive option identified for transport safety.",
                AuthorisedBy = "Dr. Priya Chandran", AuthorisationDate = today.AddMonths(-4), ReviewDate = today.AddMonths(4),
                IsActive = true, CreatedAt = now.AddMonths(-4), UpdatedAt = now.AddMonths(-4),
            });
            harrison.HasRestrictivePracticeFlag = true;
        }

        if (practices.Count == 0)
            return;

        context.RestrictivePractices.AddRange(practices);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE-09. Seeds a few demo <see cref="ParticipantRiskEntry"/> rows spanning all four
    /// <see cref="AtRiskParty"/> categories, for the same demo participants as
    /// <see cref="SeedParticipantRoutinesAsync"/>/<see cref="SeedRestrictivePracticesAsync"/>.
    /// Idempotent via fixed GUIDs + an existence check, same pattern as those two methods.
    /// </summary>
    public static async Task SeedParticipantRiskEntriesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantRiskEntries.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var harrisonId = Guid.Parse("d2000000-0000-0000-0000-000000000006");

        var targetIds = new[] { sophieId, charlotteId, harrisonId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var entries = new List<ParticipantRiskEntry>();

        if (existingParticipants.Contains(sophieId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000001"), TenantId = demoTenantId, ParticipantId = sophieId,
                AtRiskParty = AtRiskParty.Participant,
                Description = "Risk of seizure-related injury during a fall.",
                MitigationNotes = "Padded flooring in her room; staff trained in seizure first aid.",
                IsActive = true, CreatedAt = now.AddMonths(-6), UpdatedAt = now.AddMonths(-6),
            });
        }

        if (existingParticipants.Contains(charlotteId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000002"), TenantId = demoTenantId, ParticipantId = charlotteId,
                AtRiskParty = AtRiskParty.Public,
                Description = "Risk to public safety if she leaves the property unsupervised in an unfamiliar area.",
                MitigationNotes = "Continuous supervision protocol per her routine; GPS tracker watch.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });

            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000003"), TenantId = demoTenantId, ParticipantId = charlotteId,
                AtRiskParty = AtRiskParty.OtherParticipants,
                Description = "Risk of overstimulation triggering distress that could escalate around other participants during group activities.",
                MitigationNotes = "Schedule her activities separately from large groups where possible; use noise-cancelling headphones.",
                IsActive = true, CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
            });
        }

        if (existingParticipants.Contains(harrisonId))
        {
            entries.Add(new ParticipantRiskEntry
            {
                Id = Guid.Parse("76000000-0000-0000-0000-000000000004"), TenantId = demoTenantId, ParticipantId = harrisonId,
                AtRiskParty = AtRiskParty.Staff,
                Description = "Risk of a hypoglycaemic episode requiring staff intervention during outings.",
                MitigationNotes = "Staff carry glucose tablets and are trained to recognise early signs.",
                IsActive = true, CreatedAt = now.AddMonths(-1), UpdatedAt = now.AddMonths(-1),
            });
        }

        if (entries.Count == 0)
            return;

        context.ParticipantRiskEntries.AddRange(entries);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave B. Seeds realistic <see cref="ParticipantConsent"/> rows — a majority of
    /// the 20 demo participants, each getting all seven <see cref="ConsentType"/> rows with
    /// varied answers (some fully granted, some with one or two declines, some with an
    /// unanswered gap) so the detail page's "granted / declined / not recorded" three-way status
    /// list has real demo data for every state. Idempotent via fixed GUIDs + an existence check,
    /// same pattern as <see cref="SeedParticipantRiskEntriesAsync"/> — the "fixed" GUID here is
    /// generated deterministically from a running counter (rather than 91 individually
    /// hand-typed literals) since this seeder covers far more rows than that one; still stable
    /// and idempotent across runs, just built from a formula instead of copy-pasted values.
    /// </summary>
    public static async Task SeedParticipantConsentsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantConsents.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        // participantId -> answer per ConsentType. null = deliberately left unanswered (the
        // "not recorded" detail-page state), so at least one participant below has a gap.
        var plans = new (Guid ParticipantId, Dictionary<ConsentType, bool?> Answers)[]
        {
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000006"), new()
            {
                [ConsentType.PhotoVideo] = null, [ConsentType.Alcohol] = null, [ConsentType.OtcMedication] = null,
                [ConsentType.EmergencyMedical] = null, [ConsentType.Privacy] = null, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = null,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000007"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000001"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = null, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000004"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000005"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = false,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = null,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new()
            {
                [ConsentType.PhotoVideo] = false, [ConsentType.Alcohol] = false, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = false,
                [ConsentType.TermsAndConditions] = true,
            }),
            (Guid.Parse("d2000000-0000-0000-0000-000000000009"), new()
            {
                [ConsentType.PhotoVideo] = true, [ConsentType.Alcohol] = true, [ConsentType.OtcMedication] = true,
                [ConsentType.EmergencyMedical] = true, [ConsentType.Privacy] = true, [ConsentType.TravelInsurance] = true,
                [ConsentType.TermsAndConditions] = true,
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participants = await context.Participants.IgnoreQueryFilters()
            .Where(p => participantIds.Contains(p.Id))
            .Select(p => new { p.Id, p.FirstName, p.LastName })
            .ToDictionaryAsync(p => p.Id, ct);
        if (participants.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantConsent>();
        var counter = 1;
        foreach (var (participantId, answers) in plans)
        {
            if (!participants.TryGetValue(participantId, out var participant))
                continue;

            foreach (var (type, granted) in answers)
            {
                rows.Add(new ParticipantConsent
                {
                    // Deterministic across runs — same (counter) every time this method builds
                    // the same `plans` list — satisfying the idempotent-fixed-id pattern without
                    // 91 hand-typed literals.
                    Id = Guid.Parse($"79000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ConsentType = type,
                    Granted = granted,
                    RecordedAt = granted.HasValue ? now.AddMonths(-3) : null,
                    SignedByName = granted == true ? $"{participant.FirstName} {participant.LastName}" : null,
                    SignedDate = granted == true ? DateOnly.FromDateTime(now.AddMonths(-3)) : null,
                    CreatedAt = now.AddMonths(-3), UpdatedAt = now.AddMonths(-3),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantConsents.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C1. Seeds realistic <see cref="ParticipantHealthCondition"/> rows for a
    /// majority of the 20 demo participants — condition rows chosen to be coherent with each
    /// participant's existing <see cref="Participant.PrimaryDiagnosis"/>/<see cref="Participant.OtherDiagnoses"/>/
    /// <see cref="Participant.MedicalSummary"/> (e.g. Sophie Brown's Epilepsy row mirrors her
    /// existing OtherDiagnoses "Epilepsy" + HidpaSupportCategories.EpilepsyManagement — see this
    /// PR's report for the epilepsy grid/diagnosis reconciliation this demonstrates), with varied
    /// Has/PlanProvided/TrainingRequired combinations so the detail page's grid has real plan/
    /// training variety to show. Idempotent via fixed GUIDs (formulaic, same pattern as
    /// <see cref="SeedParticipantConsentsAsync"/>) + an existence check.
    /// </summary>
    public static async Task SeedParticipantHealthConditionsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantHealthConditions.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var plans = new (Guid ParticipantId, (HealthConditionType Type, bool? Has, string? Severity, bool? PlanProvided, bool? TrainingRequired, string? Notes)[] Rows)[]
        {
            // Liam Johnson — SCI, independent transfers, no other flagged conditions.
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Sophie Brown — ABI + Epilepsy (OtherDiagnoses already has "Epilepsy",
            // HidpaSupportCategories already has EpilepsyManagement) — the grid row mirrors both,
            // seeded coherently rather than derived server-side (see this PR's report).
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new[]
            {
                (HealthConditionType.Epilepsy, (bool?)true, (string?)"GrandMal, breakthrough seizures", (bool?)true, (bool?)true, "Seizure management plan on file; PRN midazolam per plan."),
                (HealthConditionType.MentalHealth, (bool?)true, "ABI-related mood changes", (bool?)true, (bool?)false, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, PEG feeding.
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new[]
            {
                (HealthConditionType.Dysphagia, (bool?)true, "Severe — PEG fed, no oral intake", (bool?)true, (bool?)true, "PEG site care per plan."),
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Charlotte White — Autism L3 + Psychosocial Disability, anxiety, restrictive practice flag.
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)true, "Anxiety disorder", (bool?)true, (bool?)true, "See BSP for de-escalation strategies."),
                (HealthConditionType.IntellectualDisability, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // William Martin — DSOA, no flagged conditions but answered.
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new[]
            {
                (HealthConditionType.HighBloodPressure, (bool?)true, (string?)"Controlled with medication", (bool?)false, (bool?)false, (string?)null),
            }),
            // Chloe Robinson — Down syndrome, congenital heart condition (cleared for travel).
            (Guid.Parse("d2000000-0000-0000-0000-000000000003"), new[]
            {
                (HealthConditionType.IntellectualDisability, (bool?)true, (string?)"Mild", (bool?)true, (bool?)false, (string?)null),
            }),
            // Harrison Lee — Multiple Sclerosis, fatigue management important.
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new[]
            {
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)"Monitored due to reduced mobility; no current wounds."),
            }),
            // Ryan Murphy — ABI (stroke), aphasia, right-side weakness, restrictive practice flag.
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new[]
            {
                (HealthConditionType.MentalHealth, (bool?)true, (string?)"Post-stroke frustration/low mood", (bool?)true, (bool?)true, (string?)null),
                (HealthConditionType.HighBloodPressure, (bool?)true, "Controlled", (bool?)false, (bool?)false, (string?)null),
            }),
            // Natalie Walsh — no medical flags recorded, one deliberately-unanswered row (the
            // "not recorded" grid state, same doctrine as SeedParticipantConsentsAsync's Mia gap).
            (Guid.Parse("d2000000-0000-0000-0000-000000000009"), new[]
            {
                (HealthConditionType.Asthma, (bool?)null, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
            // Dylan Foster — manual wheelchair, otherwise no flagged conditions.
            (Guid.Parse("d2000000-0000-0000-0000-000000000010"), new[]
            {
                (HealthConditionType.WoundCare, (bool?)false, (string?)null, (bool?)null, (bool?)null, (string?)null),
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participantExists = await context.Participants.IgnoreQueryFilters()
            .Where(p => participantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (participantExists.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantHealthCondition>();
        var counter = 1;
        foreach (var (participantId, conditionRows) in plans)
        {
            if (!participantExists.Contains(participantId))
                continue;

            foreach (var (type, has, severity, planProvided, trainingRequired, notes) in conditionRows)
            {
                rows.Add(new ParticipantHealthCondition
                {
                    // Deterministic across runs — same formula as SeedParticipantConsentsAsync's
                    // counter-derived ids.
                    Id = Guid.Parse($"7a000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ConditionType = type,
                    Has = has,
                    Severity = severity,
                    PlanProvided = planProvided,
                    TrainingRequired = trainingRequired,
                    Notes = notes,
                    CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantHealthConditions.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C1. Updates a majority of the 20 demo participants IN PLACE with the new
    /// flat Allergies/Mobility &amp; Functional/Behaviour &amp; Communication columns (Master Data
    /// Dictionary MED-012, MOB-002/003/005..010/012, COG-001..004/006/008/009/010/011,
    /// COM-001..004) — chosen to be coherent with each participant's existing diagnoses/mobility
    /// notes/behaviour-risk summary (e.g. Olivia Wilson's non-verbal/AAC-device note already on
    /// her record now also sets ExpressiveSkills/CommunicationAids consistently). Idempotent via an
    /// existence check on whether any of the target participants already has AmbulantStatus set
    /// (a column no earlier sub-wave could have populated) rather than fixed GUIDs, since this
    /// seeder UPDATES existing rows rather than inserting new ones.
    /// </summary>
    public static async Task SeedParticipantClinicalEnrichmentAsync(OdipDbContext context, CancellationToken ct = default)
    {
        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;

        var targetIds = new[]
        {
            Guid.Parse("d1000000-0000-0000-0000-000000000001"), // Liam — SCI, wheelchair
            Guid.Parse("d1000000-0000-0000-0000-000000000002"), // Sophie — ABI + Epilepsy
            Guid.Parse("d1000000-0000-0000-0000-000000000003"), // Noah — fully ambulant
            Guid.Parse("d1000000-0000-0000-0000-000000000004"), // Olivia — CP quadriplegia, AAC
            Guid.Parse("d1000000-0000-0000-0000-000000000005"), // Ethan — no mobility flags, allergy only
            Guid.Parse("d1000000-0000-0000-0000-000000000006"), // Mia — allergy only (anaphylaxis)
            Guid.Parse("d1000000-0000-0000-0000-000000000007"), // Jack — manual wheelchair, independent
            Guid.Parse("d1000000-0000-0000-0000-000000000008"), // Charlotte — autism, flight risk, BOC
            Guid.Parse("d2000000-0000-0000-0000-000000000001"), // Isabella — allergy only
            Guid.Parse("d2000000-0000-0000-0000-000000000002"), // Mason — power wheelchair
            Guid.Parse("d2000000-0000-0000-0000-000000000003"), // Chloe — Down syndrome, sudden-change distress
            Guid.Parse("d2000000-0000-0000-0000-000000000006"), // Harrison — MS, fatigue
            Guid.Parse("d2000000-0000-0000-0000-000000000008"), // Ryan — ABI stroke, aphasia
            Guid.Parse("d2000000-0000-0000-0000-000000000010"), // Dylan — manual wheelchair, flat terrain only
        };

        var participants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        // Idempotency guard: if any target participant already has AmbulantStatus populated, this
        // seeder has already run (no earlier sub-wave could have set that column).
        if (participants.Any(p => p.AmbulantStatus != null))
            return;

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(Guid.Parse("d1000000-0000-0000-0000-000000000001"), p => // Liam — SCI, wheelchair, independent transfers
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
            p.SkinIntegrity = "Pressure area checks twice daily per SCI care plan — no current areas of concern.";
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.BehavioursOfConcernCurrent = false;
            p.ExpressiveSkills = "High — fully verbal."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000002"), p => // Sophie — ABI + Epilepsy
        {
            p.AmbulantStatus = AmbulantStatus.Unsteady;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.UnevenGroundFlag = true;
            p.LevelOfPersonalCare = PersonalCareLevel.Supervision;
            p.Memory = MemoryLevel.Fair;
            p.MemoryAids = true;
            p.BehavioursOfConcernCurrent = true;
            p.BehavioursOfConcernFiveYearHistory = true;
            p.BehaviourRiskRating = RiskRatingLevel.Medium;
            p.RidsLogged = true; p.BspPlanProvided = true; p.BocChartProvided = true;
            p.ExpressiveSkills = "High — verbal."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000003"), p => // Noah — fully ambulant
        {
            p.AmbulantStatus = AmbulantStatus.NoAssist;
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
            p.Memory = MemoryLevel.Excellent;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000004"), p => // Olivia — CP quadriplegia, AAC device
        {
            p.FallsRiskRating = RiskRatingLevel.Critical;
            p.LevelOfPersonalCare = PersonalCareLevel.TwoPerson;
            p.ContinenceSupportDetail = "Full assistance required; pads, checked and changed on a schedule.";
            p.BowelCareDetail = "Bowel care per plan alongside PEG feeding regime — staff trained.";
            p.SkinIntegrity = "High risk — pressure mattress in use, repositioning schedule followed strictly.";
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.ExpressiveSkills = "Low verbal — communicates via AAC (eye-gaze) device, confirm before proceeding.";
            p.ReceptiveSkills = "High.";
            p.CommunicationAids = "AAC eye-gaze device.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000005"), p => // Ethan — allergy only
        {
            p.AllergiesDetail = "Bee stings — mild local reaction (swelling), not anaphylactic.";
            p.IsAnaphylaxisRisk = false;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000006"), p => // Mia — anaphylaxis
        {
            p.AllergiesDetail = "Peanuts and tree nuts.";
            p.IsAnaphylaxisRisk = true;
            p.AllergyManagementNotes = "EpiPen carried at all times; all support staff briefed on the anaphylaxis action plan.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000007"), p => // Jack — manual wheelchair, independent
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000008"), p => // Charlotte — autism, flight risk, BOC
        {
            p.Memory = MemoryLevel.Excellent;
            p.ImpairedUnderstanding = false; p.ImpairedJudgementReasoning = false;
            p.BehavioursOfConcernCurrent = true;
            p.BehavioursOfConcernFiveYearHistory = true;
            p.BehaviourRiskRating = RiskRatingLevel.High;
            p.RidsLogged = true; p.BspPlanProvided = true; p.BocChartProvided = true;
            p.ExpressiveSkills = "High — verbal, but may script under stress."; p.ReceptiveSkills = "High.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000001"), p => // Isabella — allergy only
        {
            p.AllergiesDetail = "Penicillin — rash, not anaphylactic.";
            p.IsAnaphylaxisRisk = false;
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000002"), p => // Mason — power wheelchair, independent transfers
        {
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000003"), p => // Chloe — Down syndrome, sudden-change distress
        {
            p.Memory = MemoryLevel.Fair;
            p.ImpairedUnderstanding = true; p.ImpairedJudgementReasoning = true;
            p.BehavioursOfConcernCurrent = true;
            p.BehaviourRiskRating = RiskRatingLevel.Medium;
            p.RidsLogged = false; p.BspPlanProvided = true; p.BocChartProvided = false;
            p.ExpressiveSkills = "Medium — verbal, benefits from visual schedule."; p.ReceptiveSkills = "Medium.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000006"), p => // Harrison — MS, fatigue management
        {
            p.AmbulantStatus = AmbulantStatus.ShortDistance;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.LevelOfPersonalCare = PersonalCareLevel.OnePerson;
            p.SkinIntegrity = "Monitor for pressure areas — reduced mobility, no current concerns.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000008"), p => // Ryan — ABI stroke, aphasia, right-side weakness
        {
            p.AmbulantStatus = AmbulantStatus.Frame;
            p.FallsRiskRating = RiskRatingLevel.Medium;
            p.Memory = MemoryLevel.Fair;
            p.BehavioursOfConcernCurrent = true;
            p.BehaviourRiskRating = RiskRatingLevel.Low;
            p.ExpressiveSkills = "Low — aphasia post-stroke, allow extra time for word-finding.";
            p.ReceptiveSkills = "High — understanding intact.";
            p.CommunicationAids = "Communication board for word-finding difficulty.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000010"), p => // Dylan — manual wheelchair, flat terrain only
        {
            p.UnevenGroundFlag = true;
            p.FallsRiskRating = RiskRatingLevel.Low;
            p.LevelOfPersonalCare = PersonalCareLevel.Independent;
        });

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C2. Seeds realistic <see cref="ParticipantAdlAssessment"/> rows (both
    /// Personal and Community/Domestic ADLs) for a majority of the 20 demo participants — levels
    /// chosen to be coherent with each participant's existing mobility/personal-care/cognitive
    /// attributes seeded by <see cref="SeedParticipantClinicalEnrichmentAsync"/> (e.g. Olivia
    /// Wilson's TwoPerson LevelOfPersonalCare and non-verbal AAC note are mirrored here as
    /// FullSupport-level personal ADLs; Sophie Brown's Epilepsy/Supervision-level care mirrors into
    /// Supervision-level Medication Administration/Community Access rows). Includes deliberately
    /// unanswered (null Level) rows for a couple of participants — the "not assessed" grid state,
    /// same doctrine as SeedParticipantHealthConditionsAsync's Natalie Walsh gap. Idempotent via
    /// fixed GUIDs (formulaic, same pattern as SeedParticipantHealthConditionsAsync) + an existence
    /// check.
    /// </summary>
    public static async Task SeedParticipantAdlAssessmentsAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantAdlAssessments.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var plans = new (Guid ParticipantId, (AdlType Type, AdlLevel? Level, string? Notes)[] Rows)[]
        {
            // Liam Johnson — SCI, independent transfers.
            (Guid.Parse("d1000000-0000-0000-0000-000000000001"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Supervision, "Shower chair in use — standby supervision for safety."),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, "Manual wheelchair transfers into vehicle."),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Sophie Brown — ABI + Epilepsy, Supervision-level personal care.
            (Guid.Parse("d1000000-0000-0000-0000-000000000002"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.Supervision, "Anti-epileptic medication — supervise to confirm doses taken."),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Supervision, "Seizure risk — line-of-sight supervision in the community."),
            }),
            // Noah Taylor — fully ambulant, independent.
            (Guid.Parse("d1000000-0000-0000-0000-000000000003"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Banking, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, TwoPerson personal care, non-verbal/AAC.
            (Guid.Parse("d1000000-0000-0000-0000-000000000004"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.Bathing, (AdlLevel?)AdlLevel.FullSupport, "Two-person assist, ceiling hoist."),
                (AdlType.OralCare, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.FullSupport, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.FullSupport, "Administered via PEG per plan."),
                // Deliberately unanswered — financial matters are managed by the SIL provider/administrator, not yet assessed on this grid.
                (AdlType.Banking, (AdlLevel?)null, (string?)null),
            }),
            // Charlotte White — autism L3, flight risk, requires 1:1 line-of-sight supervision.
            (Guid.Parse("d1000000-0000-0000-0000-000000000008"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Grooming, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Assistance, "Flight risk in unfamiliar environments — 1:1 line-of-sight supervision required."),
                (AdlType.Socialising, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.RoadAwareness, (AdlLevel?)AdlLevel.Assistance, (string?)null),
            }),
            // William Martin — DSOA, experienced traveller.
            (Guid.Parse("d1000000-0000-0000-0000-000000000009"), new[]
            {
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.PublicTransport, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Isabella Clarke — enthusiastic traveller, no other flags.
            (Guid.Parse("d2000000-0000-0000-0000-000000000001"), new[]
            {
                (AdlType.CommunityAccess, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Socialising, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
            // Mason Nguyen — power wheelchair, independent transfers on level surfaces.
            (Guid.Parse("d2000000-0000-0000-0000-000000000002"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, "Power wheelchair — accessible vehicle loading assistance."),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Chloe Robinson — Down syndrome, impaired understanding, sudden-change distress.
            (Guid.Parse("d2000000-0000-0000-0000-000000000003"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Assistance, "Prefers advance notice/visual schedule for appointments."),
                (AdlType.Cleaning, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.MedicationAdministration, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Harrison Lee — MS, fatigue management, OnePerson personal care.
            (Guid.Parse("d2000000-0000-0000-0000-000000000006"), new[]
            {
                (AdlType.Bathing, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.Toileting, (AdlLevel?)AdlLevel.Independent, (string?)null),
                (AdlType.Laundry, (AdlLevel?)AdlLevel.Assistance, "Fatigue management — avoid over-exertion."),
                (AdlType.Gardening, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Supervision, (string?)null),
            }),
            // Ryan Murphy — ABI stroke, aphasia, right-side weakness.
            (Guid.Parse("d2000000-0000-0000-0000-000000000008"), new[]
            {
                (AdlType.Dressing, (AdlLevel?)AdlLevel.Assistance, "Right-side weakness post-stroke."),
                (AdlType.Grooming, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.MoneyHandling, (AdlLevel?)AdlLevel.Assistance, "Aphasia — allow extra time, use visual aids where possible."),
                (AdlType.Appointments, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                // Deliberately unanswered — vocational goals under review, not yet assessed.
                (AdlType.WorkStudy, (AdlLevel?)null, "Not currently working — vocational goals under review."),
            }),
            // Dylan Foster — manual wheelchair, flat terrain only.
            (Guid.Parse("d2000000-0000-0000-0000-000000000010"), new[]
            {
                (AdlType.Transportation, (AdlLevel?)AdlLevel.Assistance, (string?)null),
                (AdlType.Shopping, (AdlLevel?)AdlLevel.Supervision, (string?)null),
                (AdlType.Kitchen, (AdlLevel?)AdlLevel.Independent, (string?)null),
            }),
        };

        var participantIds = plans.Select(p => p.ParticipantId).ToArray();
        var participantExists = await context.Participants.IgnoreQueryFilters()
            .Where(p => participantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (participantExists.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var rows = new List<ParticipantAdlAssessment>();
        var counter = 1;
        foreach (var (participantId, adlRows) in plans)
        {
            if (!participantExists.Contains(participantId))
                continue;

            foreach (var (type, level, notes) in adlRows)
            {
                rows.Add(new ParticipantAdlAssessment
                {
                    // Deterministic across runs — same formula as SeedParticipantHealthConditionsAsync's counter-derived ids.
                    Id = Guid.Parse($"7b000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    AdlType = type,
                    Level = level,
                    Notes = notes,
                    CreatedAt = now.AddMonths(-2), UpdatedAt = now.AddMonths(-2),
                });
                counter++;
            }
        }

        if (rows.Count == 0)
            return;

        context.ParticipantAdlAssessments.AddRange(rows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE sub-wave C2. Updates a majority of the 20 demo participants IN PLACE with the new
    /// flat Meals &amp; Diet/About Me columns (Master Data Dictionary MEAL-001..012 minus the
    /// allergies dedup, GOAL-001..008 minus the Hobbies dedup — see Participant.cs's field group
    /// doc) — chosen to be coherent with each participant's existing diagnoses/mobility/behaviour
    /// notes (e.g. Olivia Wilson's PEG feeding already on her medical record now also sets
    /// PegRegimeMealDetail/ModifiedDietDetail consistently; Sophie Brown's structured-routine note
    /// now also sets Goals/ThingsToKnow consistently with her BSP). Idempotent via an existence
    /// check on whether any of the target participants already has Goals set (a column no earlier
    /// sub-wave could have populated) rather than fixed GUIDs, since this seeder UPDATES existing
    /// rows rather than inserting new ones — same idempotency idiom as
    /// SeedParticipantClinicalEnrichmentAsync's AmbulantStatus check.
    /// </summary>
    public static async Task SeedParticipantDailyLivingAsync(OdipDbContext context, CancellationToken ct = default)
    {
        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;

        var targetIds = new[]
        {
            Guid.Parse("d1000000-0000-0000-0000-000000000001"), // Liam
            Guid.Parse("d1000000-0000-0000-0000-000000000002"), // Sophie
            Guid.Parse("d1000000-0000-0000-0000-000000000003"), // Noah
            Guid.Parse("d1000000-0000-0000-0000-000000000004"), // Olivia
            Guid.Parse("d1000000-0000-0000-0000-000000000007"), // Jack
            Guid.Parse("d1000000-0000-0000-0000-000000000008"), // Charlotte
            Guid.Parse("d1000000-0000-0000-0000-000000000009"), // William
            Guid.Parse("d2000000-0000-0000-0000-000000000001"), // Isabella
            Guid.Parse("d2000000-0000-0000-0000-000000000003"), // Chloe
            Guid.Parse("d2000000-0000-0000-0000-000000000005"), // Grace
            Guid.Parse("d2000000-0000-0000-0000-000000000006"), // Harrison
            Guid.Parse("d2000000-0000-0000-0000-000000000008"), // Ryan
            Guid.Parse("d2000000-0000-0000-0000-000000000009"), // Natalie
        };

        var participants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        // Idempotency guard: if any target participant already has Goals populated, this seeder
        // has already run (no earlier sub-wave could have set that column).
        if (participants.Any(p => p.Goals != null))
            return;

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(Guid.Parse("d1000000-0000-0000-0000-000000000001"), p => // Liam — SCI, independent, surfing/beach volleyball
        {
            p.MealAssistanceDetail = "Independent with meals — able to prepare simple meals from a seated position.";
            p.FavouriteBreakfast = "Eggs on toast."; p.FavouriteLunch = "Chicken wrap."; p.FavouriteDinner = "BBQ and salad.";
            p.FoodsAlwaysEaten = "Fresh fruit with every meal.";
            p.Goals = "Build more independence with meal preparation; get back into regular surfing.";
            p.SupportAreas = "Meal prep, community access for sport.";
            p.StrengthsFears = "Strength: very social and motivated. Fear: being seen as \"unable\" in public.";
            p.ThingsToKnow = "Prefers to transfer himself where possible — offer help, don't assume.";
            p.WhoIsImportant = "Mother Karen and his younger sibling.";
            p.LikesDislikes = "Likes the beach and rugby league. Dislikes being rushed.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000002"), p => // Sophie — ABI + Epilepsy, structured routine
        {
            p.MealAssistanceDetail = "Independent with meals; supervise medication administration at mealtimes.";
            p.ChokingRiskMealDetail = "No known swallowing risk — general supervision only, consistent with no Dysphagia flag on the health-condition grid.";
            p.MedicationTricks = "Takes tablets more easily with a small amount of yoghurt.";
            p.Goals = "Maintain a structured daily routine; reduce seizure frequency.";
            p.SupportAreas = "Community access supervision, medication prompting.";
            p.StrengthsFears = "Strength: creative, expressive through art. Fear: loud/crowded environments.";
            p.ThingsToKnow = "Needs advance notice of any routine change.";
            p.WhoIsImportant = "Her partner.";
            p.LikesDislikes = "Likes painting and live music. Dislikes sudden loud noises.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000003"), p => // Noah — fully independent, bushwalking
        {
            p.FavouriteBreakfast = "Porridge with banana."; p.FavouriteLunch = "Salad sandwich."; p.FavouriteDinner = "Pasta.";
            p.Goals = "Try bushwalking trips; meet new people on his first trip.";
            p.SupportAreas = "None currently identified.";
            p.LikesDislikes = "Likes the outdoors. Dislikes being micromanaged.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000004"), p => // Olivia — CP quadriplegia, PEG feeding, non-verbal/AAC
        {
            p.MealAssistanceDetail = "Full assistance required for all meals.";
            p.ModifiedDietDetail = "No oral intake — nutrition delivered via PEG.";
            p.PegRegimeMealDetail = "PEG feeding regime per plan — see HIDPA Enteral Feeding category; staff trained.";
            p.SpecialUtensilsDetail = "N/A — PEG fed, no oral utensils used.";
            p.Goals = "Maintain skin integrity and PEG site health; continue art gallery/live jazz outings.";
            p.SupportAreas = "Full personal care, PEG feeding, communication via AAC device.";
            p.StrengthsFears = "Strength: expressive through her AAC device once given time. Fear: being spoken over rather than to.";
            p.ThingsToKnow = "Always confirm with her AAC device before proceeding with any task.";
            p.WhoIsImportant = "Her fellow residents at the group home.";
            p.LikesDislikes = "Likes art galleries and live jazz. Dislikes being rushed through communication.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000007"), p => // Jack — independent, photography
        {
            p.Goals = "Build a photography portfolio from trips.";
            p.LikesDislikes = "Likes photography and urban exploring. Dislikes being treated as less capable because of his wheelchair.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000008"), p => // Charlotte — autism L3, flight risk, structure-dependent
        {
            p.MealAssistanceDetail = "Independent with meals; prefers the same plate/cup each time.";
            p.SpecialDietaryNeedsDetail = "Prefers plain/unmixed foods — avoid sauces touching other foods.";
            p.FoodsAlwaysEaten = "Plain pasta, chicken nuggets.";
            p.Goals = "Build tolerance for small routine changes with advance warning.";
            p.SupportAreas = "1:1 line-of-sight supervision in the community; routine-change preparation.";
            p.StrengthsFears = "Strength: deep knowledge of animals and nature. Fear: unfamiliar environments without notice.";
            p.ThingsToKnow = "Give advance notice of any routine change — see BSP.";
            p.WhoIsImportant = "Her support worker Emily.";
            p.LikesDislikes = "Likes animals and nature walks. Dislikes crowded, noisy places.";
        });
        Set(Guid.Parse("d1000000-0000-0000-0000-000000000009"), p => // William — DSOA, experienced traveller
        {
            p.FavouriteBreakfast = "Bacon and eggs."; p.FavouriteLunch = "Meat pie."; p.FavouriteDinner = "Roast dinner.";
            p.Goals = "Keep active with sport and travel.";
            p.LikesDislikes = "Likes cricket and AFL. Dislikes early mornings.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000001"), p => // Isabella — enthusiastic traveller
        {
            p.Goals = "Try a new cafe or live-music venue on every trip.";
            p.LikesDislikes = "Likes live music and cafes. Dislikes long waits.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000003"), p => // Chloe — Down syndrome, sudden-change distress
        {
            p.MealAssistanceDetail = "Independent with meals; benefits from a visual meal schedule.";
            p.Goals = "Cope better with unexpected changes using a visual schedule.";
            p.SupportAreas = "Advance warning of changes, visual supports.";
            p.StrengthsFears = "Strength: loves dancing and craft. Fear: sudden unannounced changes.";
            p.ThingsToKnow = "Use a visual schedule and give warning before any change.";
            p.WhoIsImportant = "Her family.";
            p.LikesDislikes = "Likes dancing and craft activities. Dislikes sudden change.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000005"), p => // Grace — good communicator, cooking/gardening
        {
            p.FavouriteBreakfast = "Muesli and yoghurt."; p.FavouriteLunch = "Garden salad."; p.FavouriteDinner = "Stir fry.";
            p.Goals = "Grow her own vegetables; try new recipes.";
            p.LikesDislikes = "Likes cooking and gardening. Dislikes being interrupted mid-task.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000006"), p => // Harrison — MS, fatigue management
        {
            p.MealAssistanceDetail = "Independent with meals when not fatigued; offer breaks during preparation.";
            p.Goals = "Manage fatigue while staying active — prefers morning activities.";
            p.SupportAreas = "Fatigue management, pacing of daily tasks.";
            p.ThingsToKnow = "Prefers morning activities — fatigues more easily later in the day.";
            p.LikesDislikes = "Likes rugby league and fishing. Dislikes over-scheduled days.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000008"), p => // Ryan — ABI stroke, aphasia
        {
            p.MealAssistanceDetail = "Independent with meals; right-side weakness — offer adaptive utensils if needed.";
            p.SpecialUtensilsDetail = "Weighted/non-slip utensils available if fatigued.";
            p.Goals = "Continue building communication confidence since ABI rehab.";
            p.SupportAreas = "Communication support, extra time for word-finding.";
            p.StrengthsFears = "Strength: comfortable traveller, loves AFL. Fear: being rushed mid-sentence.";
            p.ThingsToKnow = "Allow extra time to communicate — aphasia post-ABI.";
            p.WhoIsImportant = "Family gatherings, especially AFL match days.";
            p.LikesDislikes = "Likes AFL and family gatherings. Dislikes being finished off mid-sentence.";
        });
        Set(Guid.Parse("d2000000-0000-0000-0000-000000000009"), p => // Natalie — social butterfly
        {
            p.Goals = "Keep up an active social calendar.";
            p.LikesDislikes = "Likes socialising and board games. Dislikes sitting out of group activities.";
        });

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// INTAKE-03/04. Seeds the CommunityAccessDailyLiving service-stream variant for a
    /// representative subset of demo participants: adds the ServiceStreams flag, a representative
    /// subset of <see cref="ParticipantChecklistItem"/> rows (both new checklists), HowToHelpNotes
    /// on a few of their existing <see cref="ParticipantAdlAssessment"/> rows, all four
    /// SupportsLookLike* shift blocks, and the six BOC/happy-settled flat fields (research spec
    /// §3). Chosen participants: Sophie Brown (ABI + Epilepsy — already has CommunityAccess ADL
    /// supervision notes for seizure risk, a natural CA fit), Charlotte White (autism L3, flight
    /// risk — already has 1:1 line-of-sight community-access supervision notes, the clearest
    /// existing CA fit in the demo data), and Olivia Wilson (CP quadriplegia, power wheelchair,
    /// non-verbal/AAC — a strong fit for the Community Mobility &amp; Transport Risk checklist
    /// specifically). All three are finalised (non-draft) participants already receiving other
    /// in-home-support-style attention (Sophie/Charlotte both already appear throughout the
    /// clinical-enrichment/ADL seeders above). Idempotent via fixed GUIDs (formulaic, same pattern
    /// as SeedParticipantAdlAssessmentsAsync) + an existence check on ParticipantChecklistItems.
    /// </summary>
    public static async Task SeedCommunityAccessDailyLivingAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ParticipantChecklistItems.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var oliviaId = Guid.Parse("d1000000-0000-0000-0000-000000000004");
        var targetIds = new[] { sophieId, charlotteId, oliviaId };

        var participants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetIds.Contains(p.Id)).ToListAsync(ct);
        if (participants.Count == 0)
            return;

        var adlRows = await context.ParticipantAdlAssessments.IgnoreQueryFilters()
            .Where(a => targetIds.Contains(a.ParticipantId)).ToListAsync(ct);

        void SetAdlHowToHelp(Guid participantId, AdlType type, string howToHelp)
        {
            var row = adlRows.FirstOrDefault(a => a.ParticipantId == participantId && a.AdlType == type);
            if (row != null) row.HowToHelpNotes = howToHelp;
        }

        var checklistPlans = new (Guid ParticipantId, (ChecklistItemType Type, ChecklistItemValue? Value, string? Notes)[] Rows)[]
        {
            // Sophie Brown — ABI + Epilepsy, seizure risk in community, supervision-level community access.
            (sophieId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.FallsRisk, (ChecklistItemValue?)ChecklistItemValue.Yes, "Seizure-related falls risk — supervise on stairs/uneven ground."),
                (ChecklistItemType.SensorySensitivities, (ChecklistItemValue?)ChecklistItemValue.Yes, "Avoid loud/crowded venues where possible."),
                (ChecklistItemType.SeatbeltMustBeChecked, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.AbscondingRunningAway, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.VerbalAggressionYelling, (ChecklistItemValue?)ChecklistItemValue.NotApplicable, (string?)null),
            }),
            // Charlotte White — autism L3, flight risk, 1:1 line-of-sight supervision in the community.
            (charlotteId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.SensorySensitivities, (ChecklistItemValue?)ChecklistItemValue.Yes, "Noise/crowds — carry noise-cancelling headphones."),
                (ChecklistItemType.CommunicationAidOrDeviceUsed, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.AbscondingRunningAway, (ChecklistItemValue?)ChecklistItemValue.Yes, "Flight risk in unfamiliar environments — 1:1 line-of-sight supervision required."),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.HarmToOthers, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.RefusalToMoveTransition, (ChecklistItemValue?)ChecklistItemValue.Yes, "May refuse to leave a preferred activity — give a 5-minute warning before transitions."),
                (ChecklistItemType.InappropriatePublicBehaviour, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
            }),
            // Olivia Wilson — CP quadriplegia, power wheelchair, non-verbal/AAC.
            (oliviaId, new[]
            {
                (ChecklistItemType.UsesWheelchair, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.WheelchairAccessibleVehicleRequired, (ChecklistItemValue?)ChecklistItemValue.Yes, (string?)null),
                (ChecklistItemType.WalkingFrameOrAids, (ChecklistItemValue?)ChecklistItemValue.NotApplicable, (string?)null),
                (ChecklistItemType.IssuesWithUnevenGround, (ChecklistItemValue?)ChecklistItemValue.Yes, "Power wheelchair — avoid gravel/unsealed paths where possible."),
                (ChecklistItemType.SeatbeltMustBeChecked, (ChecklistItemValue?)ChecklistItemValue.Yes, "Check wheelchair restraint and lap belt on every vehicle transfer."),
                (ChecklistItemType.CommunicationAidOrDeviceUsed, (ChecklistItemValue?)ChecklistItemValue.Yes, "AAC device — always confirm with it before proceeding with any task."),
                (ChecklistItemType.HarmToSelf, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
                (ChecklistItemType.HarmToOthers, (ChecklistItemValue?)ChecklistItemValue.No, (string?)null),
            }),
        };

        var now = DateTime.UtcNow;
        var checklistRows = new List<ParticipantChecklistItem>();
        var counter = 1;
        foreach (var (participantId, items) in checklistPlans)
        {
            if (!participants.Any(p => p.Id == participantId))
                continue;

            foreach (var (type, value, notes) in items)
            {
                checklistRows.Add(new ParticipantChecklistItem
                {
                    // Deterministic across runs — same formula as SeedParticipantAdlAssessmentsAsync's counter-derived ids.
                    Id = Guid.Parse($"7c000000-0000-0000-0000-{counter:D12}"),
                    TenantId = demoTenantId,
                    ParticipantId = participantId,
                    ItemType = type,
                    Value = value,
                    Notes = notes,
                    CreatedAt = now, UpdatedAt = now,
                });
                counter++;
            }
        }

        void Set(Guid id, Action<Participant> apply)
        {
            var p = participants.FirstOrDefault(x => x.Id == id);
            if (p != null) apply(p);
        }

        Set(sophieId, p => // Sophie — ABI + Epilepsy, structured routine
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Relaxed posture, engaged in conversation, humming to herself while painting.";
            p.WhatHelpsMeCalmDown = "A quiet space and her sketchbook; step away from noise/crowds.";
            p.BocTriggers = "Sudden loud noises, unplanned changes to the day's schedule.";
            p.BocEarlyWarningSigns = "Goes quiet, stops making eye contact, fidgets with her hands.";
            p.BocDeEscalationStrategies = "Offer a quiet space, reduce stimulation, give her sketchbook.";
            p.BocWhatNotToDo = "Don't crowd her or raise your voice — give space and time.";
            p.SupportsLookLikeMorning = "Support with medication prompting and breakfast; check seizure diary.";
            p.SupportsLookLikeDay = "Community access with line-of-sight supervision; encourage art/creative activities.";
            p.SupportsLookLikeAfternoonEvening = "Wind-down time with low-stimulation activities; medication reminder.";
            p.SupportsLookLikeOvernight = "Not currently receiving overnight Oassist support.";
        });

        Set(charlotteId, p => // Charlotte — autism L3, flight risk, structure-dependent
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Talking about animals, relaxed shoulders, following the planned schedule without prompting.";
            p.WhatHelpsMeCalmDown = "Noise-cancelling headphones and a familiar routine.";
            p.BocTriggers = "Unfamiliar environments without advance notice; crowded/noisy venues.";
            p.BocEarlyWarningSigns = "Increased pacing, repeating questions about the schedule.";
            p.BocDeEscalationStrategies = "Move to a quieter area, revisit the visual schedule, give a 5-minute transition warning.";
            p.BocWhatNotToDo = "Don't force a transition without warning or introduce a new environment unannounced.";
            p.SupportsLookLikeMorning = "Review the visual schedule for the day together before leaving.";
            p.SupportsLookLikeDay = "1:1 line-of-sight community access supervision; carry noise-cancelling headphones.";
            p.SupportsLookLikeAfternoonEvening = "Wind-down with a preferred nature/animal activity.";
            p.SupportsLookLikeOvernight = "Not currently receiving overnight Oassist support.";
        });

        Set(oliviaId, p => // Olivia — CP quadriplegia, power wheelchair, non-verbal/AAC
        {
            p.ServiceStreams |= ServiceStreams.CommunityAccessDailyLiving;
            p.SignsHappyAndSettled = "Active AAC device use, relaxed posture, smiling and engaging with surroundings.";
            p.WhatHelpsMeCalmDown = "Familiar music and being given time to communicate via her AAC device.";
            p.BocTriggers = "Being spoken over rather than to; being rushed mid-communication.";
            p.BocEarlyWarningSigns = "Disengages from her AAC device, avoids eye contact.";
            p.BocDeEscalationStrategies = "Pause, give full attention, wait for her to use the AAC device.";
            p.BocWhatNotToDo = "Don't finish sentences for her or move on before she's finished communicating.";
            p.SupportsLookLikeMorning = "Full assistance with personal care; two-person transfer with ceiling hoist.";
            p.SupportsLookLikeDay = "Community access via wheelchair-accessible vehicle; confirm plans via AAC device before proceeding.";
            p.SupportsLookLikeAfternoonEvening = "PEG feeding regime per plan; skin-integrity check.";
            p.SupportsLookLikeOvernight = "Two-person assist for repositioning per pressure-care schedule.";
        });

        // HowToHelpNotes on a couple of each participant's existing ADL rows.
        SetAdlHowToHelp(sophieId, AdlType.CommunityAccess, "Stay within sight at all times; watch for early-warning seizure signs and keep a clear path to sit down.");
        SetAdlHowToHelp(sophieId, AdlType.MedicationAdministration, "Prompt gently and confirm the tablet was swallowed — offer a small amount of yoghurt if needed.");
        SetAdlHowToHelp(charlotteId, AdlType.CommunityAccess, "Keep line-of-sight at all times; use the visual schedule and give 5-minute warnings before any transition.");
        SetAdlHowToHelp(oliviaId, AdlType.Bathing, "Confirm each step with her via the AAC device before proceeding — never rush.");
        SetAdlHowToHelp(oliviaId, AdlType.MedicationAdministration, "Administer via PEG per plan; confirm site looks normal before and after.");

        foreach (var p in participants) p.UpdatedAt = DateTime.UtcNow;

        if (checklistRows.Count > 0)
            context.ParticipantChecklistItems.AddRange(checklistRows);
        await context.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Seeds a couple of demo <see cref="Shift"/> rows plus <see cref="ShiftNote"/> entries on
    /// them (NOTES-01). No other seeder in this file creates <see cref="Shift"/> rows at all —
    /// rostering data normally only exists once a coordinator uses the roster board — so this
    /// method creates the handful of shifts it needs itself, gated on the same
    /// idempotency check as everywhere else in this file (fixed GUIDs + an existence check on
    /// the table this method actually owns seeding of, ShiftNotes).
    /// </summary>
    public static async Task SeedShiftNotesAsync(OdipDbContext context, CancellationToken ct = default)
    {
        if (await context.ShiftNotes.IgnoreQueryFilters().AnyAsync(ct))
            return;

        var demoTenant = await context.Tenants.FirstOrDefaultAsync(t => t.EmailDomain == "demo.odip.com.au", ct);
        if (demoTenant is null)
            return;
        var demoTenantId = demoTenant.Id;

        var sophieId = Guid.Parse("d1000000-0000-0000-0000-000000000002");
        var charlotteId = Guid.Parse("d1000000-0000-0000-0000-000000000008");
        var jamesUserId = Guid.Parse("b1000000-0000-0000-0000-000000000003");
        var emilyUserId = Guid.Parse("b2000000-0000-0000-0000-000000000002");

        var targetParticipantIds = new[] { sophieId, charlotteId };
        var existingParticipants = await context.Participants.IgnoreQueryFilters()
            .Where(p => targetParticipantIds.Contains(p.Id)).Select(p => p.Id).ToListAsync(ct);
        var targetUserIds = new[] { jamesUserId, emilyUserId };
        var existingUsers = await context.Users.IgnoreQueryFilters()
            .Where(u => targetUserIds.Contains(u.Id)).Select(u => u.Id).ToListAsync(ct);
        if (existingParticipants.Count == 0 || existingUsers.Count == 0)
            return;

        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);
        var shifts = new List<Shift>();
        var notes = new List<ShiftNote>();

        if (existingParticipants.Contains(sophieId) && existingUsers.Contains(jamesUserId))
        {
            var sophieShift = new Shift
            {
                Id = Guid.Parse("77000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ParticipantId = sophieId, UserId = jamesUserId, ServiceDate = today.AddDays(-2),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
                Ratio = SupportRatio.TwoToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
                CreatedAt = now.AddDays(-2), UpdatedAt = now.AddDays(-2),
            };
            shifts.Add(sophieShift);

            // Three notes — enough to exercise the roster slide-over's collapsed-disclosure
            // threshold (>2 notes).
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000001"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Quiet shift — Sophie spent most of the afternoon on her art project. No seizure activity observed.",
                CreatedAt = now.AddDays(-2).AddHours(8), UpdatedAt = now.AddDays(-2).AddHours(8),
            });
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Reminded Sophie about her hair appointment next week with Marie — she's looking forward to it.",
                CreatedAt = now.AddDays(-2).AddHours(8).AddMinutes(30), UpdatedAt = now.AddDays(-2).AddHours(8).AddMinutes(30),
            });
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000003"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Handover: left her medication chart on the kitchen counter for the evening shift to sign off.",
                CreatedAt = now.AddDays(-2).AddHours(8).AddMinutes(45), UpdatedAt = now.AddDays(-2).AddHours(8).AddMinutes(45),
            });
            // NOTES-02 demo: trips the Falls category so the live demo shows the keyword-flagging
            // banner + incident-report prompt on a real seeded note.
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000005"), TenantId = demoTenantId,
                ShiftId = sophieShift.Id, AuthorUserId = jamesUserId, AuthorName = "James O'Brien",
                Body = "Sophie stumbled near the back step on the way in from the garden — caught herself on the rail, no injury seen but keeping an eye on her today.",
                CreatedAt = now.AddDays(-2).AddHours(9), UpdatedAt = now.AddDays(-2).AddHours(9),
            });
        }

        if (existingParticipants.Contains(charlotteId) && existingUsers.Contains(emilyUserId))
        {
            var charlotteShift = new Shift
            {
                Id = Guid.Parse("77000000-0000-0000-0000-000000000002"), TenantId = demoTenantId,
                ParticipantId = charlotteId, UserId = emilyUserId, ServiceDate = today.AddDays(-1),
                StartTime = new TimeOnly(14, 0), EndTime = new TimeOnly(22, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published,
                CreatedAt = now.AddDays(-1), UpdatedAt = now.AddDays(-1),
            };
            shifts.Add(charlotteShift);

            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000004"), TenantId = demoTenantId,
                ShiftId = charlotteShift.Id, AuthorUserId = emilyUserId, AuthorName = "Emily Nguyen",
                Body = "Charlotte was a little agitated after a change to the evening routine — settled quickly once we moved to a quiet space with her headphones.",
                CreatedAt = now.AddDays(-1).AddHours(7), UpdatedAt = now.AddDays(-1).AddHours(7),
            });
            // NOTES-02 demo: trips the Medication category alongside the existing agitation note
            // above (which already trips BehaviourOfConcern on its own), so the demo tenant shows
            // both seeded categories the brief asks for (falls + medication) without either note
            // being contrived-looking.
            notes.Add(new ShiftNote
            {
                Id = Guid.Parse("78000000-0000-0000-0000-000000000006"), TenantId = demoTenantId,
                ShiftId = charlotteShift.Id, AuthorUserId = emilyUserId, AuthorName = "Emily Nguyen",
                Body = "Charlotte's 6pm medication was given a little later than usual — checked the chart and confirmed the tablet was the right dose.",
                CreatedAt = now.AddDays(-1).AddHours(7).AddMinutes(30), UpdatedAt = now.AddDays(-1).AddHours(7).AddMinutes(30),
            });
        }

        if (shifts.Count == 0)
            return;

        // NOTES-02: compute flagged categories the same way PortalController does at save time —
        // via the shared scanner, not hardcoded — so the seeded demo data always reflects the
        // vocabulary's current behaviour rather than a value that could silently drift from it.
        foreach (var note in notes)
            note.FlaggedCategories = ShiftNoteKeywordScanner.Scan(note.Body);

        context.Shifts.AddRange(shifts);
        context.ShiftNotes.AddRange(notes);
        await context.SaveChangesAsync(ct);
    }

}
