using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/provider-settings")]
public class ProviderSettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public ProviderSettingsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<ProviderSettingsDto>>> Get(CancellationToken ct)
    {
        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null) return Ok(ApiResponse<ProviderSettingsDto?>.Ok(null));

        return Ok(ApiResponse<ProviderSettingsDto>.Ok(new ProviderSettingsDto
        {
            Id = s.Id, RegistrationNumber = s.RegistrationNumber, ABN = s.ABN,
            OrganisationName = s.OrganisationName, Address = s.Address,
            GSTRegistered = s.GSTRegistered, IsPaceProvider = s.IsPaceProvider,
            BankAccountName = s.BankAccountName, BSB = s.BSB,
            AccountNumber = s.AccountNumber, InvoiceFooterNotes = s.InvoiceFooterNotes,
            State = s.State
        }));
    }

    [HttpPut]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Upsert([FromBody] UpsertProviderSettingsDto dto, CancellationToken ct)
    {
        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new ProviderSettings { Id = Guid.NewGuid() };
            _db.ProviderSettings.Add(s);
        }

        s.RegistrationNumber = dto.RegistrationNumber; s.ABN = dto.ABN;
        s.OrganisationName = dto.OrganisationName; s.Address = dto.Address;
        s.GSTRegistered = dto.GSTRegistered; s.IsPaceProvider = dto.IsPaceProvider;
        s.BankAccountName = dto.BankAccountName; s.BSB = dto.BSB;
        s.AccountNumber = dto.AccountNumber; s.InvoiceFooterNotes = dto.InvoiceFooterNotes;
        s.State = dto.State;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
