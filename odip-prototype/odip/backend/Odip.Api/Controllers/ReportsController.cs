using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/reports")]
public class ReportsController : ControllerBase
{
    public const int MaxDays = 366;
    public const string RangeMessage = "Choose a range of 366 days or fewer, with the start before the end.";
    public const string ChooseOrganisation = "Choose an organisation to view as first: reports belong to one organisation.";

    public ReportsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null) { }

    [HttpGet("hours-by-worker")]
    public Task<ActionResult<ApiResponse<List<HoursByWorkerRowDto>>>> HoursByWorker([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Task.FromResult<ActionResult<ApiResponse<List<HoursByWorkerRowDto>>>>(Ok(ApiResponse<List<HoursByWorkerRowDto>>.Ok([])));

    [HttpGet("shift-fulfilment")]
    public Task<ActionResult<ApiResponse<List<ShiftFulfilmentWeekDto>>>> ShiftFulfilment([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Task.FromResult<ActionResult<ApiResponse<List<ShiftFulfilmentWeekDto>>>>(Ok(ApiResponse<List<ShiftFulfilmentWeekDto>>.Ok([])));

    [HttpGet("leave-taken")]
    public Task<ActionResult<ApiResponse<List<LeaveTakenRowDto>>>> LeaveTaken([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        Task.FromResult<ActionResult<ApiResponse<List<LeaveTakenRowDto>>>>(Ok(ApiResponse<List<LeaveTakenRowDto>>.Ok([])));
}
