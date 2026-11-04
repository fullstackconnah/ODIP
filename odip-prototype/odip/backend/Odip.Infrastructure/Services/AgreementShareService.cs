using System.Globalization;
using System.Net.Mail;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.Services;

public enum AgreementSendStatus
{
    /// <summary>The send ran: <see cref="AgreementSendOutcome.Error"/> is absent when the email went, else NotConfigured or Failed.</summary>
    Done,
    NotFound,
    NotAnApprover,
    /// <summary>The page was showing an older version than the newest one saved (409).</summary>
    Stale,
    /// <summary>The revision is approved, replaced by a newer one, or ended (409).</summary>
    NotSendable,
    /// <summary>The organisation has no contact email or phone for the person to reply to (409).</summary>
    NoOrganisationContact,
    /// <summary>The person is not a contact of this participant, has no usable email, or nobody was chosen and there is no default (400).</summary>
    BadRecipient,
}

public sealed record AgreementSendOutcome(AgreementSendStatus Status, string? Error = null, string? Message = null);

/// <summary>
/// Sends a service agreement revision to a contact as an emailed link, and answers the link. The link carries a random token of which only the SHA-256 is stored.
/// The public half (<see cref="ViewAsync"/>, <see cref="PdfAsync"/>) never reads the signed-in tenant: the share row names the organisation and participant, every
/// load matches them explicitly with the tenant filter off, and every failure (no such token, expired, revoked, never delivered) is the same null.
/// </summary>
public sealed class AgreementShareService
{
    public const string NoOrganisationContactMessage = "Add your organisation's contact email or phone in Settings first, so the person knows where to reply.";
    public const string NotSendableMessage = "This version can't be sent. Save a new version first.";
    public const int ValidDays = 30;
    private const int MaxTokenLength = 64;

    private readonly OdipDbContext _db;
    private readonly ServiceAgreementDraftService _drafts;
    private readonly IntakeInviteSender _sender;
    private readonly IConfiguration _config;
    private readonly PlanPricingService _pricing;
    private readonly TimeProvider _clock;

    public AgreementShareService(OdipDbContext db, ServiceAgreementDraftService drafts, IntakeInviteSender sender, IConfiguration config, PlanPricingService? pricing = null, TimeProvider? clock = null)
    {
        _db = db; _drafts = drafts; _sender = sender; _config = config;
        _pricing = pricing ?? new PlanPricingService(db);
        _clock = clock ?? TimeProvider.System;
    }

    // ── Contacts and history (signed in) ─────────────────────────────────────

    private static readonly ContactRoleType[] PersonRoles =
        [ContactRoleType.Guardian, ContactRoleType.PlanNominee, ContactRoleType.NextOfKin, ContactRoleType.EmergencyContact, ContactRoleType.ChildRepresentative];

    private sealed record Candidate(Guid? PersonId, string Name, string Roles, string? Email, ContactRoleType? Role = null);

