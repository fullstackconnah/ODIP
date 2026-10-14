using System.Net.Mail;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Notifications.Templates;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The intake visit booked from an enquiry (spec 2026-10-14): one current booking, held on the enquiry's own columns. A new booking, or a change
/// to its start, length, location or staff member, saves and then emails the contact an invite synchronously (.ics REQUEST; on a change the same
/// UID with the next SEQUENCE), storing what became of it. A notes-only save emails nobody. The staff member hears through the outbox
/// (<see cref="NotificationEventType.IntakeBooked"/>). Writes need a tenant context and the roles of the enquiry's own update.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1")]
public class IntakeBookingsController : ControllerBase
{
    private const string LifecycleRoles = "Admin,Coordinator,SuperAdmin";
    private const int DefaultDuration = 90;
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IntakeInviteSender _sender;
    private readonly INotificationRaiser _raiser;
    private readonly TimeProvider _clock;

    public IntakeBookingsController(OdipDbContext db, ICurrentTenant tenant, IntakeInviteSender sender, INotificationRaiser raiser, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _sender = sender;
        _raiser = raiser;
        _clock = clock ?? TimeProvider.System;
    }

    private DateTime NowUtc => _clock.GetUtcNow().UtcDateTime;

    [HttpPut("inquiries/{id:guid}/intake-booking")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Set(Guid id, SetIntakeBookingDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry == null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));

        var now = NowUtc;
        var startsAt = ProviderLocalTime.AsUtc(dto.StartsAt);
        var location = Blank(dto.Location);
        var notes = Blank(dto.Notes);
        var isNew = inquiry.IntakeStartsAt is null;
        var timeChanged = isNew || ProviderLocalTime.AsUtc(inquiry.IntakeStartsAt!.Value) != startsAt;
        var previousStaffId = inquiry.IntakeStaffUserId;
        // An email typed into the panel because the enquiry has none: a new booking, or one whose email has since been cleared through Edit enquiry.
        var givenEmail = inquiry.Email is null ? Blank(dto.ContactEmail) : null;
        // Whether this save emails the contact: a new booking, a change to anything the invite states, or at last an address to send it to. A
        // notes-only save does not, and skips the checks that only matter for a send. So a past visit's notes, or the notes of a visit whose staff
        // member or contact email has since gone, can still be saved.
        var sends = timeChanged || inquiry.IntakeDurationMinutes != dto.DurationMinutes || inquiry.IntakeLocation != location
            || previousStaffId != dto.StaffUserId || givenEmail is not null;

