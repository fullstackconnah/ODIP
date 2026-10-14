using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>Agreement PR 2 (D9): the organisation's service agreements across participants. The tenant query filters scope every read to the caller's organisation.</summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/service-agreements")]
public class ServiceAgreementsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ServiceAgreementsController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The agreements ending within 60 days, or ended with no successor approved, of the participants who can receive services (the aggregate alerts' rule), soonest end first: the Participants register's Agreements ending view.</summary>
    [HttpGet("ending")]
    public async Task<ActionResult<ApiResponse<List<AgreementEndingDto>>>> Ending(CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var participants = await _db.Participants.AsNoTracking().Where(Participant.CanReceiveServicesRule)
            .Select(p => new Participant { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName })
            .ToDictionaryAsync(p => p.Id, ct);
        var rows = await AgreementEnding.FindAsync(_db, participants.Keys, today, ct);
        return Ok(ApiResponse<List<AgreementEndingDto>>.Ok(rows.Select(r => new AgreementEndingDto
        {
            ParticipantId = r.ParticipantId, ParticipantName = participants[r.ParticipantId].FullName, DraftId = r.DraftId, Version = r.Version,
            AgreementEndDate = r.AgreementEndDate, DaysLeft = r.DaysLeft, RenewalVersion = r.RenewalVersion, Status = AgreementEnding.Describe(r),
        }).ToList()));
    }
}
