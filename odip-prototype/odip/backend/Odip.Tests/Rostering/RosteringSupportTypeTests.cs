using Microsoft.AspNetCore.Authorization;
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

/// <summary>Shift billing PR2: the support type on shifts and patterns (validation, the pattern cascade, the claimed-shift lock, tenants, roles).</summary>
public class RosteringSupportTypeTests
{
    private const string Good = "GRP_GOOD", Ambiguous = "GRP_AMBIGUOUS", NoHourly = "GRP_NO_HOURLY";
    private static readonly DateOnly Monday = new(2026, 10, 12), Today = new(2026, 10, 10);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 10, 10, 2, 0, 0, TimeSpan.Zero));

    private static RosteringController Controller(OdipDbContext db) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock);

    private static SupportCatalogueItem Item(OdipDbContext db, SupportActivityGroup group, string number, string unit = "H", ClaimDayType dayType = ClaimDayType.Weekday) =>
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = group.Id, ItemNumber = number, Description = number, DayType = dayType, IsIntensive = false, Unit = unit,
            PriceLimit_VIC = 50m, PriceLimit_NSW = 50m, PriceLimit_ACT = 50m, PriceLimit_NT = 50m, PriceLimit_QLD = 50m, PriceLimit_SA = 50m, PriceLimit_TAS = 50m, PriceLimit_WA = 50m,
            PriceLimit_Remote = 50m, PriceLimit_VeryRemote = 50m, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true,
        }).Entity;

    /// <summary>The catalogue every case reads: one clean hourly group, one whose Weekday has two hourly rows, one with no hourly row.</summary>
    private static void SeedCatalogue(OdipDbContext db)
    {
        SupportActivityGroup Group(string code) => db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = code, DisplayName = code, SupportCategory = 4 }).Entity;
        Item(db, Group(Good), "G_WD");
        var amb = Group(Ambiguous);
        Item(db, amb, "A_WD1"); Item(db, amb, "A_WD2");
        Item(db, Group(NoHourly), "N_EA", unit: "EA");
        db.SaveChanges();
    }

    private static Participant Person(OdipDbContext db, Guid? tenantId = null)
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true, IsDraft = false, IntakeCompletedAt = DateTime.UtcNow.AddMonths(-6) };
        if (tenantId is { } t) p.TenantId = t;
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static Guid TenantOf(OdipDbContext db, Guid participantId) => db.Participants.IgnoreQueryFilters().Where(p => p.Id == participantId).Select(p => p.TenantId).Single();

    private static Shift SavedShift(OdipDbContext db, Guid participantId, string? code = null, ShiftStatus status = ShiftStatus.Draft, Guid? patternId = null, DateOnly? date = null)
    {
        var s = new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantOf(db, participantId), ParticipantId = participantId, ServiceDate = date ?? Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status, SupportGroupCode = code, ShiftPatternId = patternId,
        };
        db.Shifts.Add(s);
        db.SaveChanges();
        return s;
    }

    private static ShiftPattern SavedPattern(OdipDbContext db, Guid participantId, string? code = null)
    {
        var p = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = TenantOf(db, participantId), ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = new DateOnly(2026, 12, 31), IsActive = true, SupportGroupCode = code,
        };
        db.ShiftPatterns.Add(p);
        db.SaveChanges();
        return p;
    }

    private static CreateShiftDto CreateShiftBody(Guid participantId, string? code, bool send = true) => send
        ? new() { ParticipantId = participantId, ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, SupportGroupCode = code }
        : new() { ParticipantId = participantId, ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None };

    private static UpdateShiftDto UpdateShiftBody(Shift s, string? code, bool send, string? notes = null)
    {
        var dto = send
            ? new UpdateShiftDto { ParticipantId = s.ParticipantId, ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime, Ratio = s.Ratio, NightType = s.NightType, Status = s.Status, Notes = notes, SupportGroupCode = code }
            : new UpdateShiftDto { ParticipantId = s.ParticipantId, ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime, Ratio = s.Ratio, NightType = s.NightType, Status = s.Status, Notes = notes };
        return dto;
    }

    private static CreateShiftPatternDto CreatePatternBody(Guid participantId, string? code) => new()
    {
        ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        EffectiveFrom = new DateOnly(2026, 10, 12), EffectiveTo = new DateOnly(2026, 12, 31), IsActive = true, SupportGroupCode = code,
    };

    private static UpdateShiftPatternDto UpdatePatternBody(ShiftPattern p, string? code, bool send) => send
        ? new() { ParticipantId = p.ParticipantId, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, IsActive = true, SupportGroupCode = code }
        : new() { ParticipantId = p.ParticipantId, DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo, IsActive = true };

    private static string Refusal<T>(ActionResult<ApiResponse<T>> result, int status)
    {
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, obj.StatusCode);
        return string.Join(" ", Assert.IsType<ApiResponse<T>>(obj.Value).Errors ?? new List<string>());
    }

    // ── Validation (T6) ──────────────────────────────────────────────

    [Fact]
    public async Task CreateShift_SavesAGoodType_AndRefusesUnknownNoRateAndAmbiguousOnes()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);

        var ok = await Controller(db).CreateShift(CreateShiftBody(p.Id, Good), default);
        Assert.Equal(Good, Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(ok.Result).Value).Data!.SupportGroupCode);
        Assert.Equal(Good, (await db.Shifts.SingleAsync()).SupportGroupCode);

        Assert.Equal(SupportTypeCheck.UnknownMessage, Refusal(await Controller(db).CreateShift(CreateShiftBody(p.Id, "GRP_NOPE"), default), 400));
        Assert.Contains("has no hourly rate on", Refusal(await Controller(db).CreateShift(CreateShiftBody(p.Id, NoHourly), default), 400));
        Assert.Equal(SupportTypeCheck.AmbiguousMessage, Refusal(await Controller(db).CreateShift(CreateShiftBody(p.Id, Ambiguous), default), 400));
        Assert.Single(await db.Shifts.ToListAsync());   // nothing else was saved
    }

    [Fact]
    public async Task CreateShift_WithNoType_StoresNull()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);

        Assert.IsType<OkObjectResult>((await Controller(db).CreateShift(CreateShiftBody(p.Id, null, send: false), default)).Result);

        Assert.Null((await db.Shifts.SingleAsync()).SupportGroupCode);
    }

    [Fact]
    public async Task Patterns_SaveAGoodType_AndRefuseTheBadOnes_OnCreateAndUpdate()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);

        var created = await Controller(db).CreatePattern(CreatePatternBody(p.Id, Good), default);
        Assert.Equal(Good, Assert.IsType<ApiResponse<ShiftPatternDto>>(Assert.IsAssignableFrom<ObjectResult>(created.Result).Value).Data!.SupportGroupCode);
        Assert.Equal(SupportTypeCheck.UnknownMessage, Refusal(await Controller(db).CreatePattern(CreatePatternBody(p.Id, "GRP_NOPE"), default), 400));
        Assert.Equal(SupportTypeCheck.AmbiguousMessage, Refusal(await Controller(db).CreatePattern(CreatePatternBody(p.Id, Ambiguous), default), 400));

        var existing = await db.ShiftPatterns.SingleAsync();
        Assert.Contains("has no hourly rate on", Refusal(await Controller(db).UpdatePattern(existing.Id, UpdatePatternBody(existing, NoHourly, send: true), default), 400));
        Assert.Equal(SupportTypeCheck.AmbiguousMessage, Refusal(await Controller(db).UpdatePattern(existing.Id, UpdatePatternBody(existing, Ambiguous, send: true), default), 400));
        Assert.Equal(Good, (await db.ShiftPatterns.AsNoTracking().SingleAsync()).SupportGroupCode);   // refused updates changed nothing
    }

    [Fact]
    public async Task UpdateShift_RefusesABadType_AndAnAmbiguousOne()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var shift = SavedShift(db, p.Id);

        Assert.Equal(SupportTypeCheck.AmbiguousMessage, Refusal(await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, Ambiguous, send: true), default), 400));
        Assert.Equal(SupportTypeCheck.UnknownMessage, Refusal(await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, "GRP_NOPE", send: true), default), 400));
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
    }

    // ── Omitted field keeps the stored one (T11) ─────────────────────

    [Fact]
    public async Task APutThatLeavesTheTypeOut_KeepsTheStoredOne_AndAnExplicitNullClearsIt()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var shift = SavedShift(db, p.Id, Good);
        var pattern = SavedPattern(db, p.Id, Good);

        Assert.IsType<OkObjectResult>((await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, null, send: false, notes: "bring the kit"), default)).Result);
        Assert.IsType<OkObjectResult>((await Controller(db).UpdatePattern(pattern.Id, UpdatePatternBody(pattern, null, send: false), default)).Result);
        Assert.Equal(Good, (await db.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
        Assert.Equal(Good, (await db.ShiftPatterns.AsNoTracking().SingleAsync()).SupportGroupCode);

        Assert.IsType<OkObjectResult>((await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, null, send: true), default)).Result);
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
    }

    // ── The claimed-shift lock (T7) ──────────────────────────────────

    private static void ClaimShift(OdipDbContext db, Shift shift, TripClaimStatus claimStatus = TripClaimStatus.Draft, ClaimLineItemStatus lineStatus = ClaimLineItemStatus.Draft)
    {
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = shift.ParticipantId, Status = claimStatus, ClaimReference = "CLM-LOCK01" };
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "G_WD", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = shift.ServiceDate,
            SupportsDeliveredTo = shift.ServiceDate, Hours = 4m, UnitPrice = 50m, TotalAmount = 200m, GSTCode = GSTCode.P2, Status = lineStatus,
        });
        db.SaveChanges();
    }

    [Fact]
    public async Task AClaimedShift_RefusesATypeChange_WithTheClaimReference_ButStillSavesNotes()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var shift = SavedShift(db, p.Id, Good, ShiftStatus.Completed);
        ClaimShift(db, shift);

        var message = Refusal(await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, null, send: true), default), 409);
        Assert.Contains("CLM-LOCK01", message);
        Assert.Equal(Good, (await db.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);

        // Notes, and the same type sent back, are not a change.
        var notes = await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, Good, send: true, notes: "late arrival"), default);
        Assert.IsType<OkObjectResult>(notes.Result);
        Assert.Equal("late arrival", (await db.Shifts.AsNoTracking().SingleAsync()).Notes);
    }

    [Fact]
    public async Task ARejectedClaimsShift_CanChangeItsType()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var shift = SavedShift(db, p.Id, Good, ShiftStatus.Completed);
        ClaimShift(db, shift, TripClaimStatus.Rejected, ClaimLineItemStatus.Rejected);

        Assert.IsType<OkObjectResult>((await Controller(db).UpdateShift(shift.Id, UpdateShiftBody(shift, null, send: true), default)).Result);
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
    }

    // ── The pattern cascade (T10) ────────────────────────────────────

    [Fact]
    public async Task ChangingAPatternsType_UpdatesItsUpcomingUnclaimedShifts_AndLeavesTheRest()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var pattern = SavedPattern(db, p.Id, null);
        var upcoming = SavedShift(db, p.Id, null, ShiftStatus.Published, pattern.Id, Today.AddDays(2));
        var own = SavedShift(db, p.Id, "GRP_OWN", ShiftStatus.Draft, pattern.Id, Today.AddDays(9));      // given its own type by hand
        var past = SavedShift(db, p.Id, null, ShiftStatus.Completed, pattern.Id, Today.AddDays(-7));
        var started = SavedShift(db, p.Id, null, ShiftStatus.InProgress, pattern.Id, Today.AddDays(1));
        var other = SavedShift(db, p.Id, null, ShiftStatus.Draft, null, Today.AddDays(3));               // no pattern

        Assert.IsType<OkObjectResult>((await Controller(db).UpdatePattern(pattern.Id, UpdatePatternBody(pattern, Good, send: true), default)).Result);

        var codes = await db.Shifts.AsNoTracking().ToDictionaryAsync(s => s.Id, s => s.SupportGroupCode);
        Assert.Equal(Good, codes[upcoming.Id]);
        Assert.Equal("GRP_OWN", codes[own.Id]);
        Assert.Null(codes[past.Id]);
        Assert.Null(codes[started.Id]);
        Assert.Null(codes[other.Id]);
    }

    [Fact]
    public async Task CopiesPatternSupportType()
    {
        using var db = TestDb.Create();
        SeedCatalogue(db);
        var p = Person(db);
        var pattern = SavedPattern(db, p.Id, Good);

        await new RosterShiftGenerator().GenerateAsync(db, p.Id, new[] { pattern.Id }, Monday, Monday.AddDays(13), default);

        var made = await db.Shifts.AsNoTracking().ToListAsync();
        Assert.NotEmpty(made);
        Assert.All(made, s => Assert.Equal(Good, s.SupportGroupCode));
    }

    // ── Tenants and roles (T8, T9) ───────────────────────────────────

    [Fact]
    public async Task AnotherOrganisation_Gets404_ForBothResources_AndNothingChanges()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        Guid shiftId, patternId;
        using (var seed = TestDb.ForTenant(name, a))
        {
            SeedCatalogue(seed);
            var p = Person(seed, a);
            shiftId = SavedShift(seed, p.Id, "GRP_A").Id;
            patternId = SavedPattern(seed, p.Id, "GRP_A").Id;
        }

        using var other = TestDb.ForTenant(name, b);
        var shiftBody = new UpdateShiftDto { ParticipantId = Guid.NewGuid(), ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, SupportGroupCode = Good };
        var patternBody = new UpdateShiftPatternDto { ParticipantId = Guid.NewGuid(), DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true, SupportGroupCode = Good };
        Assert.IsType<NotFoundObjectResult>((await Controller(other).UpdateShift(shiftId, shiftBody, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(other).UpdatePattern(patternId, patternBody, default)).Result);

        using var check = TestDb.ForTenant(name, a);
        Assert.Equal("GRP_A", (await check.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
        Assert.Equal("GRP_A", (await check.ShiftPatterns.AsNoTracking().SingleAsync()).SupportGroupCode);
    }

    [Fact]
    public async Task ThePatternCascade_StaysInsideTheOrganisation()
    {
        var name = Guid.NewGuid().ToString();
        Guid a = Guid.NewGuid(), b = Guid.NewGuid();
        Guid patternA;
        using (var seed = TestDb.ForTenant(name, a))
        {
            SeedCatalogue(seed);
            var pa = Person(seed, a);
            var pattern = SavedPattern(seed, pa.Id, null);
            patternA = pattern.Id;
            SavedShift(seed, pa.Id, null, ShiftStatus.Draft, pattern.Id, Today.AddDays(2));
        }
        using (var seedB = TestDb.ForTenant(name, b))
        {
            var pb = Person(seedB, b);
            SavedShift(seedB, pb.Id, null, ShiftStatus.Draft, patternA, Today.AddDays(2));   // an organisation B shift that (wrongly) points at A's pattern
        }

        using (var asA = TestDb.ForTenant(name, a))
        {
            var pattern = await asA.ShiftPatterns.SingleAsync();
            Assert.IsType<OkObjectResult>((await Controller(asA).UpdatePattern(patternA, UpdatePatternBody(pattern, Good, send: true), default)).Result);
        }

        using var asB = TestDb.ForTenant(name, b);
        Assert.Null((await asB.Shifts.AsNoTracking().SingleAsync()).SupportGroupCode);
    }

    [Fact]
    public void OnlyCoordinatorsAndAdmins_MayUseTheRosteringEndpoints()
    {
        var roles = typeof(RosteringController).GetCustomAttributes(typeof(AuthorizeAttribute), true).Cast<AuthorizeAttribute>().Single().Roles!.Split(',');
        Assert.Equal(new[] { "Admin", "Coordinator", "SuperAdmin" }, roles.OrderBy(r => r).ToArray());
        Assert.DoesNotContain("SupportWorker", roles);
    }
}
