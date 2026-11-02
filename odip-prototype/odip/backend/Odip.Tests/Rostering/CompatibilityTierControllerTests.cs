using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>R8a: the ordered Preferred / Backup / Emergency tiers through the compatibility writer and reader, and the link service that shares the renumbering.</summary>
public class CompatibilityTierControllerTests
{
    private static RosteringController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static User Staff(OdipDbContext db, string first, Guid? tenant = null)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenant ?? Guid.Empty, FirstName = first, LastName = "Turner", Username = Guid.NewGuid().ToString(),
            Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    private static Participant Participant(OdipDbContext db, Guid? tenant = null)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenant ?? Guid.Empty, FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static StaffParticipantCompatibility Row(OdipDbContext db, User staff, Participant p, CompatibilityLevel level, int rank, bool autoLinked = false)
    {
        var r = new StaffParticipantCompatibility
        {
            Id = Guid.NewGuid(), TenantId = p.TenantId, UserId = staff.Id, ParticipantId = p.Id, Level = level, Rank = rank, AutoLinked = autoLinked,
        };
        db.StaffParticipantCompatibilities.Add(r);
        db.SaveChanges();
        return r;
    }

    private static async Task<OkObjectResult> Put(OdipDbContext db, Guid staff, Guid participant, CompatibilityLevel level, int? rank = null, string? reason = null)
    {
        var result = await Controller(db).UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = staff, ParticipantId = participant, Level = level, Rank = rank, Reason = reason }, CancellationToken.None);
        return Assert.IsType<OkObjectResult>(result.Result);
    }

    private static async Task<Dictionary<Guid, int>> Ranks(OdipDbContext db, Guid participant, CompatibilityLevel level) =>
        await db.StaffParticipantCompatibilities.AsNoTracking().Where(c => c.ParticipantId == participant && c.Level == level).ToDictionaryAsync(c => c.UserId, c => c.Rank);

    [Fact]
    public async Task UpsertWithRank_MovesTheRowAndRenumbersTheTierOneToN()
    {
        using var db = TestDb.Create();
        var (a, b, c) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1); Row(db, b, p, CompatibilityLevel.Backup, 2); Row(db, c, p, CompatibilityLevel.Backup, 3);

        await Put(db, c.Id, p.Id, CompatibilityLevel.Backup, rank: 1);

        var ranks = await Ranks(db, p.Id, CompatibilityLevel.Backup);
        Assert.Equal(1, ranks[c.Id]); Assert.Equal(2, ranks[a.Id]); Assert.Equal(3, ranks[b.Id]);
    }

    [Fact]
    public async Task UpsertWithRankPastTheEnd_IsClampedToLast()
    {
        using var db = TestDb.Create();
        var (a, b) = (Staff(db, "Aa"), Staff(db, "Bb"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1); Row(db, b, p, CompatibilityLevel.Backup, 2);

        await Put(db, a.Id, p.Id, CompatibilityLevel.Backup, rank: 99);

        var ranks = await Ranks(db, p.Id, CompatibilityLevel.Backup);
        Assert.Equal(2, ranks[a.Id]); Assert.Equal(1, ranks[b.Id]);
    }

    [Fact]
    public async Task TierChange_AppendsToTheNewTier_AndClosesTheGapInTheOld()
    {
        using var db = TestDb.Create();
        var (a, b, c, d) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"), Staff(db, "Dd"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1); Row(db, b, p, CompatibilityLevel.Backup, 2); Row(db, c, p, CompatibilityLevel.Backup, 3);
        Row(db, d, p, CompatibilityLevel.Emergency, 1);

        await Put(db, a.Id, p.Id, CompatibilityLevel.Emergency);

        var backup = await Ranks(db, p.Id, CompatibilityLevel.Backup);
        Assert.Equal(1, backup[b.Id]); Assert.Equal(2, backup[c.Id]);
        var emergency = await Ranks(db, p.Id, CompatibilityLevel.Emergency);
        Assert.Equal(1, emergency[d.Id]); Assert.Equal(2, emergency[a.Id]);
    }

    [Fact]
    public async Task NewRowWithoutRank_GoesLast()
    {
        using var db = TestDb.Create();
        var (a, b) = (Staff(db, "Aa"), Staff(db, "Bb"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1);

        await Put(db, b.Id, p.Id, CompatibilityLevel.Backup);

        Assert.Equal(2, (await Ranks(db, p.Id, CompatibilityLevel.Backup))[b.Id]);
    }

    [Fact]
    public async Task ReasonOnlyEdit_DoesNotMoveTheRow()
    {
        using var db = TestDb.Create();
        var (a, b, c) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1); Row(db, b, p, CompatibilityLevel.Backup, 2); Row(db, c, p, CompatibilityLevel.Backup, 3);

        await Put(db, b.Id, p.Id, CompatibilityLevel.Backup, reason: "Knows the house");

        var ranks = await Ranks(db, p.Id, CompatibilityLevel.Backup);
        Assert.Equal(1, ranks[a.Id]); Assert.Equal(2, ranks[b.Id]); Assert.Equal(3, ranks[c.Id]);
    }

    [Fact]
    public async Task EveryWriteHealsGapsAndDuplicates_FromTheCurrentOrder()
    {
        using var db = TestDb.Create();
        var (a, b, c, d) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"), Staff(db, "Dd"));
        var p = Participant(db);
        // ranks 1, 1, 2 (a duplicate from a race): Aa and Bb tie and fall to name order.
        Row(db, a, p, CompatibilityLevel.Preferred, 1); Row(db, b, p, CompatibilityLevel.Preferred, 1); Row(db, c, p, CompatibilityLevel.Preferred, 2);
        Row(db, d, p, CompatibilityLevel.Backup, 1);

        await Put(db, d.Id, p.Id, CompatibilityLevel.Preferred);

        var ranks = await Ranks(db, p.Id, CompatibilityLevel.Preferred);
        Assert.Equal(1, ranks[a.Id]); Assert.Equal(2, ranks[b.Id]); Assert.Equal(3, ranks[c.Id]); Assert.Equal(4, ranks[d.Id]);
    }

    [Fact]
    public async Task AllowedAndExcluded_ForceRankZero_AndLeavingATierClosesIt()
    {
        using var db = TestDb.Create();
        var (a, b, c) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Backup, 1); Row(db, b, p, CompatibilityLevel.Backup, 2); Row(db, c, p, CompatibilityLevel.Backup, 3);

        await Put(db, a.Id, p.Id, CompatibilityLevel.Excluded, rank: 5, reason: "Concern");
        await Put(db, b.Id, p.Id, CompatibilityLevel.Allowed, rank: 2);

        var all = await db.StaffParticipantCompatibilities.AsNoTracking().ToDictionaryAsync(r => r.UserId);
        Assert.Equal(0, all[a.Id].Rank); Assert.Equal(0, all[b.Id].Rank); Assert.Equal(1, all[c.Id].Rank);
    }

    [Fact]
    public async Task RankBelowOne_Returns400()
    {
        using var db = TestDb.Create();
        var a = Staff(db, "Aa");
        var p = Participant(db);

        var result = await Controller(db).UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = a.Id, ParticipantId = p.Id, Level = CompatibilityLevel.Backup, Rank = 0 }, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(new[] { "Rank must be 1 or more." }, Assert.IsType<ApiResponse<CompatibilityRowDto>>(bad.Value).Errors);
        Assert.Empty(await db.StaffParticipantCompatibilities.ToListAsync());
    }

    [Fact]
    public async Task MovingThePickedPreferredToBackup_ClearsThePick_AndRenumbersPreferred()
    {
        using var db = TestDb.Create();
        var (a, b) = (Staff(db, "Aa"), Staff(db, "Bb"));
        var p = Participant(db);
        p.PreferredUserId = a.Id;
        db.SaveChanges();
        Row(db, a, p, CompatibilityLevel.Preferred, 1); Row(db, b, p, CompatibilityLevel.Preferred, 2);

        await Put(db, a.Id, p.Id, CompatibilityLevel.Backup);

        Assert.Null((await db.Participants.AsNoTracking().SingleAsync(x => x.Id == p.Id)).PreferredUserId);
        Assert.Equal(1, (await Ranks(db, p.Id, CompatibilityLevel.Preferred))[b.Id]);
        Assert.Equal(1, (await Ranks(db, p.Id, CompatibilityLevel.Backup))[a.Id]);
    }

    [Fact]
    public async Task Get_ForAParticipant_ReturnsCompatibilityOrder_AndTheRank()
    {
        using var db = TestDb.Create();
        var (ex, un, em, ba, p1, p2) = (Staff(db, "Ex"), Staff(db, "Un"), Staff(db, "Em"), Staff(db, "Ba"), Staff(db, "P1"), Staff(db, "P2"));
        var p = Participant(db);
        Row(db, ex, p, CompatibilityLevel.Excluded, 0); Row(db, un, p, CompatibilityLevel.Allowed, 0); Row(db, em, p, CompatibilityLevel.Emergency, 1);
        Row(db, ba, p, CompatibilityLevel.Backup, 1); Row(db, p2, p, CompatibilityLevel.Preferred, 2); Row(db, p1, p, CompatibilityLevel.Preferred, 1);

        var result = await Controller(db).GetCompatibility(p.Id, CancellationToken.None);

        var rows = Assert.IsType<ApiResponse<List<CompatibilityRowDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { p1.Id, p2.Id, ba.Id, em.Id, un.Id, ex.Id }, rows.Select(r => r.StaffId));
        Assert.Equal(new[] { 1, 2, 1, 1, 0, 0 }, rows.Select(r => r.Rank));
    }

    [Fact]
    public async Task Get_WithoutAParticipant_OrdersByParticipantThenByTheOrder()
    {
        using var db = TestDb.Create();
        var (a, b) = (Staff(db, "Aa"), Staff(db, "Bb"));
        var pz = new Participant { Id = Guid.NewGuid(), FirstName = "Zoe", LastName = "Zed", IsActive = true };
        var pa = new Participant { Id = Guid.NewGuid(), FirstName = "Abe", LastName = "Ant", IsActive = true };
        db.Participants.AddRange(pz, pa);
        db.SaveChanges();
        Row(db, a, pz, CompatibilityLevel.Backup, 1); Row(db, b, pz, CompatibilityLevel.Preferred, 1);
        Row(db, a, pa, CompatibilityLevel.Excluded, 0); Row(db, b, pa, CompatibilityLevel.Emergency, 1);

        var result = await Controller(db).GetCompatibility(null, CancellationToken.None);

        var rows = Assert.IsType<ApiResponse<List<CompatibilityRowDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { (pa.Id, b.Id), (pa.Id, a.Id), (pz.Id, b.Id), (pz.Id, a.Id) }, rows.Select(r => (r.ParticipantId, r.StaffId)));
    }

    [Fact]
    public async Task Reorder_InTenantA_LeavesTenantBsRowsForTheSameStaffAndParticipantNamesUntouched()
    {
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        var name = Guid.NewGuid().ToString();
        using var seed = TestDb.Create(name);
        var (a1, a2, b1, b2) = (Staff(seed, "Aa", tenantA), Staff(seed, "Bb", tenantA), Staff(seed, "Aa", tenantB), Staff(seed, "Bb", tenantB));
        var (pa, pb) = (Participant(seed, tenantA), Participant(seed, tenantB));
        Row(seed, a1, pa, CompatibilityLevel.Backup, 1); Row(seed, a2, pa, CompatibilityLevel.Backup, 2);
        Row(seed, b1, pb, CompatibilityLevel.Backup, 1); Row(seed, b2, pb, CompatibilityLevel.Backup, 2);

        using (var asA = TestDb.ForTenant(name, tenantA))
            await Put(asA, a2.Id, pa.Id, CompatibilityLevel.Backup, rank: 1);

        var all = await seed.StaffParticipantCompatibilities.AsNoTracking().IgnoreQueryFilters().ToListAsync();
        Assert.Equal(2, all.Single(r => r.UserId == a1.Id).Rank);
        Assert.Equal(1, all.Single(r => r.UserId == a2.Id).Rank);
        Assert.Equal(1, all.Single(r => r.UserId == b1.Id).Rank);
        Assert.Equal(2, all.Single(r => r.UserId == b2.Id).Rank);
    }

    [Fact]
    public async Task Reorder_WithAStaffIdFromAnotherTenant_Is400_AndChangesNothing()
    {
        var (tenantA, tenantB) = (Guid.NewGuid(), Guid.NewGuid());
        var name = Guid.NewGuid().ToString();
        using var seed = TestDb.Create(name);
        var (a1, b1) = (Staff(seed, "Aa", tenantA), Staff(seed, "Bb", tenantB));
        var pa = Participant(seed, tenantA);
        Row(seed, a1, pa, CompatibilityLevel.Backup, 1);

        using var asA = TestDb.ForTenant(name, tenantA);
        var result = await Controller(asA).UpsertCompatibility(
            new UpsertCompatibilityDto { StaffId = b1.Id, ParticipantId = pa.Id, Level = CompatibilityLevel.Backup, Rank = 1 }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(1, await seed.StaffParticipantCompatibilities.IgnoreQueryFilters().CountAsync());
        Assert.Equal(1, (await seed.StaffParticipantCompatibilities.AsNoTracking().SingleAsync()).Rank);
    }

    // ── StaffCompatibilityLinkService ─────────────────────────────────────

    [Fact]
    public async Task LinkService_CreatesTheAutoLinkedPreferredRow_AtTheEndOfPreferred()
    {
        using var db = TestDb.Create();
        var (a, b) = (Staff(db, "Aa"), Staff(db, "Bb"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Preferred, 1);

        await new StaffCompatibilityLinkService(db).SyncFromParticipantPreferredStaffAsync(p.Id, null, b.Id, CancellationToken.None);
        await db.SaveChangesAsync();

        var row = await db.StaffParticipantCompatibilities.AsNoTracking().SingleAsync(r => r.UserId == b.Id);
        Assert.True(row.AutoLinked);
        Assert.Equal(2, row.Rank);
    }

    [Fact]
    public async Task LinkService_DeletingTheAutoLinkedPreferredRow_RenumbersPreferred_InTheSameSave()
    {
        using var db = TestDb.Create();
        var (a, b, c) = (Staff(db, "Aa"), Staff(db, "Bb"), Staff(db, "Cc"));
        var p = Participant(db);
        Row(db, a, p, CompatibilityLevel.Preferred, 1); Row(db, b, p, CompatibilityLevel.Preferred, 2, autoLinked: true); Row(db, c, p, CompatibilityLevel.Preferred, 3);

        await new StaffCompatibilityLinkService(db).SyncFromParticipantPreferredStaffAsync(p.Id, b.Id, null, CancellationToken.None);
        await db.SaveChangesAsync();

        var ranks = await Ranks(db, p.Id, CompatibilityLevel.Preferred);
        Assert.Equal(2, ranks.Count);
        Assert.Equal(1, ranks[a.Id]); Assert.Equal(2, ranks[c.Id]);
    }
}
