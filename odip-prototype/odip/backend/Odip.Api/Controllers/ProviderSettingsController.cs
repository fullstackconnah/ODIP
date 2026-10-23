using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Services;

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

    private const string ChangedByOther = "Settings were changed by someone else. Reload and try again.";

    private bool NoOrganisationInScope => _tenant is { IsSuperAdmin: true, TenantId: null };

    // A SuperAdmin's query filter is off, so the row is chosen by organisation here.
    private IQueryable<ProviderSettings> ScopedSettings() =>
        _tenant?.TenantId is { } tenantId ? _db.ProviderSettings.Where(p => p.TenantId == tenantId) : _db.ProviderSettings;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<ProviderSettingsDto>>> Get(CancellationToken ct)
    {
        // A SuperAdmin with no organisation chosen has no settings in scope; the lookup must never land on an arbitrary organisation's row.
        if (NoOrganisationInScope) return Ok(ApiResponse<ProviderSettingsDto?>.Ok(null));
        var s = await ScopedSettings().FirstOrDefaultAsync(ct);
        if (s == null) return Ok(ApiResponse<ProviderSettingsDto?>.Ok(null));
        var (next, issued) = await InvoiceService.NumberingOfAsync(_db, s, ct);

        // A Coordinator reads the settings without the bank account: Settings hides it and this API doesn't send it. Invoice PDFs still print it by design (payment details; InvoiceService).
        var hideBank = User?.IsInRole("Coordinator") == true && !User.IsInRole("Admin") && !User.IsInRole("SuperAdmin");

        return Ok(ApiResponse<ProviderSettingsDto>.Ok(new ProviderSettingsDto
        {
            Id = s.Id, RegistrationNumber = s.RegistrationNumber, ABN = s.ABN,
            OrganisationName = s.OrganisationName, Address = s.Address,
            GSTRegistered = s.GSTRegistered, IsPaceProvider = s.IsPaceProvider,
            BankAccountName = hideBank ? null : s.BankAccountName, BSB = hideBank ? null : s.BSB,
            AccountNumber = hideBank ? null : s.AccountNumber, InvoiceFooterNotes = s.InvoiceFooterNotes,
            State = s.State, ManagerName = s.ManagerName, ManagerPhone = s.ManagerPhone,
            ParticipantReadinessMode = s.ParticipantReadinessMode,
            MedicationCompetencyMode = s.MedicationCompetencyMode,
            EmploymentHeroConnected = await EmploymentHeroStaffSync.IsConnectedAsync(_db, s.TenantId, ct),
            InvoiceNumberPrefix = s.InvoiceNumberPrefix, CreditNotePrefix = s.CreditNotePrefix,
            InvoiceStartNumber = s.InvoiceStartNumber, PaymentTermsDays = s.PaymentTermsDays,
            NextInvoiceDisplayNumber = next, InvoicesIssued = issued,
            UpdatedAt = s.UpdatedAt
        }));
    }

    [HttpPut]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<DateTime>>> Upsert([FromBody] UpsertProviderSettingsDto dto, CancellationToken ct)
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

        var bad = PrefixProblem(dto.InvoiceNumberPrefix, "INV-") ?? PrefixProblem(dto.CreditNotePrefix, "CN-")
            ?? (dto.InvoiceStartNumber is < 1 or > 99_999_999 ? "Enter a whole number from 1 to 99,999,999." : null)
            ?? (dto.PaymentTermsDays is < 0 or > 365 ? "Enter a whole number of days from 0 to 365." : null);
        if (bad != null) return BadRequest(ApiResponse<bool>.Fail(bad));

        // Prices and public holidays follow the state, so none is assumed (a body that omits it used to become Victoria).
        var state = dto.State?.Trim().ToUpperInvariant();
        if (state is null || !HolidayCalendar.StateCodes.Contains(state))
            return BadRequest(ApiResponse<bool>.Fail("Choose the organisation's state."));

        if (NoOrganisationInScope)
            return BadRequest(ApiResponse<bool>.Fail(SettingsController.ChooseOrganisation));

        var s = await ScopedSettings().FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new ProviderSettings { Id = Guid.NewGuid() };
            _db.ProviderSettings.Add(s);
        }

        // The version the form loaded goes into the UPDATE's WHERE (not a read-then-compare, which would race): another Admin's save since then is a 409.
        // A new row has nothing to compare with. No version sent (an older open tab) saves as before.
        if (dto.ExpectedUpdatedAt is DateTime expected && _db.Entry(s).State != EntityState.Added)
            _db.Entry(s).Property(x => x.UpdatedAt).OriginalValue = expected;
        s.UpdatedAt = DateTime.UtcNow;

        // Numbering changes only when a field is sent AND differs: every settings section echoes the whole row, so an unchanged echo is never a change.
        var prefixChanged = dto.InvoiceNumberPrefix is { } p && p != s.InvoiceNumberPrefix;
        var cnPrefixChanged = dto.CreditNotePrefix is { } cp && cp != s.CreditNotePrefix;
        var startChanged = dto.InvoiceStartNumber is { } st && st != s.InvoiceStartNumber;
        var termsChanged = dto.PaymentTermsDays is { } td && td != s.PaymentTermsDays;
        // shortcut: a start number changed during the very first issue is ignored; Settings then shows the counter's real next number.
        if (startChanged)
        {
            var owner = _tenant?.TenantId ?? s.TenantId;
            if (await _db.Invoices.IgnoreQueryFilters().AnyAsync(i => i.TenantId == owner && i.Kind == InvoiceKind.Invoice, ct))
                return Conflict(ApiResponse<bool>.Fail("Invoice numbers have started, so the starting number can't change."));
        }

        // A brand-new row starts at the defaults (Warn for both modes), which is what applied until now.
        var previousReadiness = s.ParticipantReadinessMode;
        var previousCompetency = s.MedicationCompetencyMode;

        s.RegistrationNumber = dto.RegistrationNumber; s.ABN = dto.ABN;
        s.OrganisationName = dto.OrganisationName; s.Address = dto.Address;
        s.GSTRegistered = dto.GSTRegistered; s.IsPaceProvider = dto.IsPaceProvider;
        s.BankAccountName = dto.BankAccountName; s.BSB = dto.BSB;
        s.AccountNumber = dto.AccountNumber; s.InvoiceFooterNotes = dto.InvoiceFooterNotes;
        s.State = state; s.ManagerName = dto.ManagerName; s.ManagerPhone = dto.ManagerPhone;

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
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(
                nameof(ProviderSettings), s.Id, nameof(ProviderSettings.MedicationCompetencyMode),
                previousCompetency.ToString(), newCompetency.ToString(), User));
        }

        // Each numbering change is one field-change audit row, like the modes above (the row holds bank details, so it is never audited whole).
        if (prefixChanged)
        {
            AuditNumbering(s, nameof(ProviderSettings.InvoiceNumberPrefix), s.InvoiceNumberPrefix, dto.InvoiceNumberPrefix!);
            s.InvoiceNumberPrefix = dto.InvoiceNumberPrefix!;
        }
        if (cnPrefixChanged)
        {
            AuditNumbering(s, nameof(ProviderSettings.CreditNotePrefix), s.CreditNotePrefix, dto.CreditNotePrefix!);
            s.CreditNotePrefix = dto.CreditNotePrefix!;
        }
        if (startChanged)
        {
            AuditNumbering(s, nameof(ProviderSettings.InvoiceStartNumber), Invariant(s.InvoiceStartNumber), Invariant(dto.InvoiceStartNumber!.Value));
            s.InvoiceStartNumber = dto.InvoiceStartNumber!.Value;
        }
        if (termsChanged)
        {
            AuditNumbering(s, nameof(ProviderSettings.PaymentTermsDays), Invariant(s.PaymentTermsDays), Invariant(dto.PaymentTermsDays!.Value));
            s.PaymentTermsDays = dto.PaymentTermsDays!.Value;
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(ApiResponse<bool>.Fail(ChangedByOther));
        }
        // The row's new version, so the form can send it with its next save without waiting for a refetch.
        return Ok(ApiResponse<DateTime>.Ok(s.UpdatedAt));
    }

    /// <summary>A prefix ends up in the PDF's file name: 1 to 10 letters, digits, - _ or . (null = not sent).</summary>
    private static string? PrefixProblem(string? prefix, string example) => prefix switch
    {
        null => null,
        "" => $"Enter a prefix, such as {example}.",
        _ when prefix.Any(char.IsWhiteSpace) => "No spaces.",
        { Length: > 10 } => "10 characters at most.",
        _ when !prefix.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.') => "Use letters, digits, - _ or . only.",
        _ => null,
    };

    private void AuditNumbering(ProviderSettings s, string field, string oldValue, string newValue) =>
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(ProviderSettings), s.Id, field, oldValue, newValue, User));

    private static string Invariant(int value) => value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
