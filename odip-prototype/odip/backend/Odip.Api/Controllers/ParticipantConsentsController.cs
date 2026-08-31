using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// INTAKE sub-wave B — nested CRUD for a participant's consent decisions
/// (<see cref="ParticipantConsent"/>). Unlike <see cref="ParticipantRiskEntriesController"/>
/// (a free-form add/remove list), consents are a FIXED enumerated set — one row per
/// <see cref="ConsentType"/> — so there is no Create/Delete here, only Get (which always returns
/// all seven types, synthesizing an unanswered placeholder for any type with no row yet) and an
/// upsert-by-type endpoint. This is the write path for ongoing edits from the participant detail
/// page; the wizard's initial/draft submissions instead go through
/// <see cref="ParticipantsController.UpsertConsentsAsync"/>, sharing the same upsert semantics
/// (see that method's doc for why Consents is read by both Create and Update, unlike RiskEntries/
/// ContactRoles).
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class ParticipantConsentsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ParticipantConsentsController(OdipDbContext db) => _db = db;

    [HttpGet("participants/{participantId:guid}/consents")]
    public async Task<ActionResult<ApiResponse<List<ParticipantConsentDto>>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists) return NotFound(ApiResponse<List<ParticipantConsentDto>>.Fail("Participant not found"));

        var existing = await _db.ParticipantConsents.Where(c => c.ParticipantId == participantId).ToListAsync(ct);
        return Ok(ApiResponse<List<ParticipantConsentDto>>.Ok(MaterializeAll(participantId, existing)));
    }

    [HttpPut("participants/{participantId:guid}/consents/{consentType}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ParticipantConsentDto>>> Upsert(
        Guid participantId, string consentType, [FromBody] UpsertParticipantConsentDto dto, CancellationToken ct)
    {
        if (!Enum.TryParse<ConsentType>(consentType, ignoreCase: true, out var type))
            return BadRequest(ApiResponse<ParticipantConsentDto>.Fail("Unrecognised consent type."));

        var participant = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participant) return NotFound(ApiResponse<ParticipantConsentDto>.Fail("Participant not found"));

        var row = await _db.ParticipantConsents.FirstOrDefaultAsync(c => c.ParticipantId == participantId && c.ConsentType == type, ct);
        if (row == null)
        {
            row = new ParticipantConsent { Id = Guid.NewGuid(), ParticipantId = participantId, ConsentType = type };
            _db.ParticipantConsents.Add(row);
        }

        ApplyAnswer(row, dto.Granted, dto.SignedByName, dto.SignedDate);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<ParticipantConsentDto>.Ok(ToDto(row)));
    }

    // ── Helpers ────────────────────────────────────────────────────

    /// <summary>
    /// Sets a consent row's answer, re-stamping <see cref="ParticipantConsent.RecordedAt"/> only
    /// when <see cref="ParticipantConsent.Granted"/> actually changes — a compliance timestamp
    /// should track when the decision was (re-)made, not get bumped on every unrelated save of
    /// the same still-true/still-false answer.
    /// </summary>
    internal static void ApplyAnswer(ParticipantConsent row, bool? granted, string? signedByName, DateOnly? signedDate)
    {
        if (row.Granted != granted)
            row.RecordedAt = granted.HasValue ? DateTime.UtcNow : null;
        row.Granted = granted;
        // Signed-by/date are only meaningful once granted — see the wizard/detail-page UI, which
        // only ever shows them in that state — but not hard-enforced here either way (a caller may
        // record ahead of a formal signature pass, per ParticipantConsent's type doc).
        row.SignedByName = string.IsNullOrWhiteSpace(signedByName) ? null : signedByName.Trim();
        row.SignedDate = signedDate;
        row.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Every <see cref="ConsentType"/>, in declaration order, backed by <paramref name="existingRows"/>
    /// where a row exists and a synthesized (Id = null, Granted = null) placeholder otherwise.</summary>
    internal static List<ParticipantConsentDto> MaterializeAll(Guid participantId, List<ParticipantConsent> existingRows)
    {
        var byType = existingRows.ToDictionary(c => c.ConsentType);
        return Enum.GetValues<ConsentType>()
            .Select(t => byType.TryGetValue(t, out var row)
                ? ToDto(row)
                : new ParticipantConsentDto { ParticipantId = participantId, ConsentType = t })
            .ToList();
    }

    private static ParticipantConsentDto ToDto(ParticipantConsent c) => new()
    {
        Id = c.Id,
        ParticipantId = c.ParticipantId,
        ConsentType = c.ConsentType,
        Granted = c.Granted,
        RecordedAt = c.RecordedAt,
        SignedByName = c.SignedByName,
        SignedDate = c.SignedDate,
        CreatedAt = c.CreatedAt,
        UpdatedAt = c.UpdatedAt,
    };
}
