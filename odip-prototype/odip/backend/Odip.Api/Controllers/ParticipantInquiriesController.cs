using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
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

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ParticipantInquiryDto>>>> GetAll(CancellationToken ct) =>
        Ok(ApiResponse<List<ParticipantInquiryDto>>.Ok((await _db.ParticipantInquiries.OrderByDescending(x => x.CreatedAt).ToListAsync(ct)).Select(ToDto).ToList()));

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Create(CreateParticipantInquiryDto dto, CancellationToken ct)
    {
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = dto.FirstName.Trim(), LastName = dto.LastName.Trim(), Phone = dto.Phone, Email = dto.Email, Source = dto.Source, Provenance = dto.Provenance };
        _db.ParticipantInquiries.Add(inquiry);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Update(Guid id, UpdateParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (!Sources.Contains(dto.Source)) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("Source must be Web, Email, or Phone."));
        inquiry.FirstName = dto.FirstName.Trim(); inquiry.LastName = dto.LastName.Trim(); inquiry.Phone = dto.Phone; inquiry.Email = dto.Email; inquiry.Source = dto.Source; inquiry.Provenance = dto.Provenance; inquiry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpPost("{id:guid}/convert")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Convert(Guid id, ConvertParticipantInquiryDto dto, CancellationToken ct)
    {
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (inquiry.ParticipantId is null)
        {
            Participant? participant = null;
            if (dto.ParticipantId is Guid participantId)
            {
                participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
                if (participant == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Participant not found"));
            }
            else
            {
                participant = new Participant { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, FirstName = inquiry.FirstName, LastName = inquiry.LastName, Phone = inquiry.Phone, Email = inquiry.Email, IsActive = true, IsDraft = true };
                _db.Participants.Add(participant);
            }
            inquiry.ParticipantId = participant.Id;
            inquiry.UpdatedAt = DateTime.UtcNow;
            _db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = inquiry.TenantId, ParticipantId = participant.Id });
            await _db.SaveChangesAsync(ct);
        }
        else if (dto.ParticipantId is Guid requested && requested != inquiry.ParticipantId)
            return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry has already been converted."));
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ToDto(inquiry)));
    }

    [HttpGet("{id:guid}/onboarding")]
    public async Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> GetOnboarding(Guid id, CancellationToken ct)
    {
        var onboarding = await _db.ParticipantOnboardings.FirstOrDefaultAsync(x => x.ParticipantId == id, ct);
        if (onboarding == null) return NotFound(ApiResponse<ParticipantOnboardingDto>.Fail("Onboarding not found"));
        return Ok(ApiResponse<ParticipantOnboardingDto>.Ok(new ParticipantOnboardingDto { ParticipantId = onboarding.ParticipantId, ProfileComplete = onboarding.ProfileComplete, ProfileCompletedAt = onboarding.ProfileCompletedAt, ProfileCompletedBy = onboarding.ProfileCompletedBy, ServiceTypeConfirmed = onboarding.ServiceTypeConfirmed, ServiceTypeConfirmedAt = onboarding.ServiceTypeConfirmedAt, ServiceTypeConfirmedBy = onboarding.ServiceTypeConfirmedBy, ServiceAgreementSigned = onboarding.ServiceAgreementSigned, IsReady = onboarding.IsReady }));
    }

    private static ParticipantInquiryDto ToDto(ParticipantInquiry x) => new() { Id = x.Id, ParticipantId = x.ParticipantId, FirstName = x.FirstName, LastName = x.LastName, Phone = x.Phone, Email = x.Email, Source = x.Source, Provenance = x.Provenance, CreatedAt = x.CreatedAt };
}
