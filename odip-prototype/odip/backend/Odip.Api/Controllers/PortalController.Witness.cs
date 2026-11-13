using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

public partial class PortalController
{
    // ══════════════════════════════════════════════════════════════
    // WITNESS APPROVALS
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The caller's own pending witness requests — medication administrations AND incident reports
    /// (IN-7) where they were selected as the staff witness and haven't yet approved/declined,
    /// merged into one list ordered by CreatedAt and discriminated by
    /// <see cref="PortalWitnessRequestDto.SourceType"/>. Always 200s; an unlinked account gets an
    /// empty list, matching <see cref="GetMyShifts"/>'s never-500 convention. Non-breaking for the
    /// two existing consumers (AppLayout's sidebar badge, PortalShiftsPage's badge) — both only
    /// ever read <c>.length</c> on the combined list.
    /// </summary>
    [HttpGet("witness-requests")]
    public async Task<ActionResult<ApiResponse<List<PortalWitnessRequestDto>>>> GetWitnessRequests(CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(new List<PortalWitnessRequestDto>()));

        var medicationRequests = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .Where(a => a.WitnessUserId == staffId.Value && a.WitnessStatus == WitnessStatus.Pending)
            .ToListAsync(ct);

        var incidentRequests = await _db.IncidentWitnesses
            .Include(w => w.IncidentReport).ThenInclude(i => i!.InvolvedParticipant)
            .Include(w => w.IncidentReport).ThenInclude(i => i!.ReportedByUser)
            .Where(w => w.WitnessUserId == staffId.Value && w.WitnessStatus == WitnessStatus.Pending)
            .ToListAsync(ct);

        var merged = medicationRequests.Select(ToWitnessRequestDto)
            .Concat(incidentRequests.Select(ToIncidentWitnessRequestDto))
            .OrderBy(r => r.CreatedAt)
            .ToList();

