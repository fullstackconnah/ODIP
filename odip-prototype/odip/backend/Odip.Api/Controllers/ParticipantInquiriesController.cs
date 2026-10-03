using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/inquiries")]
public class ParticipantInquiriesController : ControllerBase
{
    private static readonly HashSet<string> Sources = new(StringComparer.Ordinal) { "Web", "Email", "Phone" };
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    public ParticipantInquiriesController(OdipDbContext db, ICurrentTenant tenant) { _db = db; _tenant = tenant; }
    private string Actor() => User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? User?.FindFirstValue("sub") ?? "unknown";

    /// <summary>
    /// The Enquiries tab's feed: every enquiry, plus every intake in progress that no enquiry started (see
    /// <see cref="ParticipantInquiryDto.IsDirectIntake"/>). The tab itself shows only the open ones.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ParticipantInquiryDto>>>> GetAll(CancellationToken ct)
    {
        var inquiries = await _db.ParticipantInquiries.Where(x => _tenant.TenantId == null || x.TenantId == _tenant.TenantId).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
        // Where each converted enquiry has got to, so the Enquiries tab can say "Draft intake" or "Intake complete" instead of offering
        // "Resume intake" for ever. One query for the page; the participants' own tenant filter applies.
        var participantIds = inquiries.Where(x => x.ParticipantId != null).Select(x => x.ParticipantId!.Value).Distinct().ToList();
        var states = participantIds.Count == 0
            ? new Dictionary<Guid, (bool IsDraft, bool IsActive, DateTime? IntakeCompletedAt)>()
            : (await _db.Participants.Where(p => participantIds.Contains(p.Id)).Select(p => new { p.Id, p.IsDraft, p.IsActive, p.IntakeCompletedAt }).ToListAsync(ct))
                .ToDictionary(p => p.Id, p => (p.IsDraft, p.IsActive, p.IntakeCompletedAt));
        var rows = inquiries.Select(x =>
            x.ParticipantId is Guid participantId && states.TryGetValue(participantId, out var state)
                ? ToDto(x) with { ParticipantIsDraft = state.IsDraft, ParticipantIsActive = state.IsActive, ParticipantIntakeCompletedAt = state.IntakeCompletedAt }
                : ToDto(x)).ToList();

        // A draft intake started in the Intake wizard (/participants/new) has no enquiry. It used to be reachable only through the register's
        // Drafts view; with that view gone it rides here so it is not lost. A draft an enquiry already links is that enquiry's row, never a second one.
        var direct = await ParticipantStages.DirectIntakes(_db, _db.Participants.Where(p => _tenant.TenantId == null || p.TenantId == _tenant.TenantId))
            .Select(p => new { p.Id, p.FirstName, p.LastName, p.Phone, p.Email, p.IsActive, p.CreatedAt })
            .ToListAsync(ct);
        rows.AddRange(direct.Select(p => new ParticipantInquiryDto
        {
            Id = p.Id, ParticipantId = p.Id, FirstName = p.FirstName, LastName = p.LastName, Phone = p.Phone, Email = p.Email, CreatedAt = p.CreatedAt,
            ParticipantIsDraft = true, ParticipantIsActive = p.IsActive, ParticipantIntakeCompletedAt = null, IsDirectIntake = true,
        }));
        return Ok(ApiResponse<List<ParticipantInquiryDto>>.Ok(rows.OrderByDescending(x => x.CreatedAt).ToList()));
    }

