using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Rostering;

/// <summary>
/// Maps a <see cref="ShiftCompletion"/> to its DTO, resolving submitter/reviewer display names —
/// shared by <see cref="Odip.Api.Controllers.PortalController"/> (Start/Finish/detail) and
/// <see cref="Odip.Api.Controllers.RosteringController"/> (completions list/detail/approve/return)
/// so the two controllers can't drift. Same pattern as <see cref="RosterGate"/>.
/// </summary>
public static class ShiftCompletionMapper
{
    public static async Task<ShiftCompletionDto> ToDtoAsync(OdipDbContext db, ShiftCompletion c, CancellationToken ct)
    {
        var submittedBy = await db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
        User? reviewedBy = c.ReviewedByUserId.HasValue
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
            : null;

        return new ShiftCompletionDto(
            c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
            c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
            c.StartedAt, c.SubmittedAt,
            c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
            c.VarianceMinutesStart, c.VarianceMinutesEnd);
    }
}
