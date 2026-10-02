using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// INTERNAL: the plan builder's pricing engine (phase B). Phase C's builder is the only intended caller; nothing here is a public contract and the
/// shapes may change with it. The quote prices a set of weekly support blocks over an agreement period with the caller's own tenant's settings, the
/// date-effective catalogue and the delivery states' public holidays; it reads and writes nothing else.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/plan-pricing")]
public class PlanPricingController : ControllerBase
{
    private static readonly string[] ApproverRoles = { "Admin", "Coordinator" };
    /// <summary>The most a kilometre may be claimed at: the 2025-26 rates are 0.99 and 2.76, so a figure above this is a slipped decimal point (9.90 for 0.99 made every kilometre line ten times too high).</summary>
    private const decimal MaxKmRate = 5m;

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly PlanPricingService _service;

    public PlanPricingController(OdipDbContext db, ICurrentTenant tenant, PlanPricingService service)
    {
        _db = db;
        _tenant = tenant;
        _service = service;
    }

    private const string ChooseOrganisation = "Choose an organisation to view as before using the plan pricing engine: its settings belong to one organisation.";

    // ── The quote ─────────────────────────────────────────────────────────────────

    [HttpPost("quote")]
    [RequestSizeLimit(1_048_576)]
    public async Task<ActionResult<ApiResponse<PlanQuote>>> Quote([FromBody] PlanQuoteRequestDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<PlanQuote>.Fail(ChooseOrganisation));
        if (dto.Blocks is null) return BadRequest(ApiResponse<PlanQuote>.Fail("The request needs a list of blocks."));
        if (dto.PeriodFrom > dto.PeriodTo) return BadRequest(ApiResponse<PlanQuote>.Fail("The agreement period ends before it starts."));
        if (dto.PeriodFrom.Year < PlanPricingEngine.FirstYear || dto.PeriodTo.Year > PlanPricingEngine.LastYear)
            return BadRequest(ApiResponse<PlanQuote>.Fail($"The agreement period must fall between the years {PlanPricingEngine.FirstYear} and {PlanPricingEngine.LastYear}."));
        if (dto.PeriodTo.DayNumber - dto.PeriodFrom.DayNumber + 1 > PlanPricingEngine.MaxPeriodDays)
            return BadRequest(ApiResponse<PlanQuote>.Fail($"The agreement period is longer than {PlanPricingEngine.MaxPeriodDays} days."));
        if (dto.Blocks.Count > PlanPricingEngine.MaxBlocks)
            return BadRequest(ApiResponse<PlanQuote>.Fail($"A quote prices at most {PlanPricingEngine.MaxBlocks} blocks."));

