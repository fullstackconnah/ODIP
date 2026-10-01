using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Services;

namespace Odip.Api.Services;

/// <summary>
/// Maps a <see cref="RecordAdministrationResult"/> to the HTTP response, so the general
/// <c>POST medications/{id}/administrations</c> and the shift package's portal endpoint answer identically:
/// 200 created or replayed, 404 unknown medication, 400 validation, 403 no Medication Competency (Enforce mode), 409 slot
/// already recorded (with the active record as <c>data</c>), 422 charted too early or a time outside the allowed range.
/// </summary>
public static class RecordAdministrationResultExtensions
{
    public static ActionResult ToActionResult(this RecordAdministrationResult result, ControllerBase controller)
    {
        switch (result.Outcome)
        {
            case RecordAdministrationOutcome.Created:
            case RecordAdministrationOutcome.Replayed:
                return controller.Ok(ApiResponse<AdministrationDto>.Ok(result.Administration!));

            case RecordAdministrationOutcome.NotFound:
                return controller.NotFound(ApiResponse<AdministrationDto>.Fail(result.Message!));

            case RecordAdministrationOutcome.CompetencyRequired:
                return controller.StatusCode(StatusCodes.Status403Forbidden,
                    ApiResponse<AdministrationDto>.Fail(result.Message!, result.Code!));

            case RecordAdministrationOutcome.TimeRejected:
                return controller.UnprocessableEntity(ApiResponse<AdministrationDto>.Fail(result.Message!, result.Code!));

            case RecordAdministrationOutcome.AlreadyRecorded:
            {
                var body = ApiResponse<AdministrationDto>.Fail(result.Administration!, new List<string> { result.Message! });
                body.Code = result.Code;
                return controller.Conflict(body);
            }

            default: // Invalid
                return controller.BadRequest(result.Code is null
                    ? ApiResponse<AdministrationDto>.Fail(result.Message!)
                    : ApiResponse<AdministrationDto>.Fail(result.Message!, result.Code));
        }
    }
}
