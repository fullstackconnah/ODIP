using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/provider-settings")]
public class ProviderSettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant? _tenant;

    // The tenant is optional so existing call sites that only exercise the plain settings fields
    // keep working; DI always supplies it. Without one, the readiness mode cannot be changed.
    public ProviderSettingsController(OdipDbContext db, ICurrentTenant? tenant = null)
    {
        _db = db;
        _tenant = tenant;
    }

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
            State = s.State, ManagerName = s.ManagerName, ManagerPhone = s.ManagerPhone,
            ParticipantReadinessMode = s.ParticipantReadinessMode
        }));
    }

    [HttpPut]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Upsert([FromBody] UpsertProviderSettingsDto dto, CancellationToken ct)
    {
        // The readiness mode changes ONLY when the request carries it, so a client that does not
        // know about it (or a stale tab saving an unrelated field) can never revert it. Validate
        // before anything is touched, so a refused request writes nothing.
        if (dto.ParticipantReadinessMode is { } requestedMode)
        {
            if (!Enum.IsDefined(requestedMode))
                return BadRequest(ApiResponse<bool>.Fail("Unknown participant readiness mode. Use Warn or Enforce."));

            // The setting belongs to one organisation. A SuperAdmin with no view-as tenant has none
            // in scope (and the lookup below would land on an arbitrary organisation's row), so
            // they must pick one first. An Admin, or a SuperAdmin viewing as a tenant, always has one.
            if (_tenant?.TenantId is null)
                return BadRequest(ApiResponse<bool>.Fail(
                    "Choose an organisation to view as before changing the participant readiness check."));
        }

        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new ProviderSettings { Id = Guid.NewGuid() };
            _db.ProviderSettings.Add(s);
        }

        // A brand-new row starts at the default (Warn), which is what applied until now.
        var previousMode = s.ParticipantReadinessMode;

        s.RegistrationNumber = dto.RegistrationNumber; s.ABN = dto.ABN;
        s.OrganisationName = dto.OrganisationName; s.Address = dto.Address;
        s.GSTRegistered = dto.GSTRegistered; s.IsPaceProvider = dto.IsPaceProvider;
        s.BankAccountName = dto.BankAccountName; s.BSB = dto.BSB;
        s.AccountNumber = dto.AccountNumber; s.InvoiceFooterNotes = dto.InvoiceFooterNotes;
        s.State = dto.State; s.ManagerName = dto.ManagerName; s.ManagerPhone = dto.ManagerPhone;

        if (dto.ParticipantReadinessMode is { } newMode && newMode != previousMode)
        {
            s.ParticipantReadinessMode = newMode;
            // Exactly ONE audit row for the mode change: field, old, new, actor. ProviderSettings is
            // deliberately not an audited entity (the generic interceptor would copy the bank
            // details into AuditLog), so the change is recorded here, on its own.
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(
                nameof(ProviderSettings), s.Id, nameof(ProviderSettings.ParticipantReadinessMode),
                previousMode.ToString(), newMode.ToString(), User));
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