        var errors = new Dictionary<string, string[]>();
        if (sends && timeChanged && startsAt <= now) errors["startsAt"] = ["Choose a time that hasn't passed."];
        if (dto.DurationMinutes is < 15 or > 480) errors["durationMinutes"] = ["Choose a length between 15 minutes and 8 hours."];
        if (location is null) errors["location"] = ["Say where the visit is."];
        else if (location.Length > 300) errors["location"] = ["Keep it under 300 characters."];
        if (notes?.Length > 1000) errors["notes"] = ["Keep notes under 1,000 characters."];
        var staff = await StaffAsync(dto.StaffUserId, inquiry.TenantId, ct);
        if (staff is null) errors["staffUserId"] = ["Choose who's going."];
        else if (sends && (!staff.IsActive || staff.Role is not (UserRole.Admin or UserRole.Coordinator)))
            errors["staffUserId"] = [$"{staff.FirstName} can't do intakes. Choose an active coordinator or admin."];
        var email = inquiry.Email ?? givenEmail;
        if (sends && email is null) errors["contactEmail"] = [$"Add {inquiry.FirstName}'s email to send the invite."];
        else if (sends && !IsSendable(email!))
            errors["contactEmail"] = [inquiry.Email is null ? "Enter a full email address, like name@example.com." : "The enquiry's email can't be used. Edit the enquiry to fix it."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));

        // The email given in the panel is saved in the SAME save as the booking: never an email without a booking, or the reverse.
        if (givenEmail is not null) inquiry.Email = givenEmail;
        inquiry.IntakeNotes = notes;
        inquiry.UpdatedAt = now;
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        InviteFrom? from = null;
        if (sends)
        {
            var caller = await CallerAsync(ct);
            if (isNew)
            {
                inquiry.IntakeUid = $"{Guid.NewGuid():N}@odip";
                inquiry.IntakeIcsSequence = 0;
                inquiry.IntakeInviteSentAt = null;
                inquiry.IntakeInviteError = null;
                // Whoever books stays the invite's ORGANIZER for every revision (lead decision S2). Only a user of this organisation can be one.
                inquiry.IntakeBookedByUserId = caller is { } booker && booker.TenantId == inquiry.TenantId ? booker.Id : (Guid?)null;
            }
            else
            {
                inquiry.IntakeIcsSequence += 1;
            }
            from = await InviteFromAsync(inquiry, caller, ct);
            // Someone else is going: the old staff member gets a CANCEL for the details they were sent (the columns still hold them here).
            if (!isNew && previousStaffId is Guid previous && previous != staff!.Id && await StaffAsync(previous, inquiry.TenantId, ct) is { } previousStaff)
                await RaiseStaffAsync(inquiry, previousStaff, IntakeWording.Cancelled, provider, from, ct);
            // A visit moved to another time needs confirming again.
            if (timeChanged) inquiry.IntakeConfirmedAt = null;
            inquiry.IntakeStartsAt = startsAt;
            inquiry.IntakeDurationMinutes = dto.DurationMinutes;
            inquiry.IntakeLocation = location;
            inquiry.IntakeStaffUserId = staff!.Id;
            await RaiseStaffAsync(inquiry, staff, isNew || previousStaffId != staff.Id ? IntakeWording.Booked : IntakeWording.Changed, provider, from, ct);
        }
        await _db.SaveChangesAsync(ct);

        if (from is not null)
        {
            // Saved first, then sent, so an invite never goes out for a booking that failed to save. The send and the stored outcome do not take the
            // request's token: a browser that goes away mid-send must not abort an invite the saved booking promises (the sender bounds it at 30 s).
            var outcome = await _sender.SendAsync(ContactMessage(inquiry, isNew ? IntakeWording.Booked : IntakeWording.Changed, staff, provider, from), CancellationToken.None);
            Record(inquiry, outcome, NowUtc);
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, staff, provider.ZoneId)));
    }

    [HttpDelete("inquiries/{id:guid}/intake-booking")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<CancelIntakeBookingResultDto>>> Cancel(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<CancelIntakeBookingResultDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is not DateTime start) return NotFound(ApiResponse<CancelIntakeBookingResultDto>.Fail("No intake visit is booked for this enquiry."));
        // A visit that has happened stays on the enquiry as its record; it can be rescheduled, not cancelled.
        if (ProviderLocalTime.AsUtc(start).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) <= NowUtc)
            return Conflict(ApiResponse<CancelIntakeBookingResultDto>.Fail("This visit has already happened, so it can't be cancelled."));

        var staff = await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct);
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        inquiry.IntakeIcsSequence += 1;
        // From the coordinator who booked, as every revision of this UID is (lead decision S2). Read before the columns are cleared.
        var from = await InviteFromAsync(inquiry, await CallerAsync(ct), ct);
        // Only a contact who was sent an invite has anything in their calendar to cancel. Built now, while the columns still hold the visit.
        var cancellation = inquiry.IntakeInviteSentAt != null && inquiry.Email != null && IsSendable(inquiry.Email)
            ? ContactMessage(inquiry, IntakeWording.Cancelled, staff, provider, from)
            : null;
        if (staff != null) await RaiseStaffAsync(inquiry, staff, IntakeWording.Cancelled, provider, from, ct);
        inquiry.ClearIntakeBooking();
        inquiry.UpdatedAt = NowUtc;
        await _db.SaveChangesAsync(ct);

        var email = "NoInvite";
        if (cancellation != null)
        {
            // Not on the request's token: the booking is already cleared, so a CANCEL aborted with the browser could never be sent again.
            var outcome = await _sender.SendAsync(cancellation, CancellationToken.None);
            email = outcome.Sent ? "Sent" : outcome.ErrorCode ?? IntakeSendOutcome.Failed;
        }
        return Ok(ApiResponse<CancelIntakeBookingResultDto>.Ok(new CancelIntakeBookingResultDto
        {
            Inquiry = ParticipantInquiriesController.ToDto(inquiry, null, provider.ZoneId), CancellationEmail = email,
        }));
    }

    /// <summary>The family replied or rang: the coordinator marks it by hand (no confirm link in v1). Emails nobody.</summary>
    [HttpPost("inquiries/{id:guid}/intake-booking/confirm")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Confirm(Guid id, ConfirmIntakeBookingDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("No intake visit is booked for this enquiry."));
        inquiry.IntakeConfirmedAt = dto.Confirmed ? NowUtc : null;
        inquiry.UpdatedAt = NowUtc;
        await _db.SaveChangesAsync(ct);
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct), provider.ZoneId)));
    }

    /// <summary>Send again: the current invite, with the same UID and SEQUENCE, to the enquiry's current email. The outcome is stored like any send.</summary>
    [HttpPost("inquiries/{id:guid}/intake-booking/send")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Resend(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is not DateTime start) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("No intake visit is booked for this enquiry."));
        if (ProviderLocalTime.AsUtc(start).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) <= NowUtc)
            return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("This visit has already happened, so there's no invite to send."));
        if (inquiry.Email is null || !IsSendable(inquiry.Email))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["contactEmail"] = [$"Add {inquiry.FirstName}'s email to the enquiry to send the invite."] }));

        var staff = await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct);
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        var from = await InviteFromAsync(inquiry, await CallerAsync(ct), ct);
        var outcome = await _sender.SendAsync(ContactMessage(inquiry, inquiry.IntakeIcsSequence == 0 ? IntakeWording.Booked : IntakeWording.Changed, staff, provider, from), CancellationToken.None);
        Record(inquiry, outcome, NowUtc);
        inquiry.UpdatedAt = NowUtc;
        await _db.SaveChangesAsync(CancellationToken.None);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, staff, provider.ZoneId)));
    }

    /// <summary>
    /// Intake visits starting in [from, to] (provider-local dates; by default today to 12 months on), soonest first, for My shifts and the Schedule
    /// page. Your own visits are open to anyone signed in. Someone else's, or everyone's (no staff filter), are for the lifecycle roles only,
    /// because the location is often a home address; anyone else who sends no filter gets their own.
    /// </summary>
    [HttpGet("intake-visits")]
    public async Task<ActionResult<ApiResponse<List<IntakeVisitDto>>>> Visits([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] Guid? staffUserId, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return Ok(ApiResponse<List<IntakeVisitDto>>.Ok([]));
        if (!(User.IsInRole("Admin") || User.IsInRole("Coordinator") || User.IsInRole("SuperAdmin")))
        {
            Guid? me = _tenant.ViewAsUserId ?? (Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var own) ? own : (Guid?)null);
            if (me is null) return Ok(ApiResponse<List<IntakeVisitDto>>.Ok([]));
            if (staffUserId is Guid other && other != me) return StatusCode(403, ApiResponse<List<IntakeVisitDto>>.Fail("You can only see your own intake visits."));
            staffUserId = me;
        }

        var zone = await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct);
        var first = from ?? ProviderLocalTime.TodayIn(NowUtc, zone.Zone);
        var last = to ?? first.AddMonths(12);
        var fromUtc = ProviderLocalTime.LocalToUtc(first.ToDateTime(TimeOnly.MinValue), zone.Zone);
        var toUtc = ProviderLocalTime.LocalToUtc(last.AddDays(1).ToDateTime(TimeOnly.MinValue), zone.Zone);
        // Keyed on the caller's organisation explicitly: a SuperAdmin's context has no query filter.
        var rows = await _db.ParticipantInquiries
            .Where(x => x.TenantId == tenantId && x.IntakeStartsAt != null && x.IntakeStartsAt >= fromUtc && x.IntakeStartsAt < toUtc
                        && (staffUserId == null || x.IntakeStaffUserId == staffUserId))
            .OrderBy(x => x.IntakeStartsAt)
            .Select(x => new { x.Id, x.FirstName, x.LastName, x.ParticipantId, x.IntakeStartsAt, x.IntakeDurationMinutes, x.IntakeLocation, x.IntakeStaffUserId, x.IntakeConfirmedAt })
            .ToListAsync(ct);

        var participantIds = rows.Where(r => r.ParticipantId != null).Select(r => r.ParticipantId!.Value).Distinct().ToList();
        var participants = await _db.Participants.Where(p => participantIds.Contains(p.Id))
            .Select(p => new { p.Id, p.IsDraft, p.IntakeCompletedAt }).ToDictionaryAsync(p => p.Id, ct);
        var staffIds = rows.Select(r => r.IntakeStaffUserId!.Value).Distinct().ToList();
        var names = await _db.Users.IgnoreQueryFilters().Where(u => staffIds.Contains(u.Id) && u.TenantId == tenantId)
            .ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, ct);

        return Ok(ApiResponse<List<IntakeVisitDto>>.Ok(rows.Select(r =>
        {
            var participant = r.ParticipantId is Guid pid ? participants.GetValueOrDefault(pid) : null;
            return new IntakeVisitDto
            {
                InquiryId = r.Id, FirstName = r.FirstName, LastName = r.LastName, ParticipantId = r.ParticipantId,
                ParticipantIsDraft = participant?.IsDraft, ParticipantIntakeCompletedAt = participant?.IntakeCompletedAt,
                StartsAt = r.IntakeStartsAt!.Value, DurationMinutes = r.IntakeDurationMinutes ?? DefaultDuration, Location = r.IntakeLocation ?? string.Empty,
                StaffUserId = r.IntakeStaffUserId!.Value, StaffName = names.GetValueOrDefault(r.IntakeStaffUserId!.Value, string.Empty),
                ConfirmedAt = r.IntakeConfirmedAt, TimeZoneId = zone.Id,
            };
        }).ToList()));
    }

    private sealed record Provider(string ZoneId, string Name, string Address, string? ManagerName, string? ManagerPhone);

    // Read by the ENQUIRY's organisation: a SuperAdmin viewing as a tenant has no query filter, and must never get another organisation's settings.
    private async Task<Provider> ProviderAsync(Guid tenantId, CancellationToken ct)
    {
        var settings = await _db.ProviderSettings.IgnoreQueryFilters().Where(p => p.TenantId == tenantId)
            .Select(p => new { p.State, p.OrganisationName, p.Address, p.ManagerName, p.ManagerPhone }).FirstOrDefaultAsync(ct);
        var name = !string.IsNullOrWhiteSpace(settings?.OrganisationName)
            ? settings.OrganisationName
            : await _db.Tenants.IgnoreQueryFilters().Where(t => t.Id == tenantId).Select(t => t.Name).FirstOrDefaultAsync(ct) ?? string.Empty;
        return new Provider(ProviderTimeZoneResolver.FromState(settings?.State).Id, name, settings?.Address ?? string.Empty, settings?.ManagerName, settings?.ManagerPhone);
    }

    // Who the server attributes the booking to: the viewed-as user under a SuperAdmin's "view as", else the signed-in one (as PortalController resolves it).
    private async Task<User?> CallerAsync(CancellationToken ct)
    {
        Guid? id = _tenant.ViewAsUserId ?? (Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var own) ? own : (Guid?)null);
        return id is Guid userId ? await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == userId, ct) : null;
    }

    // Keyed on the enquiry's organisation, never the ambient filter (a SuperAdmin has none): another organisation's user is simply not found.
    private async Task<User?> StaffAsync(Guid? id, Guid tenantId, CancellationToken ct) =>
        id is Guid staffId ? await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == staffId && u.TenantId == tenantId, ct) : null;

    // Who an invite is from (lead decision S2). ORGANIZER and Reply-To stay the coordinator who booked, for every revision of the UID: calendar apps
    // treat a changed ORGANIZER as another event. If that person has since been deactivated or has no email, ORGANIZER is left out and Reply-To is
    // whoever is acting now.
    private sealed record InviteFrom(string? OrganizerName, string? OrganizerEmail, string? ReplyTo, string BookedByName);

    private async Task<InviteFrom> InviteFromAsync(ParticipantInquiry x, User? caller, CancellationToken ct)
    {
        var booker = await StaffAsync(x.IntakeBookedByUserId, x.TenantId, ct);
        var organizer = booker is { IsActive: true } && !string.IsNullOrWhiteSpace(booker.Email) ? booker : null;
        return new InviteFrom(organizer?.FullName, organizer?.Email, organizer?.Email ?? caller?.Email, booker?.FullName ?? caller?.FullName ?? "A coordinator");
    }

    private NotificationMessage ContactMessage(ParticipantInquiry x, string kind, User? staff, Provider provider, InviteFrom from) =>
        IntakeInviteTemplate.Render(new IntakeInvitePayload(
            kind, x.Email!, x.FirstName, $"{x.FirstName} {x.LastName}", provider.Name, provider.Address,
            ProviderLocalTime.AsUtc(x.IntakeStartsAt!.Value), x.IntakeDurationMinutes ?? DefaultDuration, provider.ZoneId, x.IntakeLocation ?? string.Empty,
            staff?.FullName ?? string.Empty, provider.ManagerName, provider.ManagerPhone,
            ReplyTo: from.ReplyTo, OrganizerName: from.OrganizerName, Uid: x.IntakeUid!, Sequence: x.IntakeIcsSequence, StampUtc: NowUtc,
            OrganizerEmail: from.OrganizerEmail));

    // A fresh EntityId for each revision, on purpose: the raiser drops a second row for the same (type, entity, recipient) within 5 minutes, and a
    // reschedule a minute after booking must still reach the staff member's calendar. A repeated save with nothing changed raises nothing.
    private Task RaiseStaffAsync(ParticipantInquiry x, User staff, string kind, Provider provider, InviteFrom from, CancellationToken ct) =>
        _raiser.RaiseAsync(NotificationEventType.IntakeBooked, "IntakeVisit", Guid.NewGuid(), [staff.Id],
            new IntakeVisitStaffPayload(
                kind, staff.Email, staff.FullName, $"{x.FirstName} {x.LastName}", ProviderLocalTime.AsUtc(x.IntakeStartsAt!.Value),
                x.IntakeDurationMinutes ?? DefaultDuration, provider.ZoneId, x.IntakeLocation ?? string.Empty, x.Phone, x.Email, x.IntakeNotes,
                from.BookedByName, from.OrganizerEmail, provider.Name, provider.ManagerName, provider.ManagerPhone,
                x.IntakeUid!, x.IntakeIcsSequence, NowUtc, ReplyTo: from.ReplyTo), ct);

    private static void Record(ParticipantInquiry x, IntakeSendOutcome outcome, DateTime now)
    {
        if (outcome.Sent)
        {
            x.IntakeInviteSentAt = now;
            x.IntakeInviteError = null;
        }
        else
        {
            x.IntakeInviteError = outcome.ErrorCode;
        }
    }

    // An address the SMTP channel takes as written: MailAddress reads "Ann <a@b.c>" or "a b@c.d" as a display name plus an address, which is not what was typed.
    private static bool IsSendable(string email) => email.Length <= 200 && MailAddress.TryCreate(email, out var parsed) && parsed.Address == email;

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
