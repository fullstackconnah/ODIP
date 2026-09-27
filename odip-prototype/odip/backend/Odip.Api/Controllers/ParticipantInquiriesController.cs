using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ParticipantInquiryDto>>>> GetAll(CancellationToken ct) =>
        Ok(ApiResponse<List<ParticipantInquiryDto>>.Ok((await _db.ParticipantInquiries.Where(x => _tenant.TenantId == null || x.TenantId == _tenant.TenantId).OrderByDescending(x => x.CreatedAt).ToListAsync(ct)).Select(ToDto).ToList()));

    [HttpGet("onboarding-worklist")]
    public async Task<ActionResult<ApiResponse<List<ParticipantOnboardingWorklistDto>>>> GetOnboardingWorklist(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Fail("A tenant context is required."));
        var rows = await (from p in _db.Participants join o in _db.ParticipantOnboardings on p.Id equals o.ParticipantId where p.TenantId == tenantId && o.TenantId == tenantId orderby p.UpdatedAt descending select new { p, o }).ToListAsync(ct);
        var result = new List<ParticipantOnboardingWorklistDto>();
        foreach (var row in rows)
        {
            var detail = await BuildDetail(row.p, row.o, ct);
            if (detail.IsReady) continue;
            var completed = (detail.IntakeComplete ? 1 : 0) + (detail.ProfileComplete ? 1 : 0) + (detail.ServiceTypeConfirmed ? 1 : 0) + (detail.ServiceAgreementSigned ? 1 : 0);
            var action = !detail.IntakeComplete ? "Complete intake" : !detail.ProfileComplete ? "Validate profile essentials" : !detail.ServiceTypeConfirmed ? "Confirm service needs" : "Review agreement evidence";
            result.Add(new ParticipantOnboardingWorklistDto { ParticipantId = row.p.Id, FullName = row.p.FullName, Stage = !detail.IntakeComplete ? "Intake incomplete" : "Onboarding incomplete", NextAction = action, CompletedSteps = completed, Reasons = detail.Reasons });
        }
        return Ok(ApiResponse<List<ParticipantOnboardingWorklistDto>>.Ok(result));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Create(CreateParticipantInquiryDto dto, CancellationToken ct)
    {
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = dto.FirstName.Trim(), LastName = dto.LastName.Trim(), Phone = dto.Phone, Email = dto.Email, Source = dto.Source, Provenance = dto.Provenance };
        _db.ParticipantInquiries.Add(inquiry); await _db.SaveChangesAsync(ct); return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Update(Guid id, UpdateParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && (_tenant.TenantId == null || x.TenantId == _tenant.TenantId), ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        inquiry.FirstName = dto.FirstName.Trim(); inquiry.LastName = dto.LastName.Trim(); inquiry.Phone = dto.Phone; inquiry.Email = dto.Email; inquiry.Source = dto.Source; inquiry.Provenance = dto.Provenance; inquiry.UpdatedAt = DateTime.UtcNow;
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
        var onboarding = await _db.ParticipantOnboardings.FirstOrDefaultAsync(x => x.ParticipantId == id, ct);
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (onboarding == null || participant == null || onboarding.TenantId != participant.TenantId) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, onboarding, ct)));
    }

    // No boolean is accepted. This server validates currently saved canonical profile fields and records actor/time.
    [HttpPost("{id:guid}/onboarding/profile-validation")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> ValidateProfile(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, ct);
        if (participant == null || onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        var missing = ProfileMissing(participant);
        if (missing.Count > 0) return BadRequest(ApiResponse<ParticipantOnboardingDto>.Fail(string.Join(" ", missing)));
        onboarding.RecordProfileValidation(Actor(), DateTime.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, onboarding, ct)));
    }

    // Confirmation is only recorded against an existing draft with dated, catalogue-resolved provisional lines.
    [HttpPost("{id:guid}/onboarding/service-needs-confirmation")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> ConfirmServiceNeeds(Guid id, CancellationToken ct)
    {
        var (participant, onboarding) = await FindOwnedAsync(id, ct);
        if (participant == null || onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        var currentDraft = await CurrentValidDraftAsync(participant, ct);
        if (currentDraft == null) return BadRequest(ApiResponse<ParticipantOnboardingDto>.Fail("Create a current dated provisional service-agreement draft with valid catalogue-priced support lines first."));
        onboarding.RecordServiceNeedsConfirmation(Actor(), DateTime.UtcNow);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(await BuildDetail(participant, onboarding, ct)));
    }

    private async Task<(Participant? participant, ParticipantOnboarding? onboarding)> FindOwnedAsync(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return (null, null);
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (participant == null) return (null, null);
        return (participant, await _db.ParticipantOnboardings.FirstOrDefaultAsync(x => x.ParticipantId == id && x.TenantId == tenantId, ct));
    }

    private async Task<ParticipantOnboardingDto> BuildDetail(Participant participant, ParticipantOnboarding onboarding, CancellationToken ct)
    {
        var reasons = new List<string>();
        var intakeComplete = participant.IntakeCompletedAt != null;
        if (!intakeComplete) reasons.Add("Intake PDF completion is required.");
        if (!onboarding.ProfileComplete) reasons.AddRange(ProfileMissing(participant).DefaultIfEmpty("Profile essentials need server validation."));
        var newestDraft = await CurrentValidDraftAsync(participant, ct);
        var serviceNeedsCurrent = newestDraft != null && onboarding.ServiceTypeConfirmed && onboarding.ServiceTypeConfirmedAt >= newestDraft.CreatedAt;
        if (!serviceNeedsCurrent) reasons.Add(newestDraft != null ? "Service needs require server confirmation for the current draft revision." : "A current dated provisional service-agreement draft with valid catalogue-priced support lines is required.");
        var evidenceVerified = newestDraft != null && await _db.ElectronicSigningSnapshots.AnyAsync(s => s.ParticipantId == participant.Id && s.DraftId == newestDraft.Id && s.DraftVersion == newestDraft.Version && _db.ElectronicSigningEvidence.Any(e => e.SnapshotId == s.Id && e.Status == "Verified"), ct);
        if (!evidenceVerified || !onboarding.ServiceAgreementSigned) reasons.Add("Current immutable agreement evidence is pending; the UnapprovedDraft source is not complete or eligible.");
        reasons.Add("Schedule review is proposal-only; no schedule coverage has been approved and no shifts are created here.");
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
            || !draft.Lines.Any(line => line.Hours > 0 && line.UnitPrice > 0 && !string.IsNullOrWhiteSpace(line.ItemCode) && !string.IsNullOrWhiteSpace(line.CatalogueVersion)
                && line.CatalogueEffectiveFrom <= draft.AgreementStartDate && (line.CatalogueEffectiveTo == null || line.CatalogueEffectiveTo >= draft.AgreementStartDate)))
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

    private static ParticipantInquiryDto ToDto(ParticipantInquiry x) => new() { Id = x.Id, ParticipantId = x.ParticipantId, FirstName = x.FirstName, LastName = x.LastName, Phone = x.Phone, Email = x.Email, Source = x.Source, Provenance = x.Provenance, CreatedAt = x.CreatedAt };
}
