using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The Profile wizard lets staff correct values captured at Intake (name, DOB, phone/email, address,
/// NDIS number and plan, cultural flags, support needs, ...) and saves each step through
/// PATCH /api/v1/participants/{id}. Two server-side guarantees back that up:
///  1. every such correction is written to the participant audit trail the History tab reads;
///  2. correcting a value the onboarding profile-essentials gate validates (name, DOB, gender, NDIS
///     number, funding source) drops the now-stale "profile validated" attestation, exactly as a full
///     PUT and SaveIntake already do. Re-saving an unchanged step (the wizard echoes every field) or
///     correcting something else (e.g. the address) leaves the attestation alone.
/// </summary>
public class ParticipantProfileCorrectionTests
{
    private static readonly DateOnly Dob = new(1990, 5, 17);

    private sealed class Caller : IDisposable
    {
        public OdipDbContext Db { get; }
        public Guid TenantId { get; }

        public Caller()
        {
            TenantId = Guid.NewGuid();
            var tenant = new Mock<ICurrentTenant>();
            tenant.SetupGet(x => x.TenantId).Returns(TenantId);
            tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);

            var identity = new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Casey Coordinator")], "Test");
            var accessor = new Mock<IHttpContextAccessor>();
            accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(identity) });

            Db = new OdipDbContext(
                new DbContextOptionsBuilder<OdipDbContext>()
                    .UseInMemoryDatabase(Guid.NewGuid().ToString())
                    .AddInterceptors(new AuditInterceptor(accessor.Object))
                    .Options,
                tenant.Object);
        }

        public ParticipantsController Participants =>
            new(Db, new StaffCompatibilityLinkService(Db), new ParticipantDocumentService(Db), new SafetyNoteSyncService(Db));

        public async Task<(Participant Participant, ParticipantOnboarding Onboarding)> SeedValidatedParticipantAsync()
        {
            var participant = new Participant
            {
                Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Jamie", LastName = "Rivers", PreferredName = "Jay",
                DateOfBirth = Dob, Gender = Gender.Female, NdisNumber = "431234567", FundingSource = ParticipantFundingSource.Ndis,
                PlanType = PlanType.SelfManaged, AddressStreet = "1 Example St", AddressSuburb = "Brisbane", AddressState = "QLD", AddressPostcode = "4000",
                Phone = "0400 000 000", IsDraft = true, IsActive = false, IntakeCompletedAt = DateTime.UtcNow,
            };
            var onboarding = new ParticipantOnboarding
            {
                Id = Guid.NewGuid(), TenantId = TenantId, ParticipantId = participant.Id,
                ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ProfileCompletedBy = "validator",
            };
            Db.AddRange(participant, onboarding);
            await Db.SaveChangesAsync();
            return (participant, onboarding);
        }

        public void Dispose() => Db.Dispose();
    }

    /// <summary>The personalDetails group as the Profile wizard sends it: every member, edited or not.</summary>
    private static PatchPersonalDetailsDto Details(
        string first = "Jamie", string last = "Rivers", DateOnly? dob = null, Gender? gender = Gender.Female) => new()
    {
        FirstName = first, LastName = last, PreferredName = "Jay", DateOfBirth = dob ?? Dob, Gender = gender, Phone = "0400 000 000",
    };

    private static PatchNdisPlanDto Plan(string? ndis = "431234567", ParticipantFundingSource funding = ParticipantFundingSource.Ndis,
        PlanType planType = PlanType.SelfManaged, string? organisation = null) => new()
    {
        NdisNumber = ndis, FundingSource = funding, PlanType = planType, FundingOrganisation = organisation,
    };

    private static async Task<OkObjectResult> PatchOkAsync(Caller caller, Guid id, PatchParticipantDto dto) =>
        Assert.IsType<OkObjectResult>((await caller.Participants.Patch(id, dto, CancellationToken.None)).Result);

    // ── History / audit ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Patch_CorrectingIntakeFields_IsRecordedInTheParticipantAuditTrail_TheHistoryTabReads()
    {
        using var caller = new Caller();
        var (participant, _) = await caller.SeedValidatedParticipantAsync();

        await PatchOkAsync(caller, participant.Id, new PatchParticipantDto
        {
            PersonalDetails = Details(last: "Rivera"),
            Address = new PatchAddressDto { AddressStreet = "1 Example St", AddressSuburb = "Brisbane", AddressState = "QLD", AddressPostcode = "4001" },
            NdisPlan = Plan(ndis: "431234568", planType: PlanType.PlanManaged),
        });

        var updated = await caller.Db.AuditLogs
            .Where(a => a.EntityType == nameof(Participant) && a.EntityId == participant.Id && a.Action == AuditAction.Updated)
            .SingleAsync();
        Assert.Equal("Casey Coordinator", updated.ChangedByName);
        var changes = JsonSerializer.Deserialize<List<JsonElement>>(updated.Changes)!
            .ToDictionary(c => c.GetProperty("Field").GetString()!, c => (Old: c.GetProperty("Old").GetString(), New: c.GetProperty("New").GetString()));
        Assert.Equal(("Rivers", "Rivera"), changes["LastName"]);
        Assert.Equal(("4000", "4001"), changes["AddressPostcode"]);
        Assert.Equal(("431234567", "431234568"), changes["NdisNumber"]);
        Assert.Contains("PlanType", changes.Keys);
        // Only what changed is recorded: the echoed-but-unchanged first name and street are not.
        Assert.DoesNotContain("FirstName", changes.Keys);
        Assert.DoesNotContain("AddressStreet", changes.Keys);

        // ...and the History tab's own endpoint (GET api/v1/audit/Participant/{id}) returns that entry.
        var history = await new AuditController(caller.Db, NullLogger<AuditController>.Instance)
            .GetAuditHistory("Participant", participant.Id, ct: CancellationToken.None);
        var body = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(history).Value);
        var entries = body.GetProperty("entries").EnumerateArray().ToList();
        var entry = Assert.Single(entries, e => e.GetProperty("Action").GetString() == "Updated");
        Assert.Contains(entry.GetProperty("Changes").EnumerateArray(), c => c.GetProperty("Field").GetString() == "LastName" && c.GetProperty("New").GetString() == "Rivera");
    }

    [Fact]
    public async Task Patch_WithNoOnboardingRow_StillAppliesTheCorrection()
    {
        using var caller = new Caller();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = caller.TenantId, FirstName = "Jamie", LastName = "Rivers", IsDraft = true };
        caller.Db.Participants.Add(participant);
        await caller.Db.SaveChangesAsync();

        await PatchOkAsync(caller, participant.Id, new PatchParticipantDto { PersonalDetails = Details(last: "Rivera") });

        Assert.Equal("Rivera", (await caller.Db.Participants.SingleAsync()).LastName);
        Assert.Empty(caller.Db.ParticipantOnboardings);
    }
}