    /// <summary>The people the agreement can go to: the participant's active person contacts (one row for each person, their roles joined) and the participant. Default: the first active Guardian, else Plan Nominee, else the participant.</summary>
    private async Task<(List<Candidate> Candidates, Candidate? Default)> CandidatesAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var roles = await _db.ParticipantContactRoles.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking().Include(r => r.Person)
            .Where(r => r.TenantId == tenantId && r.ParticipantId == participantId && r.Status == ContactRoleStatus.Active && (r.EndDate == null || r.EndDate >= today) && r.Person != null)
            .ToListAsync(ct);
        var people = roles.Where(r => PersonRoles.Contains(r.RoleType)).GroupBy(r => r.PersonId).Select(g =>
            {
                var ordered = g.OrderBy(r => Array.IndexOf(PersonRoles, r.RoleType)).ToList();
                return new Candidate(g.Key, ordered[0].Person!.FullName, string.Join(", ", ordered.Select(r => RoleName(r.RoleType)).Distinct()), Clean(ordered[0].Person!.Email), ordered[0].RoleType);
            })
            .OrderBy(c => Array.IndexOf(PersonRoles, c.Role!.Value)).ThenBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ToList();
        var participant = await _db.Participants.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .Where(p => p.Id == participantId && p.TenantId == tenantId).Select(p => new { p.FirstName, p.LastName, p.PreferredName, p.Email }).FirstOrDefaultAsync(ct);
        if (participant is not null)
            people.Add(new Candidate(null, string.IsNullOrWhiteSpace(participant.PreferredName) ? $"{participant.FirstName} {participant.LastName}".Trim() : $"{participant.PreferredName} {participant.LastName}".Trim(), "Participant", Clean(participant.Email)));
        var preferred = people.FirstOrDefault(p => p.Role == ContactRoleType.Guardian && p.Email != null)
            ?? people.FirstOrDefault(p => p.Role == ContactRoleType.PlanNominee && p.Email != null)
            ?? people.FirstOrDefault(p => p.PersonId is null && p.Email != null);
        return (people, preferred);
    }

    private static string? Clean(string? email) => string.IsNullOrWhiteSpace(email) ? null : email.Trim();

    private static string RoleName(ContactRoleType r) => r switch
    {
        ContactRoleType.NextOfKin => "Next of kin", ContactRoleType.EmergencyContact => "Emergency contact", ContactRoleType.PlanNominee => "Plan nominee",
        ContactRoleType.ChildRepresentative => "Child representative", _ => r.ToString(),
    };

    public async Task<AgreementSharingDto> SharingAsync(Guid tenantId, Guid participantId, Guid draftId, CancellationToken ct)
    {
        var (candidates, preferred) = await CandidatesAsync(tenantId, participantId, ct);
        var shares = await (from s in _db.ServiceAgreementShares.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
                            join d in _db.ServiceAgreementDrafts.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking() on s.DraftId equals d.Id
                            where s.TenantId == tenantId && s.ParticipantId == participantId
                            select new { s, d.Version }).ToListAsync(ct);
        return new AgreementSharingDto
        {
            Contacts = candidates.Select(c => new AgreementContactDto { PersonId = c.PersonId, Name = c.Name, Roles = c.Roles, Email = c.Email, IsDefault = preferred is not null && c.PersonId == preferred.PersonId }).ToList(),
            Shares = shares.OrderByDescending(x => x.s.SentAt).Take(20).Select(x => new AgreementShareRowDto
            {
                Id = x.s.Id, DraftId = x.s.DraftId, DraftVersion = x.Version, RecipientName = x.s.RecipientName, RecipientEmail = x.s.RecipientEmail, SentByName = x.s.SentByName,
                SentAt = x.s.SentAt, ExpiresAt = x.s.ExpiresAt, OpenedAt = x.s.OpenedAt, RevokedAt = x.s.RevokedAt, SendError = x.s.SendError,
            }).ToList(),
        };
    }

    // ── Send (signed in) ─────────────────────────────────────────────────────

    public async Task<AgreementSendOutcome> SendAsync(Guid tenantId, Guid participantId, Guid draftId, SendAgreementDto request, ApprovalCaller caller, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == draftId && x.ParticipantId == participantId && x.TenantId == tenantId, ct);
        if (draft is null) return new(AgreementSendStatus.NotFound);
        if (!await ServiceAgreementApprovalService.MayApproveAsync(_pricing, tenantId, caller, ct))
            return new(AgreementSendStatus.NotAnApprover, Message: ServiceAgreementApprovalService.NotAnApproverMessage);

        var newest = await _db.ServiceAgreementDrafts.IgnoreQueryFilters([TenantFilter.Name]).Where(x => x.TenantId == tenantId && x.ParticipantId == participantId).MaxAsync(x => x.Version, ct);
        if (request.ExpectedVersion != draft.Version)
            return new(AgreementSendStatus.Stale, Message: $"Version {newest} was saved after the version this page showed. Reload and check it before sending.");
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        if (newest > draft.Version || draft.AgreementEndDate < today
            || await _db.ServiceAgreementDraftApprovals.IgnoreQueryFilters([TenantFilter.Name]).AnyAsync(a => a.DraftId == draft.Id && a.TenantId == tenantId, ct))
            return new(AgreementSendStatus.NotSendable, Message: NotSendableMessage);

        var settings = await _db.ProviderSettings.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == tenantId, ct);
        var contactEmail = Clean(settings?.ContactEmail);
        var contactPhone = Clean(settings?.ContactPhone);
        if (contactEmail is null && contactPhone is null) return new(AgreementSendStatus.NoOrganisationContact, Message: NoOrganisationContactMessage);

        var (candidates, preferred) = await CandidatesAsync(tenantId, participantId, ct);
        var chosen = request.PersonId is { } pid ? candidates.FirstOrDefault(c => c.PersonId == pid) : preferred;
        if (chosen is null)
            return new(AgreementSendStatus.BadRecipient, Message: request.PersonId is null ? "Choose who to send the agreement to." : "That person isn't a contact of this participant.");
        if (!IsUsable(chosen.Email))
            return new(AgreementSendStatus.BadRecipient, Message: $"{chosen.Name} has no valid email address on file. Add one to their record first.");

        var now = _clock.GetUtcNow().UtcDateTime;
        var token = CaregiverTokenService.GenerateRawToken();
        var share = new ServiceAgreementShare
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DraftId = draft.Id, TokenHash = CaregiverTokenService.Hash(token),
            RecipientPersonId = chosen.PersonId, RecipientName = chosen.Name, RecipientEmail = chosen.Email!, SentByUserId = caller.UserId, SentByName = caller.Name,
            SentAt = now, ExpiresAt = now.AddDays(ValidDays),
        };
        _db.ServiceAgreementShares.Add(share);
        await _db.SaveChangesAsync(ct);

        IntakeSendOutcome outcome;
        var baseUrl = _config["Notifications:PublicBaseUrl"];
        if (!_config.GetValue("Notifications:Enabled", false) || string.IsNullOrWhiteSpace(baseUrl))
            outcome = new(false, IntakeSendOutcome.NotConfigured);
        else
        {
            var provider = string.IsNullOrWhiteSpace(settings?.TradingName) ? settings?.OrganisationName ?? "" : settings!.TradingName!;
            var message = AgreementSendTemplate.Render(new AgreementSendPayload(
                chosen.Email!, chosen.Name, draft.ParticipantNameSnapshot, provider, baseUrl.Trim().TrimEnd('/') + "/agreement/" + token, DateOnly.FromDateTime(share.ExpiresAt), contactEmail, contactPhone));
            outcome = await _sender.SendAsync(message, ct);
        }

        // A link that went out replaces the ones sent for older versions; one that did not go leaves them working.
        share.SendError = outcome.ErrorCode;
        if (outcome.Sent) await RevokeLiveAsync(_db, tenantId, participantId, draft.Version - 1, now, ct);
        await _db.SaveChangesAsync(ct);
        return new(AgreementSendStatus.Done, Error: outcome.ErrorCode);
    }

    private static bool IsUsable(string? email) =>
        email is { Length: <= 254 } && !email.Any(char.IsWhiteSpace) && MailAddress.TryCreate(email, out var a) && a.Address == email && email.Contains('@');

    /// <summary>
    /// Marks the live, delivered links of the participant's revisions up to <paramref name="upToVersion"/> revoked (tracked: the caller's SaveChanges writes them, so an approval
    /// revokes in the very save that approves). With <paramref name="onlyDraftId"/> only that revision's links.
    /// </summary>
    internal static async Task RevokeLiveAsync(OdipDbContext db, Guid tenantId, Guid participantId, int upToVersion, DateTime now, CancellationToken ct, Guid? onlyDraftId = null)
    {
        var drafts = db.ServiceAgreementDrafts.IgnoreQueryFilters([TenantFilter.Name]).Where(d => d.TenantId == tenantId && d.ParticipantId == participantId);
        var ids = onlyDraftId is { } one ? [one] : await drafts.Where(d => d.Version <= upToVersion).Select(d => d.Id).ToListAsync(ct);
        if (ids.Count == 0) return;
        var live = await db.ServiceAgreementShares.IgnoreQueryFilters([TenantFilter.Name])
            .Where(s => s.TenantId == tenantId && s.ParticipantId == participantId && s.RevokedAt == null && s.SendError == null && ids.Contains(s.DraftId)).ToListAsync(ct);
        foreach (var s in live) s.RevokedAt = now;
    }

    // ── The link (no sign-in) ────────────────────────────────────────────────

    /// <summary>The live share for a token, or null for every reason there is none: malformed, unknown, never delivered, revoked or expired.</summary>
    private async Task<ServiceAgreementShare?> LiveAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength) return null;
        var hash = CaregiverTokenService.Hash(token);
        var now = _clock.GetUtcNow().UtcDateTime;
        return await _db.ServiceAgreementShares.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking()
            .FirstOrDefaultAsync(s => s.TokenHash == hash && s.SendError == null && s.RevokedAt == null && s.ExpiresAt >= now, ct);
    }

    /// <summary>What the link shows, and notes the first open. Null when the link is no good.</summary>
    public async Task<SharedAgreementDto?> ViewAsync(string? token, CancellationToken ct)
    {
        if (await LiveAsync(token, ct) is not { } share) return null;
        var draft = await _db.ServiceAgreementDrafts.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking().Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == share.DraftId && x.TenantId == share.TenantId && x.ParticipantId == share.ParticipantId, ct);
        if (draft is null) return null;
        var settings = await _db.ProviderSettings.IgnoreQueryFilters([TenantFilter.Name]).AsNoTracking().FirstOrDefaultAsync(x => x.TenantId == share.TenantId, ct);
        await MarkOpenedAsync(share, ct);

        var lines = draft.Lines.OrderBy(l => l.Position).Select(l => new SharedAgreementLineDto
        {
            Item = l.ServiceType, Quantity = l.Hours, Unit = l.Unit, UnitPrice = l.UnitPrice, Total = AgreementPriceLists.LineTotal(l),
        }).ToList();
        var inv = CultureInfo.InvariantCulture;
        return new SharedAgreementDto
        {
            ProviderName = string.IsNullOrWhiteSpace(settings?.TradingName) ? settings?.OrganisationName ?? "" : settings!.TradingName!,
            ParticipantName = draft.ParticipantNameSnapshot,
            StartDate = draft.AgreementStartDate, EndDate = draft.IsOngoing ? null : draft.AgreementEndDate, IsOngoing = draft.IsOngoing,
            PeriodText = draft.IsOngoing ? $"From {draft.AgreementStartDate.ToString("d MMMM yyyy", inv)}, ongoing, until the plan ends" : $"{draft.AgreementStartDate.ToString("d MMMM yyyy", inv)} to {draft.AgreementEndDate.ToString("d MMMM yyyy", inv)}",
            Lines = lines, Total = lines.Sum(l => l.Total),
            ContactEmail = Clean(settings?.ContactEmail), ContactPhone = Clean(settings?.ContactPhone), ExpiresAt = share.ExpiresAt,
        };
    }

    /// <summary>The agreement PDF for a link. It does not note an open. Null when the link is no good.</summary>
    public async Task<ServiceAgreementDraftService.AgreementPdf?> PdfAsync(string? token, CancellationToken ct)
    {
        if (await LiveAsync(token, ct) is not { } share) return null;
        return (await _drafts.RenderPdfAsync(share.TenantId, share.ParticipantId, share.DraftId, ct)).Pdf;
    }

    /// <summary>Sets OpenedAt on the first open only.</summary>
    private async Task MarkOpenedAsync(ServiceAgreementShare share, CancellationToken ct)
    {
        var now = _clock.GetUtcNow().UtcDateTime;
        var shares = _db.ServiceAgreementShares.IgnoreQueryFilters([TenantFilter.Name]).Where(s => s.Id == share.Id && s.TenantId == share.TenantId && s.OpenedAt == null);
        // shortcut: the EF InMemory provider (the unit tests) has no ExecuteUpdate, so it takes the tracked path, which can double-set under a race; PostgreSQL gets the one conditional UPDATE.
        if (_db.Database.IsRelational()) { await shares.ExecuteUpdateAsync(s => s.SetProperty(x => x.OpenedAt, now), ct); return; }
        if (await shares.FirstOrDefaultAsync(ct) is { } row) { row.OpenedAt = now; await _db.SaveChangesAsync(ct); }
    }
}
