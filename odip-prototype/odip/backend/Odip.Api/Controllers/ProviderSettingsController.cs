using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
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
            ParticipantReadinessMode = s.ParticipantReadinessMode,
            MedicationCompetencyMode = s.MedicationCompetencyMode
        }));
    }

    [HttpPut]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Upsert([FromBody] UpsertProviderSettingsDto dto, CancellationToken ct)
    {
        // Each mode changes ONLY when the request carries it, so a client that does not know about it (or a stale tab saving an unrelated
        // field) can never revert it. Validate before anything is touched, so a refused request writes nothing.
        if (dto.ParticipantReadinessMode is { } requestedReadiness)
        {
            if (!Enum.IsDefined(requestedReadiness))
                return BadRequest(ApiResponse<bool>.Fail("Unknown participant readiness mode. Use Warn or Enforce."));

            // The setting belongs to one organisation. A SuperAdmin with no view-as tenant has none
            // in scope (and the lookup below would land on an arbitrary organisation's row), so
            // they must pick one first. An Admin, or a SuperAdmin viewing as a tenant, always has one.
            if (_tenant?.TenantId is null)
                return BadRequest(ApiResponse<bool>.Fail(
                    "Choose an organisation to view as before changing the participant readiness check."));
        }

        // JsonStringEnumConverter also accepts a bare integer, so "medicationCompetencyMode": 7 would otherwise be stored; the recorder reads any
        // value other than Warn as Enforce, but GET would send back 7 and the dropdown would show nothing.
        if (dto.MedicationCompetencyMode is { } requestedCompetency && !Enum.IsDefined(requestedCompetency))
            return BadRequest(ApiResponse<bool>.Fail("The medication competency mode must be Warn or Enforce."));

        var s = await _db.ProviderSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new ProviderSettings { Id = Guid.NewGuid() };
            _db.ProviderSettings.Add(s);
        }

        // A brand-new row starts at the defaults (Warn for both modes), which is what applied until now.
        var previousReadiness = s.ParticipantReadinessMode;
        var previousCompetency = s.MedicationCompetencyMode;

        s.RegistrationNumber = dto.RegistrationNumber; s.ABN = dto.ABN;
        s.OrganisationName = dto.OrganisationName; s.Address = dto.Address;
        s.GSTRegistered = dto.GSTRegistered; s.IsPaceProvider = dto.IsPaceProvider;
        s.BankAccountName = dto.BankAccountName; s.BSB = dto.BSB;
        s.AccountNumber = dto.AccountNumber; s.InvoiceFooterNotes = dto.InvoiceFooterNotes;
        s.State = dto.State; s.ManagerName = dto.ManagerName; s.ManagerPhone = dto.ManagerPhone;

        // Each mode is applied, and audited, independently and only when sent and different. ProviderSettings is deliberately NOT an audited
        // entity: the generic interceptor would copy the bank details into AuditLog, so each change is recorded here on its own, as exactly
        // ONE single-field row (field, old, new, actor) in the same save as the change, and none when the mode is not changed.
        if (dto.ParticipantReadinessMode is { } newReadiness && newReadiness != previousReadiness)
        {
            s.ParticipantReadinessMode = newReadiness;
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(
                nameof(ProviderSettings), s.Id, nameof(ProviderSettings.ParticipantReadinessMode),
                previousReadiness.ToString(), newReadiness.ToString(), User));
        }

        if (dto.MedicationCompetencyMode is { } newCompetency && newCompetency != previousCompetency)
        {
            s.MedicationCompetencyMode = newCompetency;
            _db.AuditLogs.Add(AuditRows.FieldChanged(
                nameof(ProviderSettings), s.Id, nameof(ProviderSettings.MedicationCompetencyMode), previousCompetency.ToString(), newCompetency.ToString(), User));
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
