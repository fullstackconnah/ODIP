using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// My account: the signed-in person's own name and mobile. The row is found by the id in the sign-in claim and nothing else: never the body, never
/// the route, never a SuperAdmin's view-as. The lookup crosses the tenant filter because it is by that one id, so a SuperAdmin acting in another
/// organisation still edits their own row.
/// </summary>
[ApiController]
// Every action names its own roles: the class alone admits any signed-in user. These are the roles that can open Settings.
[Authorize]
[Route("api/v1/profile")]
public class ProfileController : ControllerBase
{
    public const string EmploymentHeroOwnsProfile = "EmploymentHeroOwnsProfile";
    private const int NameMax = 100, MobileMax = 20; // the same limits the Employment Hero sync applies (EmploymentHeroStaffSync)
    private static readonly Regex MobileShape = new(@"^[0-9 +()\-]+$");

    private readonly OdipDbContext _db;
    public ProfileController(OdipDbContext db) { _db = db; }

    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<MyProfileDto>>> Get(CancellationToken ct)
    {
        var me = await MeAsync(ct);
        return me is null ? NotFound(ApiResponse<MyProfileDto>.Fail("Profile not found.")) : Ok(ApiResponse<MyProfileDto>.Ok(ToDto(me)));
    }

    [HttpPut]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<MyProfileDto>>> Update([FromBody] UpdateMyProfileDto dto, CancellationToken ct)
    {
        var me = await MeAsync(ct);
        if (me is null) return NotFound(ApiResponse<MyProfileDto>.Fail("Profile not found."));

        var first = (dto.FirstName ?? "").Trim();
        var last = (dto.LastName ?? "").Trim();
        var mobile = string.IsNullOrWhiteSpace(dto.Mobile) ? null : dto.Mobile.Trim();

        var errors = new List<string>();
        if (first.Length is 0 or > NameMax) errors.Add(first.Length == 0 ? "Enter your first name." : $"Enter a first name of up to {NameMax} characters.");
        if (last.Length is 0 or > NameMax) errors.Add(last.Length == 0 ? "Enter your last name." : $"Enter a last name of up to {NameMax} characters.");
        if (mobile is not null && (mobile.Length > MobileMax || !MobileShape.IsMatch(mobile)))
            errors.Add($"Enter a mobile number of up to {MobileMax} characters, using digits, spaces and + ( ) -.");
        if (errors.Count > 0) return BadRequest(ApiResponse<MyProfileDto>.Fail(errors));

        var changed = first != me.FirstName || last != me.LastName || mobile != me.Mobile;
        // The Employment Hero sync sets a linked person's name every run and their mobile whenever it has one, so an edit would silently revert.
        if (changed && me.ExternalPayrollId is not null)
            return Conflict(ApiResponse<MyProfileDto>.Fail("Employment Hero now keeps your name and mobile up to date.", EmploymentHeroOwnsProfile));

        if (changed)
        {
            me.FirstName = first;
            me.LastName = last;
            me.Mobile = mobile;
            me.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
        return Ok(ApiResponse<MyProfileDto>.Ok(ToDto(me)));
    }

    private Task<User?> MeAsync(CancellationToken ct) =>
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id)
            ? _db.Users.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(u => u.Id == id && u.IsActive, ct)
            : Task.FromResult<User?>(null);

    private static MyProfileDto ToDto(User u) => new()
    {
        FirstName = u.FirstName, LastName = u.LastName, Email = u.Email, Mobile = u.Mobile, ManagedByEmploymentHero = u.ExternalPayrollId is not null,
    };
}
