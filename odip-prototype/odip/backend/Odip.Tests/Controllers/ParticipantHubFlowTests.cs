using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The Participants hub's lifecycle: enquiry, draft intake, intake complete (the Onboarding tab), active (the Active tab).
/// The Onboarding tab used to list whoever had a <see cref="ParticipantOnboarding"/> ROW, so it missed a participant whose intake was
/// completed before completion created one, and it listed active participants and intakes that were still open. It now lists
/// participants by state: a draft whose intake is complete, whether or not an enquiry or an onboarding row exists.
/// The Enquiries tab's feed carries the drafts started in the Intake wizard with no enquiry, so they are not lost with the Drafts view.
/// Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantIntakeOnboardingTests.
/// </summary>
public class ParticipantHubFlowTests
{
    private sealed class Caller : IDisposable
    {
        public OdipDbContext Db { get; }
        public ParticipantsController Participants { get; }
        public ParticipantInquiriesController Inquiries { get; }

        public Caller(string store, Guid? tenantId, bool superAdmin = false, IInterceptor? interceptor = null)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.SetupGet(x => x.TenantId).Returns(tenantId);
            tenant.SetupGet(x => x.IsSuperAdmin).Returns(superAdmin);
            var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(store);
            if (interceptor != null) options.AddInterceptors(interceptor);
            Db = new OdipDbContext(options.Options, tenant.Object);
            var http = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "coordinator-1")], "Test")),
            };
            Participants = new ParticipantsController(Db, new StaffCompatibilityLinkService(Db), new ParticipantDocumentService(Db), new SafetyNoteSyncService(Db))
            {
                ControllerContext = new ControllerContext { HttpContext = http },
            };
            Inquiries = new ParticipantInquiriesController(Db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = http } };
        }

        public void Dispose() => Db.Dispose();
    }

    private static Caller NewCaller(Guid tenantId) => new(Guid.NewGuid().ToString(), tenantId);

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<List<ParticipantOnboardingWorklistDto>> WorklistAsync(Caller caller) =>
        Ok(await caller.Inquiries.GetOnboardingWorklist(CancellationToken.None));

    private static async Task<List<ParticipantInquiryDto>> EnquiriesAsync(Caller caller) =>
        Ok(await caller.Inquiries.GetAll(CancellationToken.None));

    /// <summary>The register the Active tab asks for: active, finalised, past the onboarding stage rule.</summary>
    private static async Task<List<ParticipantListDto>> ActiveRegisterAsync(Caller caller) =>
        Ok(await caller.Participants.GetAll(null, null, true, null, null, false, 1, 50, CancellationToken.None, operationalOnly: true)).Items;

    /// <summary>What the Archived view asks for: finalised and not active, not narrowed by the stage rule.</summary>
    private static async Task<List<ParticipantListDto>> ArchivedAsync(Caller caller) =>
        Ok(await caller.Participants.GetAll(null, null, false, null, null, false, 1, 50, CancellationToken.None)).Items;

    /// <summary>The Intake wizard's body: a resume ("Save as draft") or a completion.</summary>
    private static CreateParticipantDto IntakeBody(string first, string last, bool complete) => new()
    {
        FirstName = first, LastName = last, PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        IsDraft = true, CompleteIntake = complete, CompletionRequestId = complete ? Guid.NewGuid().ToString() : null,
    };

    private static async Task<Participant> SeedAsync(
        OdipDbContext db, Guid tenantId, string first, string last, bool draft, bool intakeDone, bool active = false, bool onboardingRow = false)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last,
            Phone = "0400 111 222", Email = $"{first.ToLowerInvariant()}@example.test",
            IsDraft = draft, IsActive = active, IntakeCompletedAt = intakeDone ? new DateTime(2026, 9, 20, 3, 0, 0, DateTimeKind.Utc) : null,
        };
        db.Participants.Add(participant);
        if (onboardingRow) db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id });
        await db.SaveChangesAsync();
        return participant;
    }

    private static async Task<ParticipantInquiryDto> CaptureEnquiryAsync(Caller caller, string first = "Ada", string last = "Lovelace") =>
        Ok(await caller.Inquiries.Create(new CreateParticipantInquiryDto { FirstName = first, LastName = last, Phone = "0400 000 001", Source = "Phone" }, CancellationToken.None));

    private static async Task SetReadinessModeAsync(OdipDbContext db, Guid tenantId, ParticipantReadinessMode mode)
    {
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantReadinessMode = mode });
        await db.SaveChangesAsync();
    }

    // ── The Onboarding tab lists participants by state, not by whether an onboarding row exists ──────────

    [Fact]
    public async Task Worklist_ListsAnIntakeCompleteDraft_EvenWhenItHasNoOnboardingRow()
    {
        // A participant whose intake was completed through the wizard before completion created the row has none, and no
        // migration backfilled one. The worklist INNER JOINed onboarding rows, so they could never appear.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var legacy = await SeedAsync(caller.Db, tenantId, "Lena", "Legacy", draft: true, intakeDone: true);
        Assert.Empty(caller.Db.ParticipantOnboardings);

        var row = Assert.Single(await WorklistAsync(caller));

        Assert.Equal(legacy.Id, row.ParticipantId);
        Assert.Equal("Lena Legacy", row.FullName);
        Assert.Equal("Onboarding incomplete", row.Stage);
        Assert.Equal("Validate profile essentials", row.NextAction);
        Assert.Equal(1, row.CompletedSteps);
    }

    [Fact]
    public async Task Worklist_ListsAnEnquiryParticipant_AsSoonAsTheirIntakeIsCompleted()
    {
        // Guard, not a reproduction: the enquiry -> Start intake -> Complete intake path on the real controllers already puts the participant on
        // the worklist (Convert makes the row, completion keeps it). Whatever the Onboarding tab misses is not this path.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var enquiry = await CaptureEnquiryAsync(caller);
        var participantId = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).ParticipantId!.Value;

        Ok(await caller.Participants.SaveIntake(participantId, IntakeBody("Ada", "Lovelace", complete: true), CancellationToken.None));

        var row = Assert.Single(await WorklistAsync(caller));
        Assert.Equal(participantId, row.ParticipantId);
        Assert.Equal("Onboarding incomplete", row.Stage);
    }

    [Fact]
    public async Task Worklist_DoesNotListAnActiveParticipant_EvenWithAnOnboardingRow()
    {
        // Activation is the end of onboarding. BuildDetail hard-codes IsReady=false, so nothing ever dropped a row once it existed.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        await SeedAsync(caller.Db, tenantId, "Alex", "Active", draft: false, intakeDone: true, active: true, onboardingRow: true);
        var waiting = await SeedAsync(caller.Db, tenantId, "Wren", "Waiting", draft: true, intakeDone: true, onboardingRow: true);

        var row = Assert.Single(await WorklistAsync(caller));

        Assert.Equal(waiting.Id, row.ParticipantId);
    }

    [Fact]
    public async Task Worklist_DoesNotListAFinalisedParticipantWhoWasArchivedAfterOnboarding()
    {
        // Archived is its own view of the Active tab. An archived participant has an onboarding row and a completed intake,
        // and is not active: nothing but being finalised tells them apart from someone still in onboarding.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        await SeedAsync(caller.Db, tenantId, "Archie", "Archived", draft: false, intakeDone: true, active: false, onboardingRow: true);

        Assert.Empty(await WorklistAsync(caller));
    }

    [Fact]
    public async Task Worklist_DoesNotListADraftWhoseIntakeIsStillOpen_ThoughConvertingTheEnquiryGaveItARow()
    {
        // "Start intake" on an enquiry creates the draft and its onboarding row. That participant is an intake in progress, which the
        // Enquiries tab shows; the Onboarding tab starts once the intake is complete.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var enquiry = await CaptureEnquiryAsync(caller);
        var converted = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None));
        Assert.Single(caller.Db.ParticipantOnboardings);

        Assert.Empty(await WorklistAsync(caller));

        Ok(await caller.Participants.SaveIntake(converted.ParticipantId!.Value, IntakeBody("Ada", "Lovelace", complete: true), CancellationToken.None));
        Assert.Equal(converted.ParticipantId, Assert.Single(await WorklistAsync(caller)).ParticipantId);
    }

    [Fact]
    public async Task Worklist_IsTenantScoped_ForParticipantsWithAndWithoutARow()
    {
        var store = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        using var a = new Caller(store, tenantA);
        using var b = new Caller(store, tenantB);
        var own = await SeedAsync(a.Db, tenantA, "Own", "Participant", draft: true, intakeDone: true);
        await SeedAsync(b.Db, tenantB, "Foreign", "WithRow", draft: true, intakeDone: true, onboardingRow: true);
        await SeedAsync(b.Db, tenantB, "Foreign", "NoRow", draft: true, intakeDone: true);

        Assert.Equal(own.Id, Assert.Single(await WorklistAsync(a)).ParticipantId);
        Assert.Equal(2, (await WorklistAsync(b)).Count);
    }

    // ── The checklist behind a listed participant works without a stored row ─────────────────────────────

    [Fact]
    public async Task GetOnboarding_ForAnIntakeCompleteDraftWithoutARow_ReturnsTheChecklist_AndWritesNothing()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var legacy = await SeedAsync(caller.Db, tenantId, "Lena", "Legacy", draft: true, intakeDone: true);

        var detail = Ok(await caller.Inquiries.GetOnboarding(legacy.Id, CancellationToken.None));

        Assert.Equal(legacy.Id, detail.ParticipantId);
        Assert.True(detail.IntakeComplete);
        Assert.False(detail.ProfileComplete);
        Assert.Empty(caller.Db.ParticipantOnboardings);
    }

    [Fact]
    public async Task GetOnboarding_ForAnActiveLegacyParticipantWithoutARow_IsStillNotFound()
    {
        // Only a participant who is in onboarding gets a blank checklist: an active legacy participant never onboarded here.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var legacy = await SeedAsync(caller.Db, tenantId, "Old", "Timer", draft: false, intakeDone: false, active: true);

        Assert.IsType<NotFoundObjectResult>((await caller.Inquiries.GetOnboarding(legacy.Id, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task ValidateProfile_ForAnIntakeCompleteDraftWithoutARow_CreatesTheRowAndRecordsTheValidation()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var legacy = await SeedAsync(caller.Db, tenantId, "Lena", "Legacy", draft: true, intakeDone: true);
        legacy.DateOfBirth = new DateOnly(1990, 5, 17);
        legacy.Gender = Gender.NonBinary;
        legacy.FundingSource = ParticipantFundingSource.Other;
        await caller.Db.SaveChangesAsync();

        var detail = Ok(await caller.Inquiries.ValidateProfile(legacy.Id, CancellationToken.None));

        Assert.True(detail.ProfileComplete);
        var onboarding = Assert.Single(caller.Db.ParticipantOnboardings);
        Assert.Equal(legacy.Id, onboarding.ParticipantId);
        Assert.Equal(tenantId, onboarding.TenantId);
        Assert.True(onboarding.ProfileComplete);
    }

    // ── Two requests for the same row-less participant ────────────────────────────────────────────────────

    /// <summary>
    /// On the first save that inserts an onboarding row, commits the competing request's row through another context, then fails the way PostgreSQL does
    /// (the unique index on the participant rejects the second insert). The same simulation as MedicationAdministrationIdempotencyTests.
    /// </summary>
    private sealed class OnboardingRowRaceInterceptor(Func<Task> beforeThrow) : SaveChangesInterceptor
    {
        public bool Armed { get; set; }
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var inserting = eventData.Context!.ChangeTracker.Entries<ParticipantOnboarding>().Any(entry => entry.State == EntityState.Added);
            if (!Armed || _fired || !inserting) return result;
            _fired = true;
            await beforeThrow();
            throw new DbUpdateException("duplicate key value violates unique constraint", new PostgresException(
                messageText: "duplicate key value violates unique constraint", severity: "ERROR", invariantSeverity: "ERROR",
                sqlState: PostgresErrorCodes.UniqueViolation, tableName: "ParticipantOnboardings", constraintName: "IX_ParticipantOnboardings_ParticipantId"));
        }
    }

    /// <summary>A caller whose first onboarding-row insert loses to a concurrent request that stored the row first. Arm it after seeding.</summary>
    private static (Caller Caller, OnboardingRowRaceInterceptor Race, Func<Guid, Task> WinnerStores) RacingCaller(Guid tenantId)
    {
        var store = Guid.NewGuid().ToString();
        var participantId = Guid.Empty;
        var race = new OnboardingRowRaceInterceptor(async () =>
        {
            using var other = new Caller(store, tenantId);
            other.Db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId });
            await other.Db.SaveChangesAsync();
        });
        return (new Caller(store, tenantId, interceptor: race), race, id => { participantId = id; return Task.CompletedTask; });
    }

    [Fact]
    public async Task ValidateProfile_WhenAConcurrentRequestStoredTheRowFirst_RecordsOnTheirRow_InsteadOfAnError()
    {
        // Two coordinators validate the same row-less participant within milliseconds: both find no row and both insert; the unique index rejects the second.
        // That was an unhandled DbUpdateException (a generic 500 the screen showed as is). The row exists by then, so the loser records on it and succeeds.
        var tenantId = Guid.NewGuid();
        var (caller, race, winnerStores) = RacingCaller(tenantId);
        using var _ = caller;
        var legacy = await SeedAsync(caller.Db, tenantId, "Lena", "Legacy", draft: true, intakeDone: true);
        legacy.DateOfBirth = new DateOnly(1990, 5, 17);
        legacy.Gender = Gender.NonBinary;
        legacy.FundingSource = ParticipantFundingSource.Other;
        await caller.Db.SaveChangesAsync();
        await winnerStores(legacy.Id);
        race.Armed = true;

        var detail = Ok(await caller.Inquiries.ValidateProfile(legacy.Id, CancellationToken.None));

        Assert.True(detail.ProfileComplete);
        var onboarding = Assert.Single(await caller.Db.ParticipantOnboardings.ToListAsync());
        Assert.Equal(legacy.Id, onboarding.ParticipantId);
        Assert.Equal(tenantId, onboarding.TenantId);
        Assert.True(onboarding.ProfileComplete);
        Assert.NotNull(onboarding.ProfileCompletedAt);
    }

    [Fact]
    public async Task ConfirmServiceNeeds_WhenAConcurrentRequestStoredTheRowFirst_RecordsOnTheirRow_InsteadOfAnError()
    {
        var tenantId = Guid.NewGuid();
        var (caller, race, winnerStores) = RacingCaller(tenantId);
        using var _ = caller;
        var legacy = await SeedAsync(caller.Db, tenantId, "Lena", "Legacy", draft: true, intakeDone: true);
        caller.Db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = legacy.Id, Version = 1,
            PlanStartDate = new DateOnly(2026, 1, 1), PlanEndDate = new DateOnly(2026, 12, 31),
            AgreementStartDate = new DateOnly(2026, 2, 1), AgreementEndDate = new DateOnly(2026, 11, 30),
            Lines = { new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = "Community access", Hours = 10, ItemCode = "04_104_0125_6_1", CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 1, 1), UnitPrice = 70m } },
        });
        await caller.Db.SaveChangesAsync();
        await winnerStores(legacy.Id);
        race.Armed = true;

        var detail = Ok(await caller.Inquiries.ConfirmServiceNeeds(legacy.Id, CancellationToken.None));

        Assert.True(detail.ServiceTypeConfirmed);
        var onboarding = Assert.Single(await caller.Db.ParticipantOnboardings.ToListAsync());
        Assert.Equal(legacy.Id, onboarding.ParticipantId);
        Assert.True(onboarding.ServiceTypeConfirmed);
    }

    // ── The Enquiries tab's feed also carries drafts started without an enquiry ─────────────────────────

    [Fact]
    public async Task Enquiries_IncludeADraftIntakeStartedInTheWizardWithNoEnquiry_AsADirectIntake()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var direct = await SeedAsync(caller.Db, tenantId, "Dana", "Direct", draft: true, intakeDone: false);

        var row = Assert.Single(await EnquiriesAsync(caller));

        Assert.True(row.IsDirectIntake);
        Assert.Equal(direct.Id, row.Id);
        Assert.Equal(direct.Id, row.ParticipantId);
        Assert.Equal("Dana", row.FirstName);
        Assert.Equal("Direct", row.LastName);
        Assert.Equal("0400 111 222", row.Phone);
        Assert.Equal("dana@example.test", row.Email);
        // The state the tab derives "Draft intake" from, so the row needs no special case on the client.
        Assert.Equal(true, row.ParticipantIsDraft);
        Assert.Equal(false, row.ParticipantIsActive);
        Assert.Null(row.ParticipantIntakeCompletedAt);
    }

    [Fact]
    public async Task Enquiries_DoNotRepeatADraftThatAnEnquiryAlreadyLinks_AndNeverMarkARealEnquiryAsDirect()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var enquiry = await CaptureEnquiryAsync(caller);
        var converted = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None));

        var row = Assert.Single(await EnquiriesAsync(caller));

        Assert.Equal(enquiry.Id, row.Id);
        Assert.Equal(converted.ParticipantId, row.ParticipantId);
        Assert.False(row.IsDirectIntake);
    }

    [Fact]
    public async Task Enquiries_LeaveOutDraftsWhoseIntakeIsComplete_AndEveryFinalisedParticipant()
    {
        // Intake complete is the Onboarding tab's; a finalised participant is the Active tab's (or Archived's).
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        await SeedAsync(caller.Db, tenantId, "Ira", "Intake", draft: true, intakeDone: true);
        await SeedAsync(caller.Db, tenantId, "Alex", "Active", draft: false, intakeDone: true, active: true);
        await SeedAsync(caller.Db, tenantId, "Archie", "Archived", draft: false, intakeDone: true, active: false);

        Assert.Empty(await EnquiriesAsync(caller));
    }

    [Fact]
    public async Task Enquiries_DirectIntakes_AreOnlyTheCallersTenants()
    {
        var store = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        using var a = new Caller(store, tenantA);
        using var b = new Caller(store, tenantB);
        var own = await SeedAsync(a.Db, tenantA, "Own", "Intake", draft: true, intakeDone: false);
        await SeedAsync(b.Db, tenantB, "Foreign", "Intake", draft: true, intakeDone: false);

        var row = Assert.Single(await EnquiriesAsync(a));

        Assert.Equal(own.Id, row.ParticipantId);
        Assert.True(row.IsDirectIntake);
    }

    // ── The JSON the screens read ────────────────────────────────────────────────────────────────────────

    /// <summary>MVC's web defaults (camelCase) plus the API's own policy: the options the response formatter really uses (see <see cref="ApiJsonOptions"/>).</summary>
    private static readonly JsonSerializerOptions Wire = ProductionOptions();

    private static JsonSerializerOptions ProductionOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    [Fact]
    public async Task Enquiries_OnTheWire_CarryTheCamelCaseKeysTheScreensRead_AndAnEmptySourceForADirectIntake()
    {
        // Every other test here reads the DTOs; the screens read this JSON. InquiriesPage and InquiryFormPage rely on exactly these keys (and on a null being
        // omitted, which they read as "not complete" / "no participant"), so a renamed property or a changed policy must fail here, not in the browser.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var direct = await SeedAsync(caller.Db, tenantId, "Dana", "Direct", draft: true, intakeDone: false);
        await CaptureEnquiryAsync(caller, "Nina", "Newcomer");
        var finished = await CaptureEnquiryAsync(caller, "Ira", "Intake");
        var finishedParticipantId = Ok(await caller.Inquiries.Convert(finished.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).ParticipantId!.Value;
        Ok(await caller.Participants.SaveIntake(finishedParticipantId, IntakeBody("Ira", "Intake", complete: true), CancellationToken.None));

        var result = await caller.Inquiries.GetAll(CancellationToken.None);
        var body = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(result.Result).Value, Wire);
        var rows = body.GetProperty("data").EnumerateArray().ToDictionary(row => row.GetProperty("lastName").GetString()!);

        // A draft intake started in the wizard: flagged, id = the participant's, no source, draft and not complete (a null is omitted, not written).
        var directRow = rows["Direct"];
        Assert.True(directRow.GetProperty("isDirectIntake").GetBoolean());
        Assert.Equal(direct.Id, directRow.GetProperty("id").GetGuid());
        Assert.Equal(direct.Id, directRow.GetProperty("participantId").GetGuid());
        Assert.Equal(JsonValueKind.String, directRow.GetProperty("source").ValueKind);
        Assert.Equal(string.Empty, directRow.GetProperty("source").GetString());
        Assert.True(directRow.GetProperty("participantIsDraft").GetBoolean());
        Assert.False(directRow.GetProperty("participantIsActive").GetBoolean());
        Assert.False(directRow.TryGetProperty("participantIntakeCompletedAt", out _));

        // An enquiry with no participant: not a direct intake, a real source, and none of the participant keys.
        var newRow = rows["Newcomer"];
        Assert.False(newRow.GetProperty("isDirectIntake").GetBoolean());
        Assert.Equal("Phone", newRow.GetProperty("source").GetString());
        Assert.False(newRow.TryGetProperty("participantId", out _));
        Assert.False(newRow.TryGetProperty("participantIsDraft", out _));

        // An enquiry whose intake is complete: the participant's state is there, and the completion time is a UTC instant the screens treat as "done".
        var doneRow = rows["Intake"];
        Assert.False(doneRow.GetProperty("isDirectIntake").GetBoolean());
        Assert.Equal(finishedParticipantId, doneRow.GetProperty("participantId").GetGuid());
        Assert.True(doneRow.GetProperty("participantIsDraft").GetBoolean());
        Assert.EndsWith("Z", doneRow.GetProperty("participantIntakeCompletedAt").GetString());
    }

    // ── Every participant is on exactly one tab, whatever IsActive says about a draft ────────────────────

    /// <summary>
    /// A draft's tab follows its intake alone: IsActive is no part of it. Participant.IsActive defaults to true and Create only started forcing
    /// it to false on 2026-09-27, so a draft made before then and never re-saved through the old full PUT (which recomputed it) is active: the
    /// seeded demo draft is one. A rule that also asked "not active" left such a draft on no tab once its intake was complete.
    /// </summary>
    [Theory]
    [InlineData(true, false, false, "enquiries")]
    [InlineData(true, false, true, "onboarding")]
    [InlineData(true, true, false, "enquiries")]
    [InlineData(true, true, true, "onboarding")]
    [InlineData(false, true, false, "active")]
    [InlineData(false, true, true, "active")]
    [InlineData(false, false, false, "archived")]
    [InlineData(false, false, true, "archived")]
    public async Task EveryParticipant_IsOnExactlyOneTab_AndADraftsTabFollowsItsIntakeAlone(bool isDraft, bool isActive, bool intakeDone, string expectedTab)
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var participant = await SeedAsync(caller.Db, tenantId, "Pat", "Partition", draft: isDraft, intakeDone: intakeDone, active: isActive);

        var tabs = new List<string>();
        if ((await EnquiriesAsync(caller)).Any(row => row.ParticipantId == participant.Id)) tabs.Add("enquiries");
        if ((await WorklistAsync(caller)).Any(row => row.ParticipantId == participant.Id)) tabs.Add("onboarding");
        if ((await ActiveRegisterAsync(caller)).Any(row => row.Id == participant.Id)) tabs.Add("active");
        if ((await ArchivedAsync(caller)).Any(row => row.Id == participant.Id)) tabs.Add("archived");

        Assert.Equal([expectedTab], tabs);
    }

    [Fact]
    public async Task Worklist_ListsADraftThatIsMarkedActive_OnceItsIntakeIsComplete()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var seeded = await SeedAsync(caller.Db, tenantId, "Priya", "Preseed", draft: true, intakeDone: true, active: true);

        var row = Assert.Single(await WorklistAsync(caller));

        Assert.Equal(seeded.Id, row.ParticipantId);
        Assert.Equal("Onboarding incomplete", row.Stage);
    }

    [Fact]
    public async Task Lifecycle_ADraftMarkedActive_IsOnATabAtEveryStep_AndCompletingTheProfileKeepsThemActive()
    {
        // The seeded demo draft: IsDraft with the entity's default IsActive=true, no enquiry, no onboarding row.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var seeded = await SeedAsync(caller.Db, tenantId, "Priya", "Preseed", draft: true, intakeDone: false, active: true);
        Assert.Equal(seeded.Id, Assert.Single(await EnquiriesAsync(caller)).ParticipantId);
        Assert.Empty(await WorklistAsync(caller));

        // Resume and complete the intake: SaveIntake never reads or changes IsActive, and she must be on Onboarding, not on no tab.
        Ok(await caller.Participants.SaveIntake(seeded.Id, IntakeBody("Priya", "Preseed", complete: true), CancellationToken.None));
        Assert.True((await caller.Db.Participants.SingleAsync()).IsActive);
        Assert.Empty(await EnquiriesAsync(caller));
        Assert.Equal(seeded.Id, Assert.Single(await WorklistAsync(caller)).ParticipantId);

        // Complete Profile finalises her; she was already active, so she is on the Active register.
        var completed = Ok(await caller.Participants.CompleteProfile(seeded.Id, CancellationToken.None));
        Assert.False(completed.IsDraft);
        Assert.True(completed.IsActive);
        Assert.Empty(await WorklistAsync(caller));
        Assert.Equal(seeded.Id, Assert.Single(await ActiveRegisterAsync(caller)).Id);
    }

    // ── The whole lifecycle, through the controllers the screens call ────────────────────────────────────

    [Fact]
    public async Task Lifecycle_EnquiryToActive_InWarnMode_MovesTheParticipantFromEnquiriesToOnboardingToActive()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);

        // 1. An enquiry: open, with no participant yet. Not in onboarding, not on the register.
        var enquiry = await CaptureEnquiryAsync(caller);
        Assert.Null(Assert.Single(await EnquiriesAsync(caller)).ParticipantId);
        Assert.Empty(await WorklistAsync(caller));
        Assert.Empty(await ActiveRegisterAsync(caller));

        // 2. Start intake: a draft with its intake open. Still an enquiry-tab row, still not in onboarding.
        var started = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None));
        var participantId = started.ParticipantId!.Value;
        var intakeOpen = Assert.Single(await EnquiriesAsync(caller));
        Assert.Equal(true, intakeOpen.ParticipantIsDraft);
        Assert.Null(intakeOpen.ParticipantIntakeCompletedAt);
        Assert.Empty(await WorklistAsync(caller));

        // 3. Complete the intake: the participant is on the Onboarding tab, and the enquiry says so.
        Ok(await caller.Participants.SaveIntake(participantId, IntakeBody("Ada", "Lovelace", complete: true), CancellationToken.None));
        var onboardingRow = Assert.Single(await WorklistAsync(caller));
        Assert.Equal(participantId, onboardingRow.ParticipantId);
        Assert.Equal("Onboarding incomplete", onboardingRow.Stage);
        Assert.NotNull(Assert.Single(await EnquiriesAsync(caller)).ParticipantIntakeCompletedAt);
        Assert.Empty(await ActiveRegisterAsync(caller));

        // 4. Complete the profile. Warn mode activates, so the participant leaves Onboarding for the Active tab.
        var completed = Ok(await caller.Participants.CompleteProfile(participantId, CancellationToken.None));
        Assert.True(completed.IsActive);
        Assert.False(completed.IsDraft);
        Assert.Empty(await WorklistAsync(caller));
        Assert.Equal(participantId, Assert.Single(await ActiveRegisterAsync(caller)).Id);
        Assert.Empty(await ArchivedAsync(caller));
        var finished = Assert.Single(await EnquiriesAsync(caller));
        Assert.Equal(false, finished.ParticipantIsDraft);
        Assert.Equal(true, finished.ParticipantIsActive);
    }

    [Fact]
    public async Task Lifecycle_DraftStartedWithoutAnEnquiry_ShowsInTheEnquiriesFeed_ThenOnboarding_ThenActive()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);

        // "Save as draft" from /participants/new: an intake in progress with no enquiry behind it. It must not be lost with the Drafts view.
        var participantId = await CreatedIdAsync(caller.Participants.Create(IntakeBody("Dana", "Direct", complete: false), CancellationToken.None));
        var direct = Assert.Single(await EnquiriesAsync(caller));
        Assert.True(direct.IsDirectIntake);
        Assert.Equal(participantId, direct.ParticipantId);
        Assert.Empty(await WorklistAsync(caller));

        // Resumed and completed in the wizard: it leaves the Enquiries feed for the Onboarding tab, with the onboarding row completion made.
        Ok(await caller.Participants.SaveIntake(participantId, IntakeBody("Dana", "Direct", complete: true), CancellationToken.None));
        Assert.Empty(await EnquiriesAsync(caller));
        Assert.Equal(participantId, Assert.Single(await WorklistAsync(caller)).ParticipantId);

        Ok(await caller.Participants.CompleteProfile(participantId, CancellationToken.None));
        Assert.Empty(await WorklistAsync(caller));
        Assert.Equal(participantId, Assert.Single(await ActiveRegisterAsync(caller)).Id);
    }

    [Fact]
    public async Task Lifecycle_InEnforceMode_CompleteProfileIsRefusedWithTheEvidenceReason_AndTheParticipantStaysOnOnboarding()
    {
        // Enforce keeps the fail-closed rule: activation needs verified signed-agreement evidence, which nobody has yet. Finalising without being able to
        // activate would leave the participant in no stage, so Complete Profile is refused and they stay a draft on Onboarding, where the agreement-evidence
        // gate of their checklist says why.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        await SetReadinessModeAsync(caller.Db, tenantId, ParticipantReadinessMode.Enforce);
        var enquiry = await CaptureEnquiryAsync(caller);
        var participantId = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).ParticipantId!.Value;
        Ok(await caller.Participants.SaveIntake(participantId, IntakeBody("Ada", "Lovelace", complete: true), CancellationToken.None));
        Assert.Equal(participantId, Assert.Single(await WorklistAsync(caller)).ParticipantId);

        var refusal = await caller.Participants.CompleteProfile(participantId, CancellationToken.None);

        var failure = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<BadRequestObjectResult>(refusal.Result).Value);
        Assert.Equal("This participant cannot be activated until their signed service agreement evidence is recorded.", Assert.Single(failure.Errors!));
        var saved = await caller.Db.Participants.SingleAsync();
        Assert.True(saved.IsDraft);
        Assert.False(saved.IsActive);
        Assert.Equal(participantId, Assert.Single(await WorklistAsync(caller)).ParticipantId);
        Assert.Empty(await ActiveRegisterAsync(caller));
        Assert.Empty(await ArchivedAsync(caller));
        var checklist = Ok(await caller.Inquiries.GetOnboarding(participantId, CancellationToken.None));
        Assert.Contains(checklist.Reasons, reason => reason.Contains("agreement evidence", StringComparison.OrdinalIgnoreCase));
        // Plan builder phase D: an approved revision makes the patterns and the shifts, so the checklist no longer says that no shifts can be created; it says where they are made.
        Assert.Contains(checklist.Reasons, reason => reason.Contains("approved for rostering", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(checklist.Reasons, reason => reason.Contains("no shifts are created", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Lifecycle_TheChecklistNamesTheRevisionApprovedForRosteringOnceOneHasBeen_AndListsWhereTheScheduleIsMadeAsAGapUntilThen()
    {
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var enquiry = await CaptureEnquiryAsync(caller);
        var participantId = Ok(await caller.Inquiries.Convert(enquiry.Id, new ConvertParticipantInquiryDto(), CancellationToken.None)).ParticipantId!.Value;

        var before = Ok(await caller.Inquiries.GetOnboarding(participantId, CancellationToken.None));
        // Revisions 1 and 2 were approved (the newest approved one is the one named), and another participant's approval is nobody's business here.
        caller.Db.ServiceAgreementDraftApprovals.AddRange(
            new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = tenantId, DraftId = Guid.NewGuid(), ParticipantId = participantId, DraftVersion = 1, ApprovedAt = new DateTime(2026, 10, 5, 3, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex" },
            new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = tenantId, DraftId = Guid.NewGuid(), ParticipantId = participantId, DraftVersion = 2, ApprovedAt = new DateTime(2026, 10, 19, 3, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex" },
            new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = tenantId, DraftId = Guid.NewGuid(), ParticipantId = Guid.NewGuid(), DraftVersion = 7, ApprovedAt = new DateTime(2026, 10, 20, 3, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex" });
        await caller.Db.SaveChangesAsync();

        var after = Ok(await caller.Inquiries.GetOnboarding(participantId, CancellationToken.None));

        Assert.Equal((null, null), (before.ScheduleApprovedVersion, before.ScheduleApprovedAt));
        Assert.Contains(before.Reasons, reason => reason.StartsWith("The schedule is made when an agreement revision is approved for rostering", StringComparison.Ordinal));
        Assert.Equal((2, new DateTime(2026, 10, 19, 3, 0, 0, DateTimeKind.Utc)), (after.ScheduleApprovedVersion, after.ScheduleApprovedAt));
        // Once a revision is approved nothing about the schedule is missing, so the "what is still missing" list does not mention it at all (the other lines stay).
        Assert.DoesNotContain(after.Reasons, reason => reason.Contains("rostering", StringComparison.OrdinalIgnoreCase) || reason.Contains("schedule", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(before.Reasons.Count - 1, after.Reasons.Count);
    }

    [Fact]
    public async Task Lifecycle_ADraftCannotBeActivatedThroughTheStatusEndpoint_SoOnboardingEndsWithCompleteProfile()
    {
        // The status endpoint refuses a draft ("Complete their intake and profile first."), and a participant in onboarding is still a draft
        // until the Profile wizard's Complete Profile finalises it, applying the same Warn/Enforce activation rule. The Onboarding tab's way
        // out to Active is therefore complete-profile, not a bare status change.
        var tenantId = Guid.NewGuid();
        using var caller = NewCaller(tenantId);
        var inOnboarding = await SeedAsync(caller.Db, tenantId, "Wren", "Waiting", draft: true, intakeDone: true, onboardingRow: true);

        var refusal = await caller.Participants.ChangeStatus(inOnboarding.Id, new ChangeParticipantStatusDto { IsActive = true }, CancellationToken.None);

        var failure = Assert.IsType<ApiResponse<ParticipantStatusResultDto>>(Assert.IsType<BadRequestObjectResult>(refusal.Result).Value);
        Assert.Equal("A draft participant cannot be activated. Complete their intake and profile first.", Assert.Single(failure.Errors!));
        Assert.Equal(inOnboarding.Id, Assert.Single(await WorklistAsync(caller)).ParticipantId);
    }

    private static async Task<Guid> CreatedIdAsync(Task<ActionResult<ApiResponse<ParticipantDetailDto>>> create)
    {
        var created = Assert.IsType<CreatedAtActionResult>((await create).Result);
        return Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value).Data!.Id;
    }
}
