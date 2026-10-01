using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Fix A (code review round 2, section A): a participant's lifecycle is changed by dedicated endpoints that carry the change and
/// nothing else. Before them, "Change status" sent {isActive} to the full-record PUT (400 "First name is required."), Restore
/// sent the list row back through the same PUT (wiping NDIS number, DOB, gender and the clinical fields), and any full PUT
/// turned a legacy participant whose IntakeCompletedAt is NULL into a draft.
/// </summary>
public class ParticipantStatusEndpointTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    private sealed class Fixture : IDisposable
    {
        public required OdipDbContext Db { get; init; }
        public required ParticipantsController Controller { get; init; }
        public required DefaultHttpContext Http { get; init; }
        public void Dispose() => Db.Dispose();
    }

    /// <summary>One request's worth of plumbing: the audit interceptor sees the same HttpContext the controller does, as in the app.</summary>
    private static Fixture Create(Guid? tenantId = null, string databaseName = "")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Casey Coordinator"), new Claim(ClaimTypes.Role, "Coordinator")],
                "Test")),
        };
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(http);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(string.IsNullOrEmpty(databaseName) ? Guid.NewGuid().ToString() : databaseName)
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
        return new Fixture { Db = db, Controller = controller, Http = http };
    }

    /// <summary>A participant with data in every place a wipe would show: identity, plan, address, clinical, key identifiers.</summary>
    private static Participant RichParticipant(bool isActive = true, bool isDraft = false, DateTime? intakeCompletedAt = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Jamie", LastName = "Smith", PreferredName = "Jay", MiddleName = "Lee",
        DateOfBirth = new DateOnly(1990, 5, 17), Gender = Gender.NonBinary, PlaceOfBirth = "Brisbane", Country = "Australia",
        Phone = "0400123456", Email = "jamie@example.test", NdisNumber = "431234567", PlanType = PlanType.PlanManaged,
        PlanStartDate = new DateOnly(2026, 1, 1), PlanEndDate = new DateOnly(2026, 12, 31), Region = "QLD",
        AddressStreet = "1 Test Street", AddressSuburb = "Brisbane", AddressState = "QLD", AddressPostcode = "4000",
        PrimaryDiagnosis = "Epilepsy", OtherDiagnoses = ["Asthma"], AllergiesDetail = "Peanuts", IsAnaphylaxisRisk = true,
        MedicalSummary = "Synthetic medical summary", MobilityNotes = "Walker outdoors", PensionCardNumber = "P123", MedicareNumber = "M456",
        WeightKg = 70.5m, HeightCm = 172m, Goals = "Swimming", IsHighSupport = true, ServiceStreams = ServiceStreams.Trip,
        IsActive = isActive, IsDraft = isDraft, IntakeCompletedAt = intakeCompletedAt ?? (isDraft ? null : DateTime.UtcNow.AddMonths(-2)),
    };

    /// <summary>Every simple (scalar) property of the participant as text, so a test can prove which ones a call did and did not touch.</summary>
    private static Dictionary<string, string?> Scalars(Participant p) =>
        typeof(Participant).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(pi => pi.CanRead && pi.GetIndexParameters().Length == 0 && IsScalar(pi.PropertyType))
            .ToDictionary(pi => pi.Name, pi => Render(pi.GetValue(p)));

    private static bool IsScalar(Type type)
    {
        var t = Nullable.GetUnderlyingType(type) ?? type;
        return t.IsPrimitive || t.IsEnum || t == typeof(string) || t == typeof(decimal) || t == typeof(DateTime) || t == typeof(DateOnly)
            || t == typeof(Guid) || t == typeof(List<string>);
    }

    private static string? Render(object? value) => value switch
    {
        null => null,
        List<string> list => string.Join("|", list),
        _ => value.ToString(),
    };

    private static T Ok<T>(ActionResult<ApiResponse<T>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<T>>(ok.Value);
        Assert.True(body.Success);
        return body.Data!;
    }

    private static string BadRequest<T>(ActionResult<ApiResponse<T>> result)
    {
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<T>>(bad.Value);
        Assert.False(body.Success);
        return Assert.Single(body.Errors!);
    }

    private static List<AuditLog> UpdatedAuditRows(OdipDbContext db, Guid participantId) =>
        db.AuditLogs.Where(a => a.EntityType == nameof(Participant) && a.EntityId == participantId && a.Action == AuditAction.Updated).ToList();

    private static Dictionary<string, (string? Old, string? New)> Changes(AuditLog row) =>
        JsonDocument.Parse(row.Changes).RootElement.EnumerateArray().ToDictionary(
            e => e.GetProperty("Field").GetString()!,
            e => (e.GetProperty("Old").GetString(), e.GetProperty("New").GetString()));

    // ── POST /participants/{id}/status ─────────────────────────────────────────────────────

    [Fact]
    public async Task ChangeStatus_Deactivate_SetsInactive_WritesOneAuditRow_AndChangesNothingElse()
    {
        using var fx = Create();
        var participant = RichParticipant();
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();
        var before = Scalars(participant);

        var result = Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None));

        Assert.False(result.IsActive);
        Assert.True(result.Changed);
        Assert.Equal(participant.Id, result.Id);
        var saved = await fx.Db.Participants.SingleAsync();
        var after = Scalars(saved);
        var changed = after.Keys.Where(k => before[k] != after[k]).OrderBy(k => k).ToList();
        Assert.Equal(["IsActive", "UpdatedAt"], changed);
        var audit = Assert.Single(UpdatedAuditRows(fx.Db, participant.Id));
        Assert.Equal("Casey Coordinator", audit.ChangedByName);
        Assert.Equal(("True", "False"), Changes(audit)["IsActive"]);
    }

    [Fact]
    public async Task ChangeStatus_Reason_IsRecordedOnTheSameAuditRow_NotAsASecondOne()
    {
        using var fx = Create();
        var participant = RichParticipant();
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = false, Reason = "  Moved interstate  " }, CancellationToken.None));

        var audit = Assert.Single(UpdatedAuditRows(fx.Db, participant.Id));
        var changes = Changes(audit);
        Assert.Equal(("True", "False"), changes["IsActive"]);
        Assert.Equal((null, "Moved interstate"), changes["Reason"]);
    }

    [Fact]
    public async Task ChangeStatus_BlankReason_IsStoredAsNothing()
    {
        using var fx = Create();
        var participant = RichParticipant();
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = false, Reason = "   " }, CancellationToken.None));

        var audit = Assert.Single(UpdatedAuditRows(fx.Db, participant.Id));
        Assert.DoesNotContain("Reason", Changes(audit).Keys);
    }

    [Fact]
    public async Task ChangeStatus_ReactivateNonDraft_Activates_AndWarnsOfReadinessGaps()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, CancellationToken.None));

        Assert.True(result.IsActive);
        Assert.True(result.Changed);
        Assert.True((await fx.Db.Participants.SingleAsync()).IsActive);
        // Warn mode (the default) activates, and what is still missing comes back as non-blocking notes for the screen.
        Assert.Contains(result.Warnings, w => w.Contains(ParticipantReadiness.NoSignedServiceAgreement, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task ChangeStatus_ActivateADraft_Returns400_WithTheServersMessage_AndChangesNothing()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false, isDraft: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, CancellationToken.None));

        Assert.Equal("A draft participant cannot be activated. Complete their intake and profile first.", message);
        Assert.False((await fx.Db.Participants.SingleAsync()).IsActive);
        Assert.Empty(UpdatedAuditRows(fx.Db, participant.Id));
    }

    [Fact]
    public async Task ChangeStatus_Activate_EnforceMode_WithoutEvidence_Returns400()
    {
        using var fx = Create();
        fx.Db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantReadinessMode = ParticipantReadinessMode.Enforce });
        var participant = RichParticipant(isActive: false);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, CancellationToken.None));

        Assert.False(string.IsNullOrWhiteSpace(message));
        Assert.False((await fx.Db.Participants.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task ChangeStatus_AlreadyInTheRequestedState_ReportsUnchanged_AndWritesNothing()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true, Reason = "again" }, CancellationToken.None));

        Assert.False(result.Changed);
        Assert.True(result.IsActive);
        Assert.Empty(UpdatedAuditRows(fx.Db, participant.Id));
    }

    [Fact]
    public async Task ChangeStatus_OmittedFlag_Returns400_AndArchivesNobody()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto(), CancellationToken.None));

        Assert.Contains("isActive", message, StringComparison.OrdinalIgnoreCase);
        Assert.True((await fx.Db.Participants.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task ChangeStatus_Deactivate_WarnsAboutUpcomingShiftsPatternsAndBookings_WithoutCancellingAnyOfThem()
    {
        using var fx = Create();
        var participant = RichParticipant();
        fx.Db.Participants.Add(participant);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        for (var i = 1; i <= 3; i++)
            fx.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, ServiceDate = today.AddDays(i), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.Published });
        // Not upcoming, or not live: none of these may be counted.
        fx.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, ServiceDate = today.AddDays(-9), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.Completed });
        fx.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, ServiceDate = today.AddDays(4), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.Cancelled });
        fx.Db.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), EffectiveFrom = today.AddDays(-30), IsActive = true });
        fx.Db.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id, DayOfWeek = DayOfWeek.Friday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0), EffectiveFrom = today.AddDays(-30), IsActive = false });
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = TenantId, TripName = "Coast", StartDate = today.AddDays(20), DurationDays = 3 };
        fx.Db.TripInstances.Add(trip);
        fx.Db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = today });
        fx.Db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Cancelled, BookingDate = today });
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None));

        Assert.Contains("3 upcoming shifts still reference this participant. They were not cancelled.", result.Warnings);
        Assert.Contains("1 recurring shift pattern still references this participant. It was not changed.", result.Warnings);
        Assert.Contains("1 upcoming trip booking still references this participant. It was not cancelled.", result.Warnings);
        Assert.Equal(5, await fx.Db.Shifts.CountAsync());
        Assert.Equal(2, await fx.Db.ShiftPatterns.CountAsync());
        Assert.Equal(1, await fx.Db.ParticipantBookings.CountAsync(b => b.BookingStatus == BookingStatus.Confirmed));
    }

    [Fact]
    public async Task ChangeStatus_Deactivate_WithNothingUpcoming_HasNoWarnings()
    {
        using var fx = Create();
        var participant = RichParticipant();
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None));

        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task ChangeStatus_AnotherTenantsParticipant_Returns404_AndChangesNothing()
    {
        var database = Guid.NewGuid().ToString();
        Guid participantId;
        using (var owner = Create(TenantId, database))
        {
            var participant = RichParticipant();
            participantId = participant.Id;
            owner.Db.Participants.Add(participant);
            await owner.Db.SaveChangesAsync();
        }
        using var caller = Create(Guid.NewGuid(), database);

        var result = await caller.Controller.ChangeStatus(participantId, new ChangeParticipantStatusDto { IsActive = false }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var verify = Create(TenantId, database);
        Assert.True((await verify.Db.Participants.SingleAsync()).IsActive);
    }

    [Theory]
    [InlineData(nameof(ParticipantsController.ChangeStatus))]
    [InlineData(nameof(ParticipantsController.Restore))]
    [InlineData(nameof(ParticipantsController.CompleteProfile))]
    [InlineData(nameof(ParticipantsController.SaveIntake))]
    public void LifecycleWrites_AreRestrictedToAdminCoordinatorAndSuperAdmin(string action)
    {
        var method = typeof(ParticipantsController).GetMethod(action)!;
        var authorize = Assert.Single(method.GetCustomAttributes<AuthorizeAttribute>());
        Assert.Equal("Admin,Coordinator,SuperAdmin", authorize.Roles);
    }

    // ── POST /participants/{id}/restore ────────────────────────────────────────────────────

    [Fact]
    public async Task Restore_Reactivates_AndTouchesNoOtherField()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();
        var before = Scalars(participant);

        var result = Ok(await fx.Controller.Restore(participant.Id, CancellationToken.None));

        Assert.True(result.IsActive);
        Assert.True(result.Changed);
        var after = Scalars(await fx.Db.Participants.SingleAsync());
        // What restoring through the full-record PUT used to blank: NDIS number, DOB, gender, address, phone, email, clinical.
        Assert.Equal(["IsActive", "UpdatedAt"], after.Keys.Where(k => before[k] != after[k]).OrderBy(k => k).ToList());
        Assert.Equal("431234567", after[nameof(Participant.NdisNumber)]);
        Assert.Equal("Epilepsy", after[nameof(Participant.PrimaryDiagnosis)]);
    }

    [Fact]
    public async Task Restore_ADraft_Returns400()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false, isDraft: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.Restore(participant.Id, CancellationToken.None));

        Assert.Equal("A draft participant cannot be activated. Complete their intake and profile first.", message);
    }

    [Fact]
    public async Task Restore_AnActiveParticipant_IsAnUnchangedSuccess()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.Restore(participant.Id, CancellationToken.None));

        Assert.False(result.Changed);
        Assert.True(result.IsActive);
        Assert.Empty(UpdatedAuditRows(fx.Db, participant.Id));
    }

    [Fact]
    public async Task Restore_UnknownParticipant_Returns404()
    {
        using var fx = Create();

        var result = await fx.Controller.Restore(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── POST /participants/{id}/complete-profile ───────────────────────────────────────────

    [Fact]
    public async Task CompleteProfile_FinalisesADraftWhoseIntakeIsComplete_AndLeavesEveryProfileFieldAlone()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false, isDraft: true, intakeCompletedAt: DateTime.UtcNow.AddDays(-3));
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();
        var before = Scalars(participant);

        var result = Ok(await fx.Controller.CompleteProfile(participant.Id, CancellationToken.None));

        Assert.False(result.IsDraft);
        var saved = await fx.Db.Participants.SingleAsync();
        Assert.False(saved.IsDraft);
        // Warn mode (the default) activates a finalised participant, exactly as the full PUT it replaces did.
        Assert.True(saved.IsActive);
        var after = Scalars(saved);
        Assert.Equal(["IsActive", "IsDraft", "UpdatedAt"], after.Keys.Where(k => before[k] != after[k]).OrderBy(k => k).ToList());
        Assert.Equal(participant.IntakeCompletedAt, saved.IntakeCompletedAt);
    }

    [Fact]
    public async Task CompleteProfile_WithoutACompletedIntake_Returns400_AndStaysADraft()
    {
        using var fx = Create();
        var participant = RichParticipant(isActive: false, isDraft: true);
        fx.Db.Participants.Add(participant);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.CompleteProfile(participant.Id, CancellationToken.None));

        Assert.Equal("Complete the participant's intake before completing their profile.", message);
        Assert.True((await fx.Db.Participants.SingleAsync()).IsDraft);
    }

    [Fact]
    public async Task CompleteProfile_OnAnAlreadyFinalisedParticipant_ChangesNothing_AndNeverReactivatesAnArchivedOne()
    {
        using var fx = Create();
        var archived = RichParticipant(isActive: false, isDraft: false);
        fx.Db.Participants.Add(archived);
        await fx.Db.SaveChangesAsync();
        var before = Scalars(archived);

        var first = Ok(await fx.Controller.CompleteProfile(archived.Id, CancellationToken.None));
        var second = Ok(await fx.Controller.CompleteProfile(archived.Id, CancellationToken.None));

        Assert.False(first.IsDraft);
        Assert.False(second.IsDraft);
        var saved = await fx.Db.Participants.SingleAsync();
        // Editing an archived participant's profile must not bring them back: the old full PUT re-activated them.
        Assert.False(saved.IsActive);
        Assert.Equal(before, Scalars(saved));
    }

    // ── PUT /participants/{id}: a finalised participant is never demoted ───────────────────

    private static UpdateParticipantDto FullUpdate(Participant p, bool isDraft) => new()
    {
        FirstName = p.FirstName, LastName = p.LastName, PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        IsActive = true, IsDraft = isDraft,
    };

    [Fact]
    public async Task Update_ANonDraftLegacyParticipantWithNullIntakeCompletedAt_StaysNonDraft()
    {
        using var fx = Create();
        var legacy = RichParticipant(isActive: true, isDraft: false);
        legacy.IntakeCompletedAt = null;
        fx.Db.Participants.Add(legacy);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.Update(legacy.Id, FullUpdate(legacy, isDraft: false), CancellationToken.None));

        // They left the register and every picker, and could not be rostered, the moment anyone saved their profile.
        Assert.False(result.IsDraft);
        Assert.False((await fx.Db.Participants.SingleAsync()).IsDraft);
    }

    [Fact]
    public async Task Update_ADraftWithACompletedIntake_IsStillFinalisedByIsDraftFalse()
    {
        using var fx = Create();
        var draft = RichParticipant(isActive: false, isDraft: true, intakeCompletedAt: DateTime.UtcNow.AddDays(-1));
        fx.Db.Participants.Add(draft);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.Update(draft.Id, FullUpdate(draft, isDraft: false), CancellationToken.None));

        Assert.False(result.IsDraft);
    }

    [Fact]
    public async Task Update_ADraftWithoutACompletedIntake_StaysADraft_WhateverTheClientSends()
    {
        using var fx = Create();
        var draft = RichParticipant(isActive: false, isDraft: true);
        fx.Db.Participants.Add(draft);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.Update(draft.Id, FullUpdate(draft, isDraft: false), CancellationToken.None));

        Assert.True(result.IsDraft);
    }

    [Fact]
    public async Task Update_AFinalisedParticipant_CannotBeSentBackToDraft()
    {
        using var fx = Create();
        var finalised = RichParticipant(isActive: true, isDraft: false);
        fx.Db.Participants.Add(finalised);
        await fx.Db.SaveChangesAsync();

        var message = BadRequest(await fx.Controller.Update(finalised.Id, FullUpdate(finalised, isDraft: true), CancellationToken.None));

        Assert.Equal("A finalised participant cannot be reverted to draft.", message);
    }

    // ── GET /participants?search= ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData("jamie")]
    [InlineData("JAMIE")]
    [InlineData("sMiTh")]
    [InlineData("jay")]
    [InlineData("jamie smith")]
    public async Task GetAll_Search_IsCaseInsensitive(string term)
    {
        using var fx = Create();
        var jamie = RichParticipant();
        var other = RichParticipant();
        other.FirstName = "Robin"; other.LastName = "Jones"; other.PreferredName = null;
        fx.Db.Participants.AddRange(jamie, other);
        await fx.Db.SaveChangesAsync();

        var result = Ok(await fx.Controller.GetAll(term, null, null, null, null, null, 1, 50, CancellationToken.None, false));

        Assert.Equal(jamie.Id, Assert.Single(result.Items).Id);
    }
}
