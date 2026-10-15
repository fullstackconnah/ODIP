using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
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

/// <summary>
/// The participant board's agreement and leave fields (spec 2026-10-15, roster agreed shifts) on EF InMemory. pendingAgreements lists every participant whose newest revision
/// waits for an approval for rostering (not approved, made from blocks, not ended), whether or not they have a row. Also tested: a row's notReadyForRostering, and the week's
/// staffLeave. Every read is the caller's organisation only. The query on Npgsql is in RosterBoardAgreedPostgresTests.
/// </summary>
public class RosterBoardAgreedTests
{
    // A Monday: the week is 2026-08-24 to 2026-08-30. The provider's today is 2026-08-20 in every Australian zone.
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    // Program.cs's JSON: camelCase, enums as strings, nulls left out (as RosteringControllerTests.ApiJsonOptions).
    private static readonly JsonSerializerOptions ApiJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Reads the board as a non-SuperAdmin of <paramref name="caller"/>'s organisation. Tests seed through a SuperAdmin context, where rows keep the TenantId they are given.</summary>
    private static async Task<RosterBoardDto> BoardAsync(string dbName, Guid caller, string groupBy = "participant")
    {
        using var db = TestDb.ForTenant(dbName, caller);
        var result = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock).GetBoard(Monday, groupBy, default);
        return Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static Participant Person(OdipDbContext db, Guid tenantId, string first = "Mia", bool isActive = true, bool isDraft = false) =>
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = "Chen", IsActive = isActive, IsDraft = isDraft }).Entity;

    private static PendingAgreementDto Waiting(Guid participantId, string name, Guid draftId, int version, bool canReceiveServices = true) =>
        new() { ParticipantId = participantId, DisplayName = name, DraftId = draftId, Version = version, CanReceiveServices = canReceiveServices };
    private static User Worker(OdipDbContext db, Guid tenantId, string first) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    /// <summary>A revision as saving it from blocks stores it (blocks, answer and lines), or a hand-typed one. It runs from 2026-07-06 to <paramref name="end"/>.</summary>
    private static ServiceAgreementDraft Revision(OdipDbContext db, Guid tenantId, Guid participantId, int version, bool handTyped = false, DateOnly? end = null) =>
        db.ServiceAgreementDrafts.Add(ApprovalTestSupport.BuildRevision(tenantId, participantId, version, new[] { ApprovalTestSupport.WeekdayBlock() },
            start: new DateOnly(2026, 7, 6), end: end ?? new DateOnly(2026, 12, 20), handTyped: handTyped)).Entity;

    private static void Approve(OdipDbContext db, Guid tenantId, ServiceAgreementDraft draft) => db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
    {
        Id = Guid.NewGuid(), TenantId = tenantId, DraftId = draft.Id, ParticipantId = draft.ParticipantId, DraftVersion = draft.Version,
        ApprovedAt = new DateTime(2026, 8, 19, 0, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex Admin",
    });

    private static void Leave(OdipDbContext db, Guid tenantId, Guid userId, LeaveStatus status, DateOnly from, DateOnly to) => db.LeaveRequests.Add(new LeaveRequest
    {
        Id = Guid.NewGuid(), TenantId = tenantId, UserId = userId, LeaveType = LeaveType.Annual, StartDate = from, EndDate = to, Status = status,
        RequestedByUserId = userId, RequestedAt = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
    });

    private static RosterParticipantRowDto Row(RosterBoardDto board, Guid participantId) => board.ParticipantRows!.Single(r => r.ParticipantId == participantId);

    // ── pendingAgreements ──

    [Fact]
    public async Task PendingAgreements_ListTheNewestRevision_WhenItWaitsForApproval()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid miaId, v2Id;
        using (var db = TestDb.Create(dbName))
        {
            var mia = Person(db, TenantA);
            Person(db, TenantA, "Jo");   // no revision at all
            Approve(db, TenantA, Revision(db, TenantA, mia.Id, 1));
            v2Id = Revision(db, TenantA, mia.Id, 2).Id;
            await db.SaveChangesAsync();
            miaId = mia.Id;
        }

        Assert.Equal(new[] { Waiting(miaId, "Mia Chen", v2Id, 2) }, (await BoardAsync(dbName, TenantA)).PendingAgreements!);
    }

    [Fact]
    public async Task PendingAgreements_LeaveOutANewestThatIsApproved_EvenWithAnOlderOneWaiting()   // Review Focus 3
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            var mia = Person(db, TenantA);
            Revision(db, TenantA, mia.Id, 1);                          // never approved, and superseded
            Approve(db, TenantA, Revision(db, TenantA, mia.Id, 2));
            await db.SaveChangesAsync();
        }

        Assert.Empty((await BoardAsync(dbName, TenantA)).PendingAgreements!);
    }

    [Fact]
    public async Task PendingAgreements_LeaveOutAHandTypedNewest()   // nothing to make patterns from: approving refuses it as HandTyped
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Revision(db, TenantA, Person(db, TenantA).Id, 1, handTyped: true);
            await db.SaveChangesAsync();
        }

        Assert.Empty((await BoardAsync(dbName, TenantA)).PendingAgreements!);
    }

    [Theory]
    [InlineData("null")]       // the JSON literal null
    [InlineData("  ")]         // whitespace
    [InlineData("{not json")]  // unreadable: the approval service reads all of these as no stored answer
    public async Task PendingAgreements_LeaveOutAStoredAnswerApprovalCannotRead(string pricingJson)
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Revision(db, TenantA, Person(db, TenantA).Id, 1).PricingJson = pricingJson;
            await db.SaveChangesAsync();
        }

        Assert.Empty((await BoardAsync(dbName, TenantA)).PendingAgreements!);
    }

    [Theory]
    [InlineData(2026, 8, 19, false)]   // ended yesterday on the provider's calendar
    [InlineData(2026, 8, 20, true)]    // ends today: still waits
    public async Task PendingAgreements_EndOnTheProvidersCalendar(int year, int month, int day, bool waits)
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Revision(db, TenantA, Person(db, TenantA).Id, 1, end: new DateOnly(year, month, day));
            await db.SaveChangesAsync();
        }

        Assert.Equal(waits, (await BoardAsync(dbName, TenantA)).PendingAgreements!.Count == 1);
    }

    [Fact]
    public async Task PendingAgreements_ListAParticipantWhoIsNotActiveYet_ButNotAnArchivedOne()   // Review Focus 4: live 2026-10-15, the one waiting draft had no row
    {
        var dbName = Guid.NewGuid().ToString();
        Guid kimId, v1Id;
        using (var db = TestDb.Create(dbName))
        {
            var kim = Person(db, TenantA, "Kim", isActive: false, isDraft: true);   // still in onboarding, services not started: no board row
            var ola = Person(db, TenantA, "Ola", isActive: false);                  // archived: "not active yet" would be untrue
            v1Id = Revision(db, TenantA, kim.Id, 1).Id;
            Revision(db, TenantA, ola.Id, 1);
            await db.SaveChangesAsync();
            kimId = kim.Id;
        }

        var board = await BoardAsync(dbName, TenantA);

        Assert.Equal(new[] { Waiting(kimId, "Kim Chen", v1Id, 1, canReceiveServices: false) }, board.PendingAgreements!);
        Assert.DoesNotContain(board.ParticipantRows!, r => r.ParticipantId == kimId);
    }

    [Fact]
    public async Task PendingAgreements_ReadOnlyTheCallersOrganisation()   // cross-tenant (repo CLAUDE.md, Testing)
    {
        var dbName = Guid.NewGuid().ToString();
        Guid miaId, v1Id;
        using (var db = TestDb.Create(dbName))
        {
            var mia = Person(db, TenantA);
            var v1 = Revision(db, TenantA, mia.Id, 1);
            // Rows of another organisation that name Mia: a newer revision, and an approval of her v1. Neither is the caller's, so neither counts.
            Revision(db, TenantB, mia.Id, 2);
            Approve(db, TenantB, v1);
            // Another organisation's own participant, with a revision waiting, active or still a draft: never listed here.
            Revision(db, TenantB, Person(db, TenantB, "Ola").Id, 1);
            Revision(db, TenantB, Person(db, TenantB, "Ivy", isActive: false, isDraft: true).Id, 1);
            await db.SaveChangesAsync();
            (miaId, v1Id) = (mia.Id, v1.Id);
        }

        Assert.Equal(new[] { Waiting(miaId, "Mia Chen", v1Id, 1) }, (await BoardAsync(dbName, TenantA)).PendingAgreements!);
    }
    // ── notReadyForRostering ──

    [Theory]   // Review Focus 5: Enforce closes the gate for everyone while the agreement template is an UnapprovedDraft
    [InlineData(ParticipantReadinessMode.Enforce, true)]
    [InlineData(ParticipantReadinessMode.Warn, false)]
    public async Task NotReadyForRostering_FollowsTheOrganisationsReadinessMode(ParticipantReadinessMode mode, bool notReady)
    {
        var dbName = Guid.NewGuid().ToString();
        Guid miaId;
        using (var db = TestDb.Create(dbName))
        {
            miaId = Person(db, TenantA).Id;
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantReadinessMode = mode });
            await db.SaveChangesAsync();
        }

        Assert.Equal(notReady, Row(await BoardAsync(dbName, TenantA), miaId).NotReadyForRostering);
    }

    // ── staffLeave ──

    [Fact]
    public async Task StaffLeave_ListsTheWeeksApprovedAndPendingLeave()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid samId, alexId;
        using (var db = TestDb.Create(dbName))
        {
            Person(db, TenantA);
            var sam = Worker(db, TenantA, "Sam");
            var alex = Worker(db, TenantA, "Alex");
            var jo = Worker(db, TenantA, "Jo");
            Leave(db, TenantA, sam.Id, LeaveStatus.Approved, new DateOnly(2026, 8, 21), Monday.AddDays(1));   // began before the week: sent whole, not clipped
            Leave(db, TenantA, alex.Id, LeaveStatus.Pending, Monday.AddDays(2), Monday.AddDays(2));
            Leave(db, TenantA, jo.Id, LeaveStatus.Declined, Monday, Monday);
            Leave(db, TenantA, jo.Id, LeaveStatus.Cancelled, Monday.AddDays(3), Monday.AddDays(3));
            Leave(db, TenantA, jo.Id, LeaveStatus.Approved, Monday.AddDays(7), Monday.AddDays(8));            // next week
            await db.SaveChangesAsync();
            (samId, alexId) = (sam.Id, alex.Id);
        }

        var leave = (await BoardAsync(dbName, TenantA)).StaffLeave!;

        Assert.Equal(
            new[]
            {
                new StaffLeaveDto { StaffId = samId, From = new DateOnly(2026, 8, 21), To = new DateOnly(2026, 8, 25), Status = LeaveStatus.Approved },
                new StaffLeaveDto { StaffId = alexId, From = new DateOnly(2026, 8, 26), To = new DateOnly(2026, 8, 26), Status = LeaveStatus.Pending },
            }.OrderBy(l => l.StaffId),
            leave.OrderBy(l => l.StaffId));
    }

    [Fact]
    public async Task StaffLeaveAndPendingAgreements_AreLeftOutOfTheStaffView()   // its rows carry their own leave bars, and it has no notice
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Leave(db, TenantA, Worker(db, TenantA, "Sam").Id, LeaveStatus.Approved, Monday, Monday);
            Revision(db, TenantA, Person(db, TenantA).Id, 1);
            await db.SaveChangesAsync();
        }

        var board = await BoardAsync(dbName, TenantA, "staff");
        Assert.Null(board.StaffLeave);
        Assert.Null(board.PendingAgreements);
    }

    [Fact]
    public async Task StaffLeave_ReadsOnlyTheCallersOrganisation()   // cross-tenant
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Person(db, TenantA);
            var sam = Worker(db, TenantA, "Sam");
            var ola = Worker(db, TenantB, "Ola");
            Leave(db, TenantB, ola.Id, LeaveStatus.Approved, Monday, Monday);   // another organisation's worker
            Leave(db, TenantB, sam.Id, LeaveStatus.Approved, Monday, Monday);   // another organisation's row that names the caller's worker
            await db.SaveChangesAsync();
        }

        Assert.Empty((await BoardAsync(dbName, TenantA)).StaffLeave!);
    }

    [Fact]
    public async Task TheNewFields_ReachTheJsonAsTheFrontendReadsThem()
    {
        var dbName = Guid.NewGuid().ToString();
        Guid miaId, v1Id, samId;
        using (var db = TestDb.Create(dbName))
        {
            var mia = Person(db, TenantA);
            v1Id = Revision(db, TenantA, mia.Id, 1).Id;
            samId = Worker(db, TenantA, "Sam").Id;
            Leave(db, TenantA, samId, LeaveStatus.Approved, Monday, Monday);
            await db.SaveChangesAsync();
            miaId = mia.Id;
        }

        var json = JsonSerializer.Serialize(await BoardAsync(dbName, TenantA), ApiJson);

        Assert.Contains($"\"pendingAgreements\":[{{\"participantId\":\"{miaId}\",\"displayName\":\"Mia Chen\",\"draftId\":\"{v1Id}\",\"version\":1,\"canReceiveServices\":true}}]", json);
        Assert.Contains("\"notReadyForRostering\":false", json);
        Assert.Contains($"\"staffLeave\":[{{\"staffId\":\"{samId}\",\"from\":\"2026-08-24\",\"to\":\"2026-08-24\",\"status\":\"Approved\"}}]", json);
    }
}
