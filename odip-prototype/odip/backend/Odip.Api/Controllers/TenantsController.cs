using FirebaseAdmin.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Route("api/v1/admin/tenants")]
[Authorize(Roles = "SuperAdmin")]
public class TenantsController : ControllerBase
{
    private readonly OdipDbContext _db;

    public TenantsController(OdipDbContext db) => _db = db;

    // GET api/v1/admin/tenants
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var tenants = await _db.Tenants
            .OrderBy(t => t.Name)
            .Select(t => new TenantSummaryDto(
                t.Id, t.Name, t.EmailDomain, t.IsActive, t.CreatedAt,
                _db.Users.IgnoreQueryFilters().Count(u => u.TenantId == t.Id)))
            .ToListAsync();
        return Ok(ApiResponse<List<TenantSummaryDto>>.Ok(tenants));
    }

    // POST api/v1/admin/tenants
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTenantDto dto)
    {
        var domain = dto.EmailDomain.ToLower();

        if (await _db.Tenants.AnyAsync(t => t.EmailDomain == domain))
            return Conflict("A tenant with this email domain already exists");

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = dto.Name,
            EmailDomain = domain,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetAll), null, ApiResponse<TenantDto>.Ok(new TenantDto(tenant.Id, tenant.Name, tenant.EmailDomain, tenant.IsActive, tenant.CreatedAt)));
    }

    // POST api/v1/admin/tenants/with-setup
    [HttpPost("with-setup")]
    public async Task<IActionResult> CreateWithSetup([FromBody] CreateTenantWithSetupDto dto)
    {
        var domain = dto.EmailDomain.ToLower();

        if (await _db.Tenants.AnyAsync(t => t.EmailDomain == domain))
            return Conflict("A tenant with this email domain already exists");

        await using var transaction = await _db.Database.BeginTransactionAsync();

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = dto.Name,
            EmailDomain = domain,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.Tenants.Add(tenant);
        await _db.SaveChangesAsync();

        if (dto.ProviderSettings is { } ps)
        {
            var settings = new ProviderSettings
            {
                Id = Guid.NewGuid(),
                TenantId = tenant.Id,
                RegistrationNumber = ps.RegistrationNumber,
                ABN = ps.ABN,
                OrganisationName = ps.OrganisationName,
                Address = ps.Address,
                State = ps.State,
                GSTRegistered = ps.GSTRegistered,
                IsPaceProvider = ps.IsPaceProvider,
                BankAccountName = ps.BankAccountName,
                BSB = ps.BSB,
                AccountNumber = ps.AccountNumber,
                InvoiceFooterNotes = ps.InvoiceFooterNotes,
                MedicationCompetencyMode = ps.MedicationCompetencyMode ?? MedicationCompetencyMode.Warn,
            };
            _db.ProviderSettings.Add(settings);
        }

        if (dto.InitialUser is { } iu)
        {
            if (!Enum.TryParse<UserRole>(iu.Role, true, out var role) || role == UserRole.SuperAdmin)
                return BadRequest("Invalid role for tenant user");

            var user = new User
            {
                Id = Guid.NewGuid(),
                TenantId = tenant.Id,
                FirstName = iu.FirstName,
                LastName = iu.LastName,
                Email = iu.Email,
                Username = iu.Username,
                Role = role,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
            };
            _db.Users.Add(user);
        }

        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        // Create Firebase Auth user for initial admin (best-effort — after commit so DB records are preserved)
        if (dto.InitialUser is { } firebaseIu)
        {
            try
            {
                await FirebaseAuth.DefaultInstance.CreateUserAsync(new UserRecordArgs
                {
                    Email = firebaseIu.Email,
                    DisplayName = $"{firebaseIu.FirstName} {firebaseIu.LastName}",
                    Password = firebaseIu.Password,
                    Disabled = false,
                });
            }
            catch (FirebaseAuthException ex) when (ex.AuthErrorCode == AuthErrorCode.EmailAlreadyExists)
            {
                // Already exists in Firebase — OK
            }
        }

        return CreatedAtAction(nameof(GetAll), null, ApiResponse<TenantSummaryDto>.Ok(new TenantSummaryDto(
            tenant.Id, tenant.Name, tenant.EmailDomain, tenant.IsActive, tenant.CreatedAt,
            dto.InitialUser is not null ? 1 : 0)));
    }

    // PUT api/v1/admin/tenants/{id}
    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateTenantDto dto)
    {
        var tenant = await _db.Tenants.FindAsync(id);
        if (tenant is null)
            return NotFound();

        if (tenant.EmailDomain != dto.EmailDomain.ToLower() &&
            await _db.Tenants.AnyAsync(t => t.EmailDomain == dto.EmailDomain.ToLower() && t.Id != id))
            return Conflict("A tenant with this email domain already exists");

        tenant.Name = dto.Name;
        tenant.EmailDomain = dto.EmailDomain.ToLower();
        tenant.IsActive = dto.IsActive;
        await _db.SaveChangesAsync();
        return Ok(ApiResponse<TenantDto>.Ok(new TenantDto(tenant.Id, tenant.Name, tenant.EmailDomain, tenant.IsActive, tenant.CreatedAt)));
    }

    // GET api/v1/admin/tenants/{id}/users
    [HttpGet("{id:guid}/users")]
    public async Task<IActionResult> GetUsers(Guid id, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FindAsync([id], ct);
        if (tenant is null)
            return NotFound();

        var users = await _db.Users
            .IgnoreQueryFilters()
            .Where(u => u.TenantId == id)
            .OrderBy(u => u.FirstName).ThenBy(u => u.LastName)
            .Select(u => new TenantUserDto(u.Id, $"{u.FirstName} {u.LastName}", u.Role.ToString(), u.IsActive))
            .ToListAsync(ct);
        return Ok(ApiResponse<List<TenantUserDto>>.Ok(users));
    }

    // GET api/v1/admin/tenants/{id}/provider-settings
    [HttpGet("{id:guid}/provider-settings")]
    public async Task<IActionResult> GetProviderSettings(Guid id, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FindAsync([id], ct);
        if (tenant is null)
            return NotFound();

        var ps = await _db.ProviderSettings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.TenantId == id, ct);

        if (ps is null)
            return Ok(ApiResponse<ProviderSettingsDto?>.Ok(null));

        return Ok(ApiResponse<ProviderSettingsDto>.Ok(new ProviderSettingsDto
        {
            Id = ps.Id, RegistrationNumber = ps.RegistrationNumber, ABN = ps.ABN,
            OrganisationName = ps.OrganisationName, Address = ps.Address,
            GSTRegistered = ps.GSTRegistered, IsPaceProvider = ps.IsPaceProvider,
            BankAccountName = ps.BankAccountName, BSB = ps.BSB,
            AccountNumber = ps.AccountNumber, InvoiceFooterNotes = ps.InvoiceFooterNotes,
            State = ps.State, ParticipantReadinessMode = ps.ParticipantReadinessMode,
            MedicationCompetencyMode = ps.MedicationCompetencyMode
        }));
    }
}
