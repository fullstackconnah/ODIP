using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>Creates quote-only snapshots. This service never produces billable events or signed status.</summary>
public sealed class ServiceAgreementDraftService
{
    private readonly OdipDbContext _db;
    public ServiceAgreementDraftService(OdipDbContext db) => _db = db;

    public async Task<(ServiceAgreementDraft? Draft, string? Error)> CreateAsync(Guid tenantId, Guid participantId, CreateServiceAgreementDraftDto request, string actor, CancellationToken ct)
    {
        if (request.PlanEndDate < request.PlanStartDate || request.AgreementEndDate < request.AgreementStartDate)
            return (null, "End dates must not precede start dates.");
        var participant = await _db.Participants.FirstOrDefaultAsync(x => x.Id == participantId, ct);
        if (participant == null || participant.TenantId != tenantId) return (null, "Participant not found.");
        var effectiveDate = request.AgreementStartDate;
        var lines = new List<ServiceAgreementDraftLine>();
        foreach (var requested in request.Lines)
        {
            var candidates = await _db.SupportCatalogueItems
                .Where(x => x.ItemNumber == requested.ItemCode && x.IsActive && x.DayType == Odip.Domain.Enums.ClaimDayType.Weekday
                    && x.EffectiveFrom <= effectiveDate && (x.EffectiveTo == null || x.EffectiveTo >= effectiveDate))
                .ToListAsync(ct);
            if (candidates.Count != 1) return (null, candidates.Count == 0
                ? $"No active effective weekday catalogue price exists for {requested.ItemCode}."
                : $"Ambiguous active effective catalogue prices exist for {requested.ItemCode}.");
            var item = candidates[0];
            var price = PriceForState(item, request.State);
            if (price <= 0) return (null, $"No available {request.State} price exists for {requested.ItemCode}.");
            lines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = requested.ServiceType.Trim(), Hours = requested.Hours, ItemCode = item.ItemNumber, UnitPrice = price, CatalogueVersion = item.CatalogueVersion, CatalogueEffectiveFrom = item.EffectiveFrom, CatalogueEffectiveTo = item.EffectiveTo });
        }
        var version = (await _db.ServiceAgreementDrafts.Where(x => x.ParticipantId == participantId).MaxAsync(x => (int?)x.Version, ct) ?? 0) + 1;
        var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Version = version, PlanStartDate = request.PlanStartDate, PlanEndDate = request.PlanEndDate, AgreementStartDate = request.AgreementStartDate, AgreementEndDate = request.AgreementEndDate, State = request.State, ServiceTypesJson = JsonSerializer.Serialize(request.ServiceTypes), Representative = request.Representative?.Trim(), ParticipantNameSnapshot = participant.FullName, NdisNumberSnapshot = participant.NdisNumber, DateOfBirthSnapshot = participant.DateOfBirth, CreatedBy = actor };
        foreach (var line in lines) { line.DraftId = draft.Id; draft.Lines.Add(line); }
        _db.ServiceAgreementDrafts.Add(draft);
        await _db.SaveChangesAsync(ct);
        return (draft, null);
    }

    public async Task<(byte[]? Pdf, string? Error)> RenderPdfAsync(Guid tenantId, Guid participantId, Guid draftId, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.Include(x => x.Lines)
            .SingleOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft == null) return (null, "Draft not found.");
        return (ServiceAgreementDraftPdfRenderer.Render(draft), null);
    }

    private static decimal PriceForState(SupportCatalogueItem item, string state) => state switch
    {
        "ACT" => item.PriceLimit_ACT, "NSW" => item.PriceLimit_NSW, "NT" => item.PriceLimit_NT, "QLD" => item.PriceLimit_QLD,
        "SA" => item.PriceLimit_SA, "TAS" => item.PriceLimit_TAS, "VIC" => item.PriceLimit_VIC, "WA" => item.PriceLimit_WA, _ => 0m
    };
}