    /// <summary>
    /// The Onboarding tab: every participant of the tenant who is in onboarding, whether or not an enquiry started them and whether or not
    /// a <see cref="ParticipantOnboarding"/> row exists. It used to list the rows (an inner join), so a participant whose intake was
    /// completed before completion created one never appeared, while active and archived participants and intakes still open, which
    /// all have rows, did. A participant with no row is listed with a blank checklist.
    /// </summary>
    [HttpGet("onboarding-worklist")]
    public async Task<ActionResult<ApiResponse<List<ParticipantOnboardingWorklistDto>>>> GetOnboardingWorklist(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Fail("A tenant context is required."));
        var participants = await ParticipantStages.InOnboarding(_db.Participants.Where(p => p.TenantId == tenantId)).OrderByDescending(p => p.UpdatedAt).ToListAsync(ct);
        var ids = participants.Select(p => p.Id).ToList();
        var stored = ids.Count == 0
            ? new List<ParticipantOnboarding>()
            : await _db.ParticipantOnboardings.Where(o => o.TenantId == tenantId && ids.Contains(o.ParticipantId)).ToListAsync(ct);
        var rowsByParticipant = stored.GroupBy(o => o.ParticipantId).ToDictionary(g => g.Key, g => g.First());
        var result = new List<ParticipantOnboardingWorklistDto>();
        foreach (var p in participants)
        {
            var detail = await BuildDetail(p, rowsByParticipant.GetValueOrDefault(p.Id) ?? BlankOnboarding(p), ct);
            if (detail.IsReady) continue;
            var completed = (detail.IntakeComplete ? 1 : 0) + (detail.ProfileComplete ? 1 : 0) + (detail.ServiceTypeConfirmed ? 1 : 0) + (detail.ServiceAgreementSigned ? 1 : 0);
            var action = !detail.IntakeComplete ? "Complete intake" : !detail.ProfileComplete ? "Validate profile essentials" : !detail.ServiceTypeConfirmed ? "Confirm service needs" : "Review agreement evidence";
            result.Add(new ParticipantOnboardingWorklistDto { ParticipantId = p.Id, FullName = p.FullName, Stage = !detail.IntakeComplete ? "Intake incomplete" : "Onboarding incomplete", NextAction = action, CompletedSteps = completed, Reasons = detail.Reasons });
        }
        return Ok(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Ok(result));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Create(CreateParticipantInquiryDto dto, CancellationToken ct)
    {
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = dto.FirstName.Trim(), LastName = dto.LastName.Trim(), Phone = Blank(dto.Phone), Email = Blank(dto.Email), Source = dto.Source, Provenance = Blank(dto.Provenance) };
        _db.ParticipantInquiries.Add(inquiry); await _db.SaveChangesAsync(ct); return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Update(Guid id, UpdateParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        inquiry.FirstName = dto.FirstName.Trim(); inquiry.LastName = dto.LastName.Trim(); inquiry.Phone = Blank(dto.Phone); inquiry.Email = Blank(dto.Email); inquiry.Source = dto.Source; inquiry.Provenance = Blank(dto.Provenance); inquiry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpPost("{id:guid}/convert")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Convert(Guid id, ConvertParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (inquiry.ParticipantId is null)
        {
            Participant? participant = null;
            if (dto.ParticipantId is Guid participantId) { participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct); if (participant == null || participant.TenantId != inquiry.TenantId) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Participant not found")); }
            else { participant = new Participant { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, FirstName = inquiry.FirstName, LastName = inquiry.LastName, Phone = inquiry.Phone, Email = inquiry.Email, IsActive = false, IsDraft = true }; _db.Participants.Add(participant); }
            inquiry.ParticipantId = participant.Id; inquiry.UpdatedAt = DateTime.UtcNow;
            if (!await _db.ParticipantOnboardings.AnyAsync(x => x.ParticipantId == participant.Id, ct)) _db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, ParticipantId = participant.Id });
            await _db.SaveChangesAsync(ct);
        }
        else if (dto.ParticipantId is Guid requested && requested != inquiry.ParticipantId) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry has already been converted."));
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpGet("{id:guid}/onboarding")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> GetOnboarding(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, storeMissingRow: false, ct);
        if (onboarding == null || participant == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, onboarding, ct)));
    }

    // No boolean is accepted. This server validates currently saved canonical profile fields and records actor/time.
    [HttpPost("{id:guid}/onboarding/profile-validation")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> ValidateProfile(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, storeMissingRow: true, ct);
        if (participant == null || onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        var missing = ProfileMissing(participant);
        if (missing.Count > 0) return BadRequest(ApiResponse<ParticipantOnboardingDto>.Fail(string.Join(" ", missing)));
        var saved = await RecordAndSaveAsync(participant, onboarding, row => row.RecordProfileValidation(Actor(), DateTime.UtcNow), ct);
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, saved, ct)));
    }

    // Confirmation is only recorded against an existing draft with dated, catalogue-resolved provisional lines.
    [HttpPost("{id:guid}/onboarding/service-needs-confirmation")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> ConfirmServiceNeeds(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, storeMissingRow: true, ct);
        if (participant == null || onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        var currentDraft = await CurrentValidDraftAsync(participant, ct);
        if (currentDraft == null) return BadRequest(ApiResponse<ParticipantOnboardingDto>.Fail("Create a current dated provisional service-agreement draft with valid catalogue-priced support lines first."));
        var saved = await RecordAndSaveAsync(participant, onboarding, row => row.RecordServiceNeedsConfirmation(Actor(), DateTime.UtcNow), ct);
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, saved, ct)));
    }

    /// <summary>
    /// Records a checklist step and saves it. A participant in onboarding who has no stored row gets one added by <see cref="FindOwnedAsync"/>, and two requests
    /// can both find none: the unique index on the participant rejects the second insert. That is no error for the caller, because the row exists by then, so the
    /// request that lost drops its insert, reloads the winner's row, records the step on it and saves once more (its step is not lost). Returns the row that was saved.
    /// </summary>
    private async Task<ParticipantOnboarding> RecordAndSaveAsync(Participant participant, ParticipantOnboarding onboarding, Action<ParticipantOnboarding> record, CancellationToken ct)
    {
        var inserting = _db.Entry(onboarding).State == EntityState.Added;
        record(onboarding);
        try
        {
            await _db.SaveChangesAsync(ct);
            return onboarding;
        }
        // The only insert in this save is the onboarding row, so a unique violation here is that row losing the race, not any other database failure.
        catch (DbUpdateException ex) when (inserting && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            _db.Entry(onboarding).State = EntityState.Detached;
            var winner = await _db.ParticipantOnboardings.FirstAsync(x => x.ParticipantId == participant.Id && x.TenantId == participant.TenantId, ct);
            record(winner);
            await _db.SaveChangesAsync(ct);
            return winner;
        }
    }

    /// <summary>
    /// The participant and their onboarding record, in the caller's tenant. A participant who is in onboarding (see
    /// <see cref="ParticipantStages.IsInOnboarding"/>) always has a checklist: when no row was ever stored (the worklist lists them anyway) a blank one is
    /// returned, and <paramref name="storeMissingRow"/> adds it to the context so the caller's own save persists it. Any other participant
    /// without a row (a legacy participant who never onboarded here) has no onboarding record: null.
    /// </summary>
    private async Task<(Participant? participant, ParticipantOnboarding? onboarding)> FindOwnedAsync(Guid id, bool storeMissingRow, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return (null, null);
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (participant == null) return (null, null);
        var onboarding = await _db.ParticipantOnboardings.FirstOrDefaultAsync(x => x.ParticipantId == id && x.TenantId == tenantId, ct);
        if (onboarding == null && ParticipantStages.IsInOnboarding(participant))
        {
            onboarding = BlankOnboarding(participant);
            if (storeMissingRow) _db.ParticipantOnboardings.Add(onboarding);
        }
        return (participant, onboarding);
    }

    /// <summary>A blank checklist for <paramref name="participant"/>, in the participant's own tenant. Not tracked until a caller adds it.</summary>
    private static ParticipantOnboarding BlankOnboarding(Participant participant) =>
        new() { Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id };

    private async Task<ParticipantOnboardingDto> BuildDetail(Participant participant, ParticipantOnboarding onboarding, CancellationToken ct)
    {
        var reasons = new List<string>();
        var intakeComplete = participant.IntakeCompletedAt != null;
        if (!intakeComplete) reasons.Add("Intake PDF completion is required.");
        if (!onboarding.ProfileComplete) reasons.AddRange(ProfileMissing(participant).DefaultIfEmpty("Profile essentials need server validation."));
        var newestDraft = await CurrentValidDraftAsync(participant, ct);
        // Drafts are immutable revisions, so a confirmation predating the current revision is stale.
        var serviceNeedsCurrent = newestDraft != null && onboarding.ServiceTypeConfirmed && onboarding.ServiceTypeConfirmedAt >= newestDraft.CreatedAt;
        if (!serviceNeedsCurrent) reasons.Add(newestDraft != null ? "Service needs require server confirmation for the current draft revision." : "A current dated provisional service-agreement draft with valid catalogue-priced support lines is required.");
        var evidenceVerified = newestDraft != null && await _db.ElectronicSigningSnapshots.AnyAsync(s => s.ParticipantId == participant.Id && s.DraftId == newestDraft.Id && s.DraftVersion == newestDraft.Version && _db.ElectronicSigningEvidence.Any(e => e.SnapshotId == s.Id && e.Status == "Verified"), ct);
        if (!evidenceVerified || !onboarding.ServiceAgreementSigned) reasons.Add("Current immutable agreement evidence is pending; the UnapprovedDraft source is not complete or eligible.");
        reasons.Add("The schedule is made when an agreement revision is approved for rostering, from its draft page; nothing is created from onboarding itself.");
        return new ParticipantOnboardingDto { ParticipantId = participant.Id, IntakeComplete = intakeComplete, ProfileComplete = onboarding.ProfileComplete, ProfileCompletedAt = onboarding.ProfileCompletedAt, ProfileCompletedBy = onboarding.ProfileCompletedBy, ServiceTypeConfirmed = serviceNeedsCurrent, ServiceTypeConfirmedAt = serviceNeedsCurrent ? onboarding.ServiceTypeConfirmedAt : null, ServiceTypeConfirmedBy = serviceNeedsCurrent ? onboarding.ServiceTypeConfirmedBy : null, ServiceAgreementSigned = onboarding.ServiceAgreementSigned, IsReady = false, Reasons = reasons };
    }

    private async Task<ServiceAgreementDraft?> CurrentValidDraftAsync(Participant participant, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines)
            .Where(x => x.ParticipantId == participant.Id && x.TenantId == participant.TenantId)
            .OrderByDescending(x => x.Version).FirstOrDefaultAsync(ct);
        if (draft == null || draft.PlanStartDate == default || draft.PlanEndDate == default || draft.AgreementStartDate == default || draft.AgreementEndDate == default
            || draft.PlanEndDate < draft.PlanStartDate || draft.AgreementEndDate < draft.AgreementStartDate
            || draft.AgreementStartDate < draft.PlanStartDate || draft.AgreementEndDate > draft.PlanEndDate
            || draft.Lines.Count == 0
            || draft.Lines.Any(line => line.Hours <= 0 || line.UnitPrice <= 0 || string.IsNullOrWhiteSpace(line.ItemCode) || string.IsNullOrWhiteSpace(line.CatalogueVersion)
                // A hand-typed line was priced on the agreement's start date, so its catalogue row has to be valid on it. A line the plan builder generated (it names its block) is priced on
                // the date of each shift: its row is the one valid on that shift, and when the plan crosses a catalogue price change that row starts after the agreement does.
                || (string.IsNullOrEmpty(line.BlockKey)
                    && (line.CatalogueEffectiveFrom > draft.AgreementStartDate || (line.CatalogueEffectiveTo != null && line.CatalogueEffectiveTo < draft.AgreementStartDate)))))
            return null;
        return draft;
    }

    private static List<string> ProfileMissing(Participant p)
    {
        var missing = new List<string>();
        if (string.IsNullOrWhiteSpace(p.FirstName) || string.IsNullOrWhiteSpace(p.LastName)) missing.Add("Profile requires identity (first and last name).");
        if (p.DateOfBirth == null) missing.Add("Profile requires date of birth.");
        if (p.Gender == null) missing.Add("Profile requires gender.");
        if (p.FundingSource == ParticipantFundingSource.Ndis && string.IsNullOrWhiteSpace(p.NdisNumber)) missing.Add("Profile requires an NDIS number for NDIS-funded participants.");
        return missing;
    }

    /// <summary>A form's "left blank" arrives as "" or spaces: store nothing, trimmed otherwise, never an empty string.</summary>
    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static ParticipantInquiryDto ToDto(ParticipantInquiry x) => new() { Id = x.Id, ParticipantId = x.ParticipantId, FirstName = x.FirstName, LastName = x.LastName, Phone = x.Phone, Email = x.Email, Source = x.Source, Provenance = x.Provenance, CreatedAt = x.CreatedAt };
}
