using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/vehicles")]
public class VehiclesController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant? _tenant;

    public const string ChooseOrganisation = "Choose an organisation to view as first: a vehicle belongs to one organisation.";

    // shortcut: a null tenant (unit tests only; DI always supplies one) skips the no-organisation refusal in Create.
    public VehiclesController(OdipDbContext db, ICurrentTenant? tenant = null)
    {
        _db = db;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<VehicleListDto>>>> GetAll(
        [FromQuery] bool? isActive, CancellationToken ct)
    {
        var query = _db.Vehicles.OrderBy(v => v.VehicleName).AsQueryable();
        if (isActive.HasValue) query = query.Where(v => v.IsActive == isActive.Value);

        var items = await query
            .Select(v => new VehicleListDto
            {
                Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
                VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
                WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
                IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
                RegistrationDueDate = v.RegistrationDueDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<VehicleListDto>>.Ok(items));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> GetById(Guid id, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<VehicleDetailDto>.Fail("Vehicle not found"));

        return Ok(ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> Create([FromBody] CreateVehicleDto dto, CancellationToken ct)
    {
        if (_tenant is { TenantId: null }) return BadRequest(ApiResponse<VehicleDetailDto>.Fail(ChooseOrganisation));
        var v = new Vehicle
        {
            Id = Guid.NewGuid(), VehicleName = dto.VehicleName, Registration = dto.Registration,
            VehicleType = dto.VehicleType, TotalSeats = dto.TotalSeats, WheelchairPositions = dto.WheelchairPositions,
            RampHoistDetails = dto.RampHoistDetails, DriverRequirements = dto.DriverRequirements,
            IsInternal = dto.IsInternal, IsActive = dto.IsActive, ServiceDueDate = dto.ServiceDueDate,
            RegistrationDueDate = dto.RegistrationDueDate, Notes = dto.Notes
        };
        _db.Vehicles.Add(v);
        await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(GetById), new { id = v.Id }, ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<VehicleDetailDto>>> Update(Guid id, [FromBody] UpdateVehicleDto dto, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<VehicleDetailDto>.Fail("Vehicle not found"));

        v.VehicleName = dto.VehicleName; v.Registration = dto.Registration; v.VehicleType = dto.VehicleType;
        v.TotalSeats = dto.TotalSeats; v.WheelchairPositions = dto.WheelchairPositions;
        v.RampHoistDetails = dto.RampHoistDetails; v.DriverRequirements = dto.DriverRequirements;
        v.IsInternal = dto.IsInternal; v.ServiceDueDate = dto.ServiceDueDate;
        v.RegistrationDueDate = dto.RegistrationDueDate; v.Notes = dto.Notes; v.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<VehicleDetailDto>.Ok(new VehicleDetailDto
        {
            Id = v.Id, VehicleName = v.VehicleName, Registration = v.Registration,
            VehicleType = v.VehicleType, TotalSeats = v.TotalSeats,
            WheelchairPositions = v.WheelchairPositions, IsInternal = v.IsInternal,
            IsActive = v.IsActive, ServiceDueDate = v.ServiceDueDate,
            RegistrationDueDate = v.RegistrationDueDate, RampHoistDetails = v.RampHoistDetails,
            DriverRequirements = v.DriverRequirements, Notes = v.Notes
        }));
    }

    /// <summary>Archive (soft-delete) a vehicle.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<bool>.Fail("Vehicle not found"));
        v.IsActive = false; v.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Vehicle archived"));
    }

    /// <summary>Restore an archived vehicle. Only IsActive changes: the list row the Archived view holds lacks the notes and access details, so a PUT of it wiped them (TRIPS-2).</summary>
    [HttpPost("{id:guid}/restore")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Restore(Guid id, CancellationToken ct)
    {
        var v = await _db.Vehicles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (v == null) return NotFound(ApiResponse<bool>.Fail("Vehicle not found"));
        v.IsActive = true; v.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true, "Vehicle restored"));
    }
}
