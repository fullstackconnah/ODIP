using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/profile")]
public class ProfileController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ProfileController(OdipDbContext db) { _db = db; }

    // STUBS for the red run.
    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public Task<ActionResult<ApiResponse<MyProfileDto>>> Get(CancellationToken ct) =>
        Task.FromResult<ActionResult<ApiResponse<MyProfileDto>>>(NotFound());

    [HttpPut]
    [EnableRateLimiting("api")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public Task<ActionResult<ApiResponse<MyProfileDto>>> Update([FromBody] UpdateMyProfileDto dto, CancellationToken ct) =>
        Task.FromResult<ActionResult<ApiResponse<MyProfileDto>>>(NotFound());
}
