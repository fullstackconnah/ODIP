using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The four "static" packs of PR 1: provider settings, staff credentials (D1), the compatibility matrix and emergency contacts. They run
/// once and are then left alone, so the tests are about what they insert, what they refuse to touch, and the plan's own numbers.
/// </summary>
public class DemoStaticPacksTests
{
    private static readonly DateOnly D0 = new(2026, 10, 2);   // the first-fill date: Fri 10:30 AEST

    private static async Task<DemoTestEnv> EnvWithPeopleAsync()
    {
        var env = DemoTestEnv.At(2026, 10, 2, 0, 30);
        await DemoFixture.SeedPeopleAsync(env);
        return env;
    }

    // ── ProviderSettings (D2) ────────────────────────────────────────────────

    [Fact]
    public async Task ProviderSettings_AreInsertedForTheDemoTenant_InNswWithBothModesOnWarn()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new ProviderSettingsPack() });

        await using var db = env.AdminDb();
        var row = await db.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(DemoIds.For("provider-settings"), row.Id);
        Assert.Equal(DemoTestEnv.DemoTenantId, row.TenantId);
        Assert.Equal("NSW", row.State);
        Assert.Equal("Demo Disability Services (DEMO)", row.OrganisationName);
        Assert.True(row.GSTRegistered);
        Assert.Equal(ParticipantReadinessMode.Warn, row.ParticipantReadinessMode);
        Assert.Equal(MedicationCompetencyMode.Warn, row.MedicationCompetencyMode);
        Assert.False(string.IsNullOrWhiteSpace(row.ABN));
        Assert.False(string.IsNullOrWhiteSpace(row.RegistrationNumber));
        Assert.False(string.IsNullOrWhiteSpace(row.BSB));
    }

    [Fact]
    public async Task ProviderSettings_NeverChangeAnExistingRow_AndAddNoSecondOne()
    {
        var env = await EnvWithPeopleAsync();
        await env.SetProviderStateAsync("VIC");

        await env.RunAsync(new IDemoPack[] { new ProviderSettingsPack() });

        await using var db = env.AdminDb();
        var row = await db.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("VIC", row.State);
        Assert.Equal("Existing Provider", row.OrganisationName);
    }

    [Fact]
    public async Task ProviderSettings_UseObviouslyFictionalIdentifiers()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new ProviderSettingsPack() });

        await using var db = env.AdminDb();
        var row = await db.ProviderSettings.IgnoreQueryFilters().SingleAsync();
        Assert.Contains("DEMO", row.OrganisationName);
        Assert.StartsWith("000", row.BSB);                               // 000-xxx is not an assigned bank code
        Assert.Contains("DEMO", row.RegistrationNumber);
        Assert.Matches(@"^0+[ 0]*$", row.ABN.Replace("-", ""));          // an all-zero ABN: not a real business
    }

    // ── credentials (D1) ─────────────────────────────────────────────────────

    // (screening, first aid, driver, manual handling, medication) offsets from D0; null = left empty (flag false, or Jade's screening on purpose)
    private static readonly Dictionary<string, int?[]> Allocation = new()
    {
        ["james"] = new int?[] { 400, 200, 500, 180, 300 },
        ["sarah"] = new int?[] { 250, 90, 400, 120, 365 },
        ["marcus"] = new int?[] { 500, 300, 300, 300, 300 },
        ["rachel"] = new int?[] { 90, 45, 300, 25, 200 },
        ["brendan"] = new int?[] { 180, 120, 4, 200, 200 },
        ["jade"] = new int?[] { null, 150, 350, 150, 250 },
        ["emily"] = new int?[] { 200, -12, 150, 90, null },
        ["daniel"] = new int?[] { 20, 60, null, null, 10 },
        ["priya"] = new int?[] { 365, 30, null, 100, -5 },
        ["lachlan"] = new int?[] { 2, null, 60, 60, null },
    };

    private static DateOnly?[] Dates(User u) => new[]
    {
        u.WorkerScreeningExpiryDate, u.FirstAidExpiryDate, u.DriverLicenceExpiryDate, u.ManualHandlingExpiryDate, u.MedicationCompetencyExpiryDate,
    };

    [Fact]
    public async Task Credentials_AreFilledPerThePlansAllocation_FromTheFirstFillDate()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var db = env.AdminDb();
        foreach (var (key, offsets) in Allocation)
        {
            var user = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId(key));
            var expected = offsets.Select(o => o.HasValue ? D0.AddDays(o.Value) : (DateOnly?)null).ToArray();
            Assert.True(expected.SequenceEqual(Dates(user)), $"{key}: expected {string.Join(",", expected)} but found {string.Join(",", Dates(user))}");
        }
    }

    [Fact]
    public async Task Credentials_GiveEveryScreenedWorkerANumber_AndJadeNone()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var db = env.AdminDb();
        var numbers = await db.Users.Where(u => u.WorkerScreeningNumber != null).Select(u => u.WorkerScreeningNumber!).ToListAsync();
        Assert.Equal(9, numbers.Count);
        Assert.All(numbers, n => Assert.Matches(@"^WS-DEMO-\d{4}$", n));
        Assert.Equal(9, numbers.Distinct().Count());
        var jade = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("jade"));
        Assert.Null(jade.WorkerScreeningNumber);
        Assert.Null(jade.WorkerScreeningExpiryDate);
    }

    [Fact]
    public async Task Credentials_NeverTouchIdentityEmailRoleOrFlags()
    {
        var env = await EnvWithPeopleAsync();
        string Snapshot(User u) => $"{u.Id}|{u.TenantId}|{u.Username}|{u.Email}|{u.FirstName}|{u.LastName}|{u.Role}|{u.Position}|{u.Mobile}|{u.Region}|{u.IsActive}|" +
            $"{u.IsDriverEligible}|{u.IsFirstAidQualified}|{u.IsMedicationCompetent}|{u.IsManualHandlingCompetent}|{u.IsOvernightEligible}|{u.Notes}|{u.CreatedAt:O}";
        Dictionary<Guid, string> before;
        await using (var db = env.AdminDb()) before = (await db.Users.ToListAsync()).ToDictionary(u => u.Id, Snapshot);

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var after = env.AdminDb();
        var users = await after.Users.ToListAsync();
        Assert.Equal(11, users.Count);                                   // the read-only user is still there, and untouched
        Assert.All(users, u => Assert.Equal(before[u.Id], Snapshot(u)));
    }

    [Fact]
    public async Task Credentials_FillOnlyNullColumns_AnExistingDateIsNeverOverwritten()
    {
        var env = await EnvWithPeopleAsync();
        var ownersDate = new DateOnly(2031, 3, 4);
        await using (var db = env.AdminDb())
        {
            var emily = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("emily"));
            emily.FirstAidExpiryDate = ownersDate;
            emily.WorkerScreeningNumber = "OWNER-123";
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var check = env.AdminDb();
        var after = await check.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("emily"));
        Assert.Equal(ownersDate, after.FirstAidExpiryDate);
        Assert.Equal("OWNER-123", after.WorkerScreeningNumber);
        Assert.Equal(D0.AddDays(200), after.WorkerScreeningExpiryDate);   // the empty columns were still filled
        Assert.Equal(D0.AddDays(150), after.DriverLicenceExpiryDate);
    }

    [Fact]
    public async Task Credentials_AreFixedAfterTheFirstFill_ALaterTickNeverMovesThem()
    {
        var env = await EnvWithPeopleAsync();
        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });
        List<DateOnly?[]> first;
        await using (var db = env.AdminDb()) first = (await db.Users.OrderBy(u => u.Email).ToListAsync()).Select(Dates).ToList();

        env.Clock.Set(new DateTimeOffset(2026, 11, 20, 0, 30, 0, TimeSpan.Zero));
        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var check = env.AdminDb();
        var second = (await check.Users.OrderBy(u => u.Email).ToListAsync()).Select(Dates).ToList();
        Assert.Equal(first.Count, second.Count);
        for (var i = 0; i < first.Count; i++) Assert.True(first[i].SequenceEqual(second[i]));
    }

    [Fact]
    public async Task Credentials_ALapsedFlag_GetsNoDate()
    {
        var env = await EnvWithPeopleAsync();
        await using (var db = env.AdminDb())
        {
            var james = await db.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("james"));
            james.IsDriverEligible = false;                              // the owner un-ticked it
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var check = env.AdminDb();
        Assert.Null((await check.Users.SingleAsync(u => u.Id == DemoFixture.StaffId("james"))).DriverLicenceExpiryDate);
    }

    // The Qualifications rule (frontend lib/credentials.ts + deadline.ts): a flagged credential counts with no date, expired, due today or due within 30 days;
    // worker screening counts only once it has a date.
    private static int IssueCount(User u, DateOnly today)
    {
        bool Issue(DateOnly? date) => date is null || date.Value.DayNumber - today.DayNumber <= 30;
        var count = 0;
        if (u.IsFirstAidQualified && Issue(u.FirstAidExpiryDate)) count++;
        if (u.IsDriverEligible && Issue(u.DriverLicenceExpiryDate)) count++;
        if (u.IsManualHandlingCompetent && Issue(u.ManualHandlingExpiryDate)) count++;
        if (u.IsMedicationCompetent && Issue(u.MedicationCompetencyExpiryDate)) count++;
        if (u.WorkerScreeningExpiryDate is not null && Issue(u.WorkerScreeningExpiryDate)) count++;
        return count;
    }

    [Fact]
    public async Task TheQualificationsTile_ShowsAboutEightCredentialsOnSixStaff()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new StaffCredentialsPack() });

        await using var db = env.AdminDb();
        var users = await db.Users.ToListAsync();
        var perStaff = users.ToDictionary(u => u.Email, u => IssueCount(u, D0));
        Assert.Equal(8, perStaff.Values.Sum());
        Assert.Equal(6, perStaff.Values.Count(c => c > 0));
        Assert.Equal(0, perStaff[DemoPeople.StaffEmails["jade"]]);        // an undated screening does not count
        Assert.Equal(0, perStaff[DemoPeople.StaffEmails["james"]]);       // the staff on live shifts are all in date
        Assert.Equal(2, perStaff[DemoPeople.StaffEmails["priya"]]);       // first aid due soon, medication expired
    }

    // ── compatibility ────────────────────────────────────────────────────────

    [Fact]
    public async Task Compatibility_HasSevenPreferred_ThreeExcluded_AndOneAutoLinkedRow()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });

        await using var db = env.AdminDb();
        var rows = await db.StaffParticipantCompatibilities.ToListAsync();
        Assert.Equal(10, rows.Count);
        Assert.Equal(7, rows.Count(r => r.Level == CompatibilityLevel.Preferred));
        Assert.Equal(3, rows.Count(r => r.Level == CompatibilityLevel.Excluded));
        Assert.Equal(1, rows.Count(r => r.AutoLinked));
        Assert.True(rows.Single(r => r.AutoLinked).Level == CompatibilityLevel.Preferred);
        Assert.All(rows, r => Assert.Equal(DemoTestEnv.DemoTenantId, r.TenantId));
        Assert.Equal(10, rows.Select(r => (r.UserId, r.ParticipantId)).Distinct().Count());   // the unique (tenant, user, participant) cell
        Assert.All(rows.Where(r => r.Level == CompatibilityLevel.Excluded), r => Assert.False(string.IsNullOrWhiteSpace(r.Reason)));
    }

    [Fact]
    public async Task Compatibility_ExcludedPairs_AreEmilyRyan_LachlanCharlotte_DanielIsabella()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });

        await using var db = env.AdminDb();
        var excluded = (await db.StaffParticipantCompatibilities.Where(r => r.Level == CompatibilityLevel.Excluded).ToListAsync())
            .Select(r => (r.UserId, r.ParticipantId)).ToHashSet();
        Assert.Contains((DemoFixture.StaffId("emily"), DemoFixture.ParticipantId("ryan")), excluded);
        Assert.Contains((DemoFixture.StaffId("lachlan"), DemoFixture.ParticipantId("charlotte")), excluded);
        Assert.Contains((DemoFixture.StaffId("daniel"), DemoFixture.ParticipantId("isabella")), excluded);
    }

    [Fact]
    public async Task Compatibility_NeverOverwritesAnExistingCell_AndNeverAddsADuplicate()
    {
        var env = await EnvWithPeopleAsync();
        await using (var db = env.AdminDb())
        {
            // The owner has already decided Marcus/Olivia is Excluded; the pack would have said Preferred.
            db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, UserId = DemoFixture.StaffId("marcus"), ParticipantId = DemoFixture.ParticipantId("olivia"),
                Level = CompatibilityLevel.Excluded, Reason = "Owner decision",
            });
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new CompatibilityPack() });

        await using var check = env.AdminDb();
        var cell = await check.StaffParticipantCompatibilities
            .Where(r => r.UserId == DemoFixture.StaffId("marcus") && r.ParticipantId == DemoFixture.ParticipantId("olivia")).ToListAsync();
        var only = Assert.Single(cell);
        Assert.Equal(CompatibilityLevel.Excluded, only.Level);
        Assert.Equal("Owner decision", only.Reason);
        Assert.Equal(10, await check.StaffParticipantCompatibilities.CountAsync());           // 9 new + the owner's
    }

    // ── emergency contacts ───────────────────────────────────────────────────

    private static readonly string[] ShiftParticipants =
    {
        "sophie", "harrison", "charlotte", "noah", "ethan", "mia", "grace", "mason", "thomas", "ryan", "olivia", "william", "dylan", "jack", "chloe", "isabella",
    };

    [Fact]
    public async Task EmergencyContacts_GiveEveryRosteredParticipantAtLeastOneActiveContact()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new EmergencyContactsPack() });

        await using var db = env.AdminDb();
        var roles = await db.ParticipantContactRoles.Include(r => r.Person).Where(r => r.RoleType == ContactRoleType.EmergencyContact).ToListAsync();
        foreach (var key in ShiftParticipants)
        {
            var mine = roles.Where(r => r.ParticipantId == DemoFixture.ParticipantId(key)).ToList();
            Assert.True(mine.Count >= 1, $"{key} has no emergency contact");
            Assert.All(mine, r =>
            {
                Assert.Equal(ContactRoleStatus.Active, r.Status);
                Assert.NotNull(r.Person);
                Assert.False(string.IsNullOrWhiteSpace(r.Person!.FirstName));
                Assert.False(string.IsNullOrWhiteSpace(r.RelationshipToParticipant));
                Assert.NotNull(r.PriorityOrder);
            });
        }
    }

    [Fact]
    public async Task EmergencyContacts_UseOnlyFictionalAddressesAndNumbers()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new EmergencyContactsPack() });

        await using var db = env.AdminDb();
        var people = await db.People.ToListAsync();
        Assert.NotEmpty(people);
        Assert.All(people, p =>
        {
            Assert.True(string.IsNullOrEmpty(p.Email) || p.Email.EndsWith("@example.com.au", StringComparison.Ordinal), $"{p.FullName}: {p.Email}");
            Assert.True(!string.IsNullOrEmpty(p.Mobile) || !string.IsNullOrEmpty(p.Phone));
            Assert.True(string.IsNullOrEmpty(p.Mobile) || p.Mobile.StartsWith("0412 345 ", StringComparison.Ordinal), $"{p.FullName}: {p.Mobile}");
            Assert.True((p.Postcode ?? string.Empty).Length <= 4);
        });
    }

    [Fact]
    public async Task EmergencyContacts_LeaveAParticipantWhoAlreadyHasOneAlone()
    {
        var env = await EnvWithPeopleAsync();
        var personId = Guid.NewGuid();
        await using (var db = env.AdminDb())
        {
            db.People.Add(new Person { Id = personId, TenantId = DemoTestEnv.DemoTenantId, FirstName = "Existing", LastName = "Contact", Mobile = "0412 345 001" });
            db.ParticipantContactRoles.Add(new ParticipantContactRole
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ParticipantId = DemoFixture.ParticipantId("sophie"), PersonId = personId,
                RoleType = ContactRoleType.EmergencyContact, PriorityOrder = 1, RelationshipToParticipant = "Sister",
            });
            await db.SaveChangesAsync();
        }

        await env.RunAsync(new IDemoPack[] { new EmergencyContactsPack() });

        await using var check = env.AdminDb();
        var sophies = await check.ParticipantContactRoles
            .Where(r => r.ParticipantId == DemoFixture.ParticipantId("sophie") && r.RoleType == ContactRoleType.EmergencyContact).ToListAsync();
        Assert.Single(sophies);
        Assert.Equal(personId, sophies[0].PersonId);
    }

    [Fact]
    public async Task EmergencyContacts_AreValidRolesPerTheContactRules()
    {
        var env = await EnvWithPeopleAsync();

        await env.RunAsync(new IDemoPack[] { new EmergencyContactsPack() });

        await using var db = env.AdminDb();
        var roles = await db.ParticipantContactRoles.ToListAsync();
        var participants = await db.Participants.ToDictionaryAsync(p => p.Id);
        foreach (var role in roles)
        {
            var participant = participants[role.ParticipantId];
            Assert.Null(ContactRoleRules.Validate(role.RoleType, participant.PlanType, participant.DateOfBirth, role.RegisteredProviderFlag));
            var others = roles.Where(r => r.ParticipantId == role.ParticipantId && r.Id != role.Id).Select(r => (r.RoleType, r.IsPrimary, r.Status));
            Assert.Null(ContactRoleRules.ValidateUniqueness(role.RoleType, role.IsPrimary, role.Status, others));
        }
    }
}