        var quote = await _service.QuoteAsync(tenantId, dto.Blocks, dto.PeriodFrom, dto.PeriodTo, ct);
        return Ok(ApiResponse<PlanQuote>.Ok(dto.IncludeLines ? quote : quote with { Lines = Array.Empty<PlannedLine>() }));
    }

    // ── The settings ──────────────────────────────────────────────────────────────

    [HttpGet("settings")]
    public async Task<ActionResult<ApiResponse<PlanPricingSettingsDto>>> GetSettings(CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail(ChooseOrganisation));

        var settings = await _service.FindSettingsAsync(tenantId, ct);
        return Ok(ApiResponse<PlanPricingSettingsDto>.Ok(ToDto(settings)));
    }

    /// <summary>
    /// Each setting changes only when the request carries it. Validated before anything is touched, so a refused request writes nothing. The change is
    /// audited by the generic audit interceptor (the table holds nothing private).
    /// </summary>
    [HttpPut("settings")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<PlanPricingSettingsDto>>> PutSettings([FromBody] UpdatePlanPricingSettingsDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail(ChooseOrganisation));

        var groups = dto.RegistrationGroupsHeld?.Select(g => (g ?? string.Empty).Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (groups?.FirstOrDefault(g => !PlanPricingPolicy.AllRegistrationGroups.Contains(g)) is { } unknown)
            return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail(
                $"Unknown registration group '{unknown}'. The groups are {string.Join(", ", PlanPricingPolicy.AllRegistrationGroups)}."));

        var roles = dto.ApproverRoles?.Select(r => ApproverRoles.FirstOrDefault(known => string.Equals(known, (r ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase)) ?? (r ?? string.Empty).Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (roles is not null && roles.Count == 0)
            return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail("At least one approver role is needed."));
        if (roles?.FirstOrDefault(r => !ApproverRoles.Contains(r)) is { } badRole)
            return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail($"Unknown approver role '{badRole}'. Use {string.Join(" or ", ApproverRoles)}."));

        foreach (var rate in new[] { dto.TravelKmRateStandard, dto.TravelKmRateAccessible })
            if (rate is < 0m or > MaxKmRate)
                return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail($"The travel rate per kilometre must be between $0 and ${MaxKmRate:0}."));

        if (dto.CrossingPolicy is { } crossing && !Enum.IsDefined(crossing))
            return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail("Unknown crossing policy. Use Split or HigherOf."));
        if (dto.GroupOutings is { } outings && !Enum.IsDefined(outings))
            return BadRequest(ApiResponse<PlanPricingSettingsDto>.Fail("Unknown group outing family. Use GroupActivities or CommunityAccess."));

        var settings = await _db.PlanPricingSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (settings is null)
        {
            settings = new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = tenantId };
            _db.PlanPricingSettings.Add(settings);
        }

        if (groups is not null)
        {
            settings.RegistrationGroupsHeld = string.Join(",", groups);
            settings.RegistrationGroupsConfirmed = dto.RegistrationGroupsConfirmed ?? true;
        }
        else if (dto.RegistrationGroupsConfirmed is { } confirmed)
        {
            settings.RegistrationGroupsConfirmed = confirmed;
        }

        if (dto.CrossingPolicy is { } policy) settings.CrossingPolicy = policy;
        if (dto.ClaimProviderTravel is { } travel) settings.ClaimProviderTravel = travel;
        if (dto.TravelKmRateStandard is { } standard) settings.TravelKmRateStandard = Math.Round(standard, 2, MidpointRounding.AwayFromZero);
        if (dto.TravelKmRateAccessible is { } accessible) settings.TravelKmRateAccessible = Math.Round(accessible, 2, MidpointRounding.AwayFromZero);
        if (dto.TravelRatesProvisional is { } provisional) settings.TravelRatesProvisional = provisional;
        if (dto.GroupOutings is { } family) settings.GroupOutings = family;
        if (dto.StaUsesHourlyAndAccommodation is { } sta) settings.StaUsesHourlyAndAccommodation = sta;
        if (roles is not null) settings.ApproverRoles = string.Join(",", roles);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PlanPricingSettingsDto>.Ok(ToDto(settings)));
    }

    private static PlanPricingSettingsDto ToDto(PlanPricingSettings? settings)
    {
        var policy = PlanPricingPolicy.From(settings);
        return new PlanPricingSettingsDto
        {
            RegistrationGroupsHeld = policy.RegistrationGroupsHeld.ToList(),
            RegistrationGroupsConfirmed = policy.RegistrationGroupsConfirmed,
            CrossingPolicy = policy.Crossing,
            ClaimProviderTravel = policy.ClaimProviderTravel,
            TravelKmRateStandard = policy.KmRateStandard,
            TravelKmRateAccessible = policy.KmRateAccessible,
            TravelRatesProvisional = policy.TravelRatesProvisional,
            GroupOutings = policy.GroupOutings,
            StaUsesHourlyAndAccommodation = policy.StaUsesHourlyAndAccommodation,
            ApproverRoles = policy.ApproverRoles.ToList(),
            IsDefault = settings is null,
        };
    }
}