        return Ok(ApiResponse<List<PortalWitnessRequestDto>>.Ok(merged));
    }

    /// <summary>
    /// Approves or declines one of the caller's own pending MEDICATION witness requests. Only the
    /// named witness (matched on their own resolved StaffId, exactly like <see cref="GetShiftDetail"/>
    /// scopes shifts) may act on it — not linked, request not found, and request belongs to
    /// someone else all 404 identically for the same reason documented on the class. Unchanged by
    /// IN-7 — incident witness requests use the separate endpoints below.
    /// </summary>
    [HttpPost("witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Approved, ct);

    [HttpPost("witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineWitnessRequest(Guid id, CancellationToken ct) =>
        RespondToWitnessRequestAsync(id, WitnessStatus.Declined, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToWitnessRequestAsync(
        Guid id, WitnessStatus response, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var admin = await _db.MedicationAdministrations
            .Include(a => a.Participant)
            .Include(a => a.ParticipantMedication)
            .FirstOrDefaultAsync(a => a.Id == id && a.WitnessUserId == staffId.Value, ct);
        if (admin == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (admin.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        admin.WitnessStatus = response;
        admin.WitnessRespondedAt = DateTime.UtcNow;
        admin.UpdatedAt = DateTime.UtcNow;

        // Item 9: approving or declining closes the MedicationWitness obligation task either way
        // — the sign-off has happened, whichever way it went.
        await _obligationTasks.CompleteAsync($"med-witness:{admin.Id}", ct);

        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToWitnessRequestDto(admin)));
    }

    /// <summary>
    /// IN-7: approves or declines one of the caller's own pending INCIDENT witness requests, with
    /// an optional witness statement. Same "only the named witness, 404 for anything not yours"
    /// anti-enumeration shape as <see cref="RespondToWitnessRequestAsync"/> — matched against
    /// <see cref="Entities.IncidentWitness.WitnessUserId"/> instead of the medication FK.
    /// </summary>
    [HttpPost("incident-witness-requests/{id:guid}/approve")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> ApproveIncidentWitnessRequest(
        Guid id, [FromBody] PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct) =>
        RespondToIncidentWitnessRequestAsync(id, WitnessStatus.Approved, dto, ct);

    [HttpPost("incident-witness-requests/{id:guid}/decline")]
    public Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> DeclineIncidentWitnessRequest(
        Guid id, [FromBody] PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct) =>
        RespondToIncidentWitnessRequestAsync(id, WitnessStatus.Declined, dto, ct);

    private async Task<ActionResult<ApiResponse<PortalWitnessRequestDto>>> RespondToIncidentWitnessRequestAsync(
        Guid id, WitnessStatus response, PortalRespondIncidentWitnessRequestDto? dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        var witness = await _db.IncidentWitnesses
            .Include(w => w.IncidentReport).ThenInclude(i => i!.InvolvedParticipant)
            .Include(w => w.IncidentReport).ThenInclude(i => i!.ReportedByUser)
            .FirstOrDefaultAsync(w => w.Id == id && w.WitnessUserId == staffId.Value, ct);
        if (witness == null)
            return NotFound(ApiResponse<PortalWitnessRequestDto>.Fail("Witness request not found."));

        if (witness.WitnessStatus != WitnessStatus.Pending)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        // Checked before any write; the column holds StatementMaxLength characters.
        var statement = dto?.StatementText?.Trim();
        if (statement is { Length: > IncidentWitness.StatementMaxLength })
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("Keep the statement to 4,000 characters or fewer."));

        // Two answers at once both read Pending above: only the one that flips the row from Pending wins.
        // EF InMemory (the unit tests) has no ExecuteUpdate and no concurrent callers, so the check above stands alone there.
        // The flip commits only with the saves below: a 409 or an error rolls it back, so the retry is not told it already answered.
        await using var tx = _db.Database.IsRelational() ? await _db.Database.BeginTransactionAsync(ct) : null;
        if (_db.Database.IsRelational()
            && await _db.IncidentWitnesses.Where(w => w.Id == id && w.WitnessStatus == WitnessStatus.Pending)
                .ExecuteUpdateAsync(u => u.SetProperty(w => w.WitnessStatus, response), ct) != 1)
            return BadRequest(ApiResponse<PortalWitnessRequestDto>.Fail("This witness request has already been responded to."));

        witness.WitnessStatus = response;
        witness.WitnessRespondedAt = DateTime.UtcNow;
        // Never overwrite a previously-typed statement with null when the caller omits it.
        if (!string.IsNullOrWhiteSpace(statement))
            witness.StatementText = statement;
        // So an editor's form loaded before this answer is refused (409) instead of deleting it.
        witness.IncidentReport!.UpdatedAt = DateTime.UtcNow;
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException e)
        {
            // An editor saved the incident since it was read (UpdatedAt is its concurrency token). The answer stands whatever they changed: take the stored version and stamp again.
            foreach (var entry in e.Entries.Where(x => x.Entity is IncidentReport)) await entry.ReloadAsync(ct);
            witness.IncidentReport.UpdatedAt = DateTime.UtcNow;
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict(ApiResponse<PortalWitnessRequestDto>.Fail("This incident changed while you were answering. Please send your answer again."));
            }
        }
        if (tx != null) await tx.CommitAsync(ct);

        return Ok(ApiResponse<PortalWitnessRequestDto>.Ok(ToIncidentWitnessRequestDto(witness)));
    }

    private static PortalWitnessRequestDto ToWitnessRequestDto(MedicationAdministration a) => new(
        Id: a.Id,
        SourceType: "Medication",
        ParticipantId: a.ParticipantId,
        ParticipantName: a.Participant?.FullName ?? string.Empty,
        MedicationId: a.ParticipantMedicationId,
        MedicationName: a.ParticipantMedication?.Name ?? string.Empty,
        Strength: a.ParticipantMedication?.Strength,
        DoseDescription: a.ParticipantMedication?.DoseDescription ?? string.Empty,
        DoseGiven: a.DoseGiven,
        IncidentReportId: null,
        IncidentTitle: null,
        IncidentType: null,
        IncidentSeverity: null,
        RecordedByName: a.RecordedByName,
        AdministeredAt: a.AdministeredAt,
        AdministeredAtTimeZone: a.AdministeredAtTimeZone,
        IncidentDateTime: null,
        WitnessStatus: a.WitnessStatus,
        WitnessRespondedAt: a.WitnessRespondedAt,
        CreatedAt: a.CreatedAt);

    /// <summary>IN-7: incident-side counterpart to <see cref="ToWitnessRequestDto(MedicationAdministration)"/> —
    /// see the merge in <see cref="GetWitnessRequests"/>.</summary>
    private static PortalWitnessRequestDto ToIncidentWitnessRequestDto(IncidentWitness w) => new(
        Id: w.Id,
        SourceType: "Incident",
        ParticipantId: w.IncidentReport.InvolvedParticipantId ?? Guid.Empty,
        ParticipantName: w.IncidentReport.InvolvedParticipant?.FullName ?? string.Empty,
        MedicationId: null,
        MedicationName: null,
        Strength: null,
        DoseDescription: null,
        DoseGiven: null,
        IncidentReportId: w.IncidentReportId,
        IncidentTitle: w.IncidentReport.Title,
        IncidentType: w.IncidentReport.IncidentType,
        IncidentSeverity: w.IncidentReport.Severity,
        RecordedByName: w.IncidentReport.ReportedByUser?.FullName ?? string.Empty,
        AdministeredAt: null,
        AdministeredAtTimeZone: null,
        IncidentDateTime: w.IncidentReport.IncidentDateTime,
        WitnessStatus: w.WitnessStatus,
        WitnessRespondedAt: w.WitnessRespondedAt,
        CreatedAt: w.CreatedAt);
}
