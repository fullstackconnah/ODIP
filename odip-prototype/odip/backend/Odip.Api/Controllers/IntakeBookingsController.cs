using System.Net.Mail;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
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
    public const string StaffBusyCode = "intake-staff-busy";
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
        if (inquiry.ClosedAt is not null) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ClosedRefusal, ClosedCode));
        // ODIP-REVIEW-268: the version the form holds goes into the UPDATE's WHERE, so a write from a stale form is a 409 and nothing of it saves.
        if (dto.ExpectedUpdatedAt is DateTime expected) _db.Entry(inquiry).Property(x => x.UpdatedAt).OriginalValue = expected;

        var now = NowUtc;
        var startsAt = ProviderLocalTime.AsUtc(dto.StartsAt);
        var location = Blank(dto.Location);
        var notes = Blank(dto.Notes);
        var isNew = inquiry.IntakeStartsAt is null;
        var timeChanged = isNew || ProviderLocalTime.AsUtc(inquiry.IntakeStartsAt!.Value) != startsAt;
        var previousStaffId = inquiry.IntakeStaffUserId;
        // An email typed into the panel because the enquiry has none: a new booking, or one whose email has since been cleared through Edit enquiry.
        // Never on a converted enquiry (D7): its main contact is the participant's record now.
        var givenEmail = inquiry.Email is null && inquiry.ParticipantId is null ? Blank(dto.ContactEmail) : null;
        // Whether this save emails the contact: a new booking, a change to anything the invite states, or at last an address to send it to. A
        // notes-only save does not, and skips the checks that only matter for a send. So a past visit's notes, or the notes of a visit whose staff
        // member or contact email has since gone, can still be saved.
        var sends = timeChanged || inquiry.IntakeDurationMinutes != dto.DurationMinutes || inquiry.IntakeLocation != location
            || previousStaffId != dto.StaffUserId || givenEmail is not null;

        var errors = new Dictionary<string, string[]>();
        if (sends && timeChanged && startsAt <= now) errors["startsAt"] = ["Choose a time that hasn't passed."];
        // A visit that has happened (as Cancel and Send again judge it) is rebooked only at a new time: any other invite change would email an
        // "updated" invite for a time already gone. Its notes still save.
        else if (sends && !timeChanged && ProviderLocalTime.AsUtc(inquiry.IntakeStartsAt!.Value).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) <= now)
            errors["startsAt"] = ["This visit has passed. Change the date and time to book another."];
        if (dto.DurationMinutes is < 15 or > 480) errors["durationMinutes"] = ["Choose a length between 15 minutes and 8 hours."];
        if (location is null) errors["location"] = ["Say where the visit is."];
        else if (location.Length > 300) errors["location"] = ["Keep it under 300 characters."];
        if (notes?.Length > 1000) errors["notes"] = ["Keep notes under 1,000 characters."];
        var staff = await StaffAsync(dto.StaffUserId, inquiry.TenantId, ct);
        if (staff is null) errors["staffUserId"] = ["Choose who's going."];
        else if (sends && (!staff.IsActive || staff.Role is not (UserRole.Admin or UserRole.Coordinator)))
            errors["staffUserId"] = [$"{staff.FirstName} can't do intakes. Choose an active coordinator or admin."];
        var email = inquiry.Email ?? givenEmail;
        // L7: no email books the visit without an invite. An address that can't take one is still refused, on the field that holds it.
        // A converted enquiry's email is read-only (D7), so one that can't take the invite books as no email instead of leaving the visit stuck.
        if (sends && email is not null && !IsSendable(email) && inquiry.ParticipantId is null)
            errors["contactEmail"] = [inquiry.Email is null ? "Enter a full email address, like name@example.com." : "This email can't take the invite. Check it on the enquiry, or clear it there to book without one."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        // D4: whoever goes must be free. Checked only when the visit's time, length or person changes, so notes or a new place still save after a shift
        // has been rostered over the visit.
        if ((timeChanged || inquiry.IntakeDurationMinutes != dto.DurationMinutes || previousStaffId != dto.StaffUserId)
            && await ClashAsync(inquiry, staff!, startsAt, dto.DurationMinutes, ct) is string clash)
            return Conflict(new ValidationProblemDetails(new Dictionary<string, string[]> { ["staffUserId"] = [clash] })
                { Status = StatusCodes.Status409Conflict, Extensions = { ["code"] = StaffBusyCode } });

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
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));

        // With no email nothing is sent and nothing recorded: the last send's time and error stay as they were (null on a new booking).
        if (from is not null && inquiry.Email is not null && IsSendable(inquiry.Email))
        {
            // Saved first, then sent, so an invite never goes out for a booking that failed to save. The send and the stored outcome do not take the
            // request's token: a browser that goes away mid-send must not abort an invite the saved booking promises (the sender bounds it at 30 s).
            var outcome = await _sender.SendAsync(ContactMessage(inquiry, Wording(inquiry), staff, provider, from), CancellationToken.None);
            Record(inquiry, outcome, NowUtc);
            await SavedAsync(CancellationToken.None); // false: a newer revision owns the row, so this send's outcome is dropped
        }
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, staff, provider.ZoneId)));
    }

    [HttpDelete("inquiries/{id:guid}/intake-booking")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<CancelIntakeBookingResultDto>>> Cancel(Guid id, CancellationToken ct, [FromQuery] DateTime? expectedUpdatedAt = null)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<CancelIntakeBookingResultDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is not DateTime start) return NotFound(ApiResponse<CancelIntakeBookingResultDto>.Fail("No intake visit is booked for this enquiry."));
        // A visit that has happened stays on the enquiry as its record; it can be rescheduled, not cancelled.
        if (ProviderLocalTime.AsUtc(start).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) <= NowUtc)
            return Conflict(ApiResponse<CancelIntakeBookingResultDto>.Fail("This visit has already happened, so it can't be cancelled."));
        // ODIP-REVIEW-268: the version the form holds goes into the UPDATE's WHERE, so a write from a stale form is a 409 and nothing of it saves.
        if (expectedUpdatedAt is DateTime expected) _db.Entry(inquiry).Property(x => x.UpdatedAt).OriginalValue = expected;

        var provider = await ProviderAsync(inquiry.TenantId, ct);
        var cancellation = await CancelVisitAsync(inquiry, provider, ct);
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<CancelIntakeBookingResultDto>.Fail(ChangedByOther));

        var email = await SendCancellationAsync(cancellation);
        return Ok(ApiResponse<CancelIntakeBookingResultDto>.Ok(new CancelIntakeBookingResultDto
        {
            Inquiry = ParticipantInquiriesController.ToDto(inquiry, null, provider.ZoneId), CancellationEmail = email,
        }));
    }

    /// <summary>
    /// Cancels the enquiry's visit on the tracked row: the next SEQUENCE, the staff member's CANCEL raised (an outbox row in the caller's save) and the
    /// columns cleared. Returns the contact's cancellation to send AFTER the caller's save, or null when no invite had gone out. Used by Cancel and Close.
    /// </summary>
    private async Task<NotificationMessage?> CancelVisitAsync(ParticipantInquiry inquiry, Provider provider, CancellationToken ct)
    {
        var staff = await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct);
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
        return cancellation;
    }

    /// <summary>What became of the contact's cancellation: "NoInvite" (none had gone out, so nobody is emailed), "Sent", "NotConfigured" or "Failed".</summary>
    private async Task<string> SendCancellationAsync(NotificationMessage? cancellation)
    {
        if (cancellation is null) return "NoInvite";
        // Not on the request's token: the booking is already cleared, so a CANCEL aborted with the browser could never be sent again.
        var outcome = await _sender.SendAsync(cancellation, CancellationToken.None);
        return outcome.Sent ? "Sent" : outcome.ErrorCode ?? IntakeSendOutcome.Failed;
    }

    public const string ClosedCode = "inquiry-closed";
    public const string ClosedRefusal = "This enquiry is closed. Reopen it first.";

    /// <summary>
    /// Closes an enquiry (spec addendum E1-E2): why (an outcome, an optional note), in one save with the upcoming visit's cancellation (as Cancel does it,
    /// staff CANCEL included) and the deletion of its pending contacts. The contact's cancellation email goes after the save. A converted enquiry can't close.
    /// Bumping UpdatedAt (the enforced version) makes any write that loaded the enquiry before this a 409.
    /// </summary>
    [HttpPost("inquiries/{id:guid}/close")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<CloseInquiryResultDto>>> Close(Guid id, CloseInquiryDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<CloseInquiryResultDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null) return NotFound(ApiResponse<CloseInquiryResultDto>.Fail("Inquiry not found"));
        var note = Blank(dto.Note);
        var errors = new Dictionary<string, string[]>();
        if (dto.Outcome is not { } outcome || !Enum.IsDefined(outcome)) errors["outcome"] = ["Choose why it's closing."];
        if (note?.Length > 500) errors["note"] = ["Keep the note under 500 characters."];
        if (errors.Count > 0) return ValidationProblem(new ValidationProblemDetails(errors));
        if (inquiry.ClosedAt is not null) return Conflict(ApiResponse<CloseInquiryResultDto>.Fail("This enquiry is already closed.", ClosedCode));
        if (inquiry.ParticipantId is not null)
            return Conflict(ApiResponse<CloseInquiryResultDto>.Fail($"Intake has started for {inquiry.FirstName}, so this enquiry can't be closed.", "inquiry-converted"));
        // The version the screen loaded goes into the UPDATE's WHERE: a booking or an edit since then makes this close a 409, and nothing of it saves (verify C1).
        if (dto.ExpectedUpdatedAt is DateTime expected) _db.Entry(inquiry).Property(x => x.UpdatedAt).OriginalValue = expected;

        // Only an upcoming visit is cancelled: one that has happened stays on the enquiry as its record (as Cancel refuses to cancel it).
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        var upcoming = inquiry.IntakeStartsAt is DateTime start && ProviderLocalTime.AsUtc(start).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) > NowUtc;
        var cancellation = upcoming ? await CancelVisitAsync(inquiry, provider, ct) : null;
        _db.InquiryContacts.RemoveRange(await _db.InquiryContacts.Where(c => c.InquiryId == inquiry.Id && c.TenantId == inquiry.TenantId).ToListAsync(ct));
        inquiry.ClosedAt = NowUtc; inquiry.ClosedByUserId = (await CallerAsync(ct))?.Id; inquiry.CloseOutcome = dto.Outcome; inquiry.CloseNote = note; inquiry.UpdatedAt = NowUtc;
        // The trail keeps who, when and why, and nothing personal: never the whole enquiry (Decision 7).
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(ParticipantInquiry), inquiry.Id, "Close", null, dto.Outcome!.Value.ToString(), User));
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<CloseInquiryResultDto>.Fail(EnquiryChangedByOther));

        var email = upcoming ? await SendCancellationAsync(cancellation) : "NoVisit";
        return Ok(ApiResponse<CloseInquiryResultDto>.Ok(new CloseInquiryResultDto { Inquiry = ParticipantInquiriesController.ToDto(inquiry, null, provider.ZoneId), CancellationEmail = email }));
    }

    /// <summary>Reopens a closed enquiry (spec addendum E3): the close is cleared; its contacts and any cancelled visit don't come back.</summary>
    [HttpPost("inquiries/{id:guid}/reopen")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Reopen(Guid id, CancellationToken ct, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] InquiryVersionDto? dto = null)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("Inquiry not found"));
        if (inquiry.ClosedAt is null) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("This enquiry is already open.", "inquiry-open"));
        if (dto?.ExpectedUpdatedAt is DateTime expected) _db.Entry(inquiry).Property(x => x.UpdatedAt).OriginalValue = expected;
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(ParticipantInquiry), inquiry.Id, "Reopen", inquiry.CloseOutcome?.ToString(), null, User));
        inquiry.ClosedAt = null; inquiry.ClosedByUserId = null; inquiry.CloseOutcome = null; inquiry.CloseNote = null; inquiry.UpdatedAt = NowUtc;
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(EnquiryChangedByOther));
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, null, provider.ZoneId)));
    }

    /// <summary>The family replied or rang: the coordinator marks it by hand (no confirm link in v1). Emails nobody.</summary>
    [HttpPost("inquiries/{id:guid}/intake-booking/confirm")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Confirm(Guid id, ConfirmIntakeBookingDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is null) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("No intake visit is booked for this enquiry."));
        // A closed enquiry keeps a past visit as its record; it is not marked confirmed after the fact (verify C2).
        if (inquiry.ClosedAt is not null) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ClosedRefusal, ClosedCode));
        inquiry.IntakeConfirmedAt = dto.Confirmed ? NowUtc : null;
        inquiry.UpdatedAt = NowUtc;
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        return Ok(ApiResponse<ParticipantInquiryDto>.Ok(ParticipantInquiriesController.ToDto(inquiry, await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct), provider.ZoneId)));
    }

    /// <summary>Send again: the current invite, with the same UID and SEQUENCE, to the enquiry's current email. The outcome is stored like any send.</summary>
    [HttpPost("inquiries/{id:guid}/intake-booking/send")]
    [Authorize(Roles = LifecycleRoles)]
    public async Task<ActionResult<ApiResponse<ParticipantInquiryDto>>> Resend(Guid id, CancellationToken ct, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] InquiryVersionDto? dto = null)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ParticipantInquiryDto>.Fail("A tenant context is required."));
        var inquiry = await _db.ParticipantInquiries.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId, ct);
        if (inquiry is null || inquiry.IntakeStartsAt is not DateTime start) return NotFound(ApiResponse<ParticipantInquiryDto>.Fail("No intake visit is booked for this enquiry."));
        if (ProviderLocalTime.AsUtc(start).AddMinutes(inquiry.IntakeDurationMinutes ?? DefaultDuration) <= NowUtc)
            return Conflict(ApiResponse<ParticipantInquiryDto>.Fail("This visit has already happened, so there's no invite to send."));
        if (inquiry.Email is null || !IsSendable(inquiry.Email))
            return ValidationProblem(new ValidationProblemDetails(new Dictionary<string, string[]> { ["contactEmail"] = ["Add the main contact's email to send the invite."] }));
        // ODIP-REVIEW-268: the email goes before any save, so the version is compared here, before sending: a form that holds an older version (another
        // address, a moved visit) gets the 409 and nobody is emailed. Two requests at the same instant can still both pass; the outcome save then drops the loser's.
        if (dto?.ExpectedUpdatedAt is DateTime expected && inquiry.UpdatedAt != new DateTime(expected.Ticks - expected.Ticks % 10, expected.Kind))
            return Conflict(ApiResponse<ParticipantInquiryDto>.Fail(ChangedByOther));

        var staff = await StaffAsync(inquiry.IntakeStaffUserId, inquiry.TenantId, ct);
        var provider = await ProviderAsync(inquiry.TenantId, ct);
        var from = await InviteFromAsync(inquiry, await CallerAsync(ct), ct);
        var outcome = await _sender.SendAsync(ContactMessage(inquiry, Wording(inquiry), staff, provider, from), CancellationToken.None);
        Record(inquiry, outcome, NowUtc);
        inquiry.UpdatedAt = NowUtc;
        await SavedAsync(CancellationToken.None); // false: a newer revision owns the row, so this send's outcome is dropped
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
            // A closed enquiry's retained past visit is its record, not a visit to be done (check S2).
            .Where(x => x.TenantId == tenantId && x.ClosedAt == null && x.IntakeStartsAt != null && x.IntakeStartsAt >= fromUtc && x.IntakeStartsAt < toUtc
                        && (staffUserId == null || x.IntakeStaffUserId == staffUserId))
            .OrderBy(x => x.IntakeStartsAt)
            .ToListAsync(ct); // the entities, not a projection: the gates below are computed members, and the rows are few

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
                InquiryId = r.Id, FirstName = r.FirstName, LastName = r.LastName ?? string.Empty, ParticipantId = r.ParticipantId,
                HasAddress = r.HasFullAddress, ContactNeedsName = r.ContactNeedsName,
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
        return id is Guid userId ? await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == _tenant.TenantId, ct) : null; // view-as must name a user of this organisation
    }

    // Keyed on the enquiry's organisation, never the ambient filter (a SuperAdmin has none): another organisation's user is simply not found.
    private async Task<User?> StaffAsync(Guid? id, Guid tenantId, CancellationToken ct) =>
        id is Guid staffId ? await _db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Id == staffId && u.TenantId == tenantId, ct) : null;

    // Who an invite is from (lead decision S2). ORGANIZER and Reply-To stay the coordinator who booked, for every revision of the UID: calendar apps
    // treat a changed ORGANIZER as another event. A booker since deactivated stays ORGANIZER (the address only identifies the event, and the system
    // never mails it) while replies go to whoever is acting now; a booker with no email left cannot be ORGANIZER at all.
    private sealed record InviteFrom(string? OrganizerName, string? OrganizerEmail, string? ReplyTo, string BookedByName);

    private async Task<InviteFrom> InviteFromAsync(ParticipantInquiry x, User? caller, CancellationToken ct)
    {
        var booker = await StaffAsync(x.IntakeBookedByUserId, x.TenantId, ct);
        var organizer = booker is not null && !string.IsNullOrWhiteSpace(booker.Email) ? booker : null;
        var replyTo = organizer is { IsActive: true } ? organizer.Email : caller?.Email;
        return new InviteFrom(organizer?.FullName, organizer?.Email, replyTo, booker?.FullName ?? caller?.FullName ?? "A coordinator");
    }

    // G7: the first invite that goes out reads as one ("Your intake visit…"), even when the visit was booked, or moved, with no email to send it to.
    private static string Wording(ParticipantInquiry x) => x.IntakeInviteSentAt is null || x.IntakeIcsSequence == 0 ? IntakeWording.Booked : IntakeWording.Changed;

    private NotificationMessage ContactMessage(ParticipantInquiry x, string kind, User? staff, Provider provider, InviteFrom from) =>
        IntakeInviteTemplate.Render(new IntakeInvitePayload(
            kind, x.Email!, x.FirstName, x.FullName, provider.Name, provider.Address,
            ProviderLocalTime.AsUtc(x.IntakeStartsAt!.Value), x.IntakeDurationMinutes ?? DefaultDuration, provider.ZoneId, x.IntakeLocation ?? string.Empty,
            staff?.FullName ?? string.Empty, provider.ManagerName, provider.ManagerPhone,
            ReplyTo: from.ReplyTo, OrganizerName: from.OrganizerName, Uid: x.IntakeUid!, Sequence: x.IntakeIcsSequence, StampUtc: NowUtc,
            OrganizerEmail: from.OrganizerEmail, RecipientFirstName: x.InviteeFirstName, RecipientFullName: x.ContactIsParticipant ? x.FullName : x.ContactFullName));

    // A fresh EntityId for each revision, on purpose: the raiser drops a second row for the same (type, entity, recipient) within 5 minutes, and a
    // reschedule a minute after booking must still reach the staff member's calendar. A repeated save with nothing changed raises nothing.
    private Task RaiseStaffAsync(ParticipantInquiry x, User staff, string kind, Provider provider, InviteFrom from, CancellationToken ct) =>
        _raiser.RaiseAsync(NotificationEventType.IntakeBooked, "IntakeVisit", Guid.NewGuid(), [staff.Id],
            new IntakeVisitStaffPayload(
                kind, staff.Email, staff.FullName, x.FullName, ProviderLocalTime.AsUtc(x.IntakeStartsAt!.Value),
                x.IntakeDurationMinutes ?? DefaultDuration, provider.ZoneId, x.IntakeLocation ?? string.Empty, x.Phone, x.Email, x.IntakeNotes,
                from.BookedByName, from.OrganizerEmail, provider.Name, provider.ManagerName, provider.ManagerPhone,
                x.IntakeUid!, x.IntakeIcsSequence, NowUtc, ReplyTo: from.ReplyTo, ContactName: x.ContactIsParticipant ? "Their own contact" : x.ContactFullName), ct);

    private const string ChangedByOther = "Someone else just changed this visit. Reload and try again.";
    // Close and Reopen change the enquiry, not its visit: they say so as the enquiry's own edit does (ParticipantInquiriesController.ChangedByOther).
    private const string EnquiryChangedByOther = "Someone else just changed this enquiry. Reload and try again.";

    // IntakeIcsSequence and IntakeUid are concurrency tokens: a write based on a revision someone else has since replaced matches no row.
    private async Task<bool> SavedAsync(CancellationToken ct)
    {
        try
        {
            await _db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }

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
    /// <summary>
    /// Why <paramref name="staff"/> can't do a visit at [start, start + minutes), or null when they're free (spec 2026-10-16, D4): a shift of theirs that isn't
    /// cancelled (its rostered times, in the provider's wall clock as the roster stores them), or another enquiry's visit. Back to back is free: windows must
    /// overlap, not touch. Both reads are keyed on the enquiry's organisation (a SuperAdmin's context has no filter).
    /// shortcut: two bookings saved at the same moment can both pass; lock the staff member's row if double bookings are ever seen.
    /// </summary>
    private async Task<string?> ClashAsync(ParticipantInquiry inquiry, User staff, DateTime startUtc, int minutes, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, inquiry.TenantId, ct)).Zone;
        var endUtc = startUtc.AddMinutes(minutes);
        var (from, to) = (ProviderLocalTime.UtcToLocal(startUtc, zone), ProviderLocalTime.UtcToLocal(endUtc, zone));
        // A shift that ends the next day began the day before: one day back finds it.
        var (firstDay, lastDay) = (DateOnly.FromDateTime(from).AddDays(-1), DateOnly.FromDateTime(to));
        var shifts = await _db.Shifts.IgnoreQueryFilters()
            .Where(s => s.TenantId == inquiry.TenantId && s.UserId == staff.Id && s.Status != ShiftStatus.Cancelled && s.ServiceDate >= firstDay && s.ServiceDate <= lastDay)
            .ToListAsync(ct);
        var shift = shifts.Select(ProviderLocalTime.RosteredWindowLocal).Where(w => w.StartLocal < to && from < w.EndLocal).OrderBy(w => w.StartLocal).FirstOrDefault();
        if (shift != default) return $"{staff.FullName} is on a shift {IntakeWording.Span(shift.StartLocal, shift.EndLocal)} on {IntakeWording.ShortDay(shift.StartLocal)}.";

        // A visit is at most 8 hours long (Set's own limit), so one that overlaps began less than 8 hours before this one. The overlap is worked out here, not in SQL.
        var visits = await _db.ParticipantInquiries.IgnoreQueryFilters()
            .Where(x => x.TenantId == inquiry.TenantId && x.Id != inquiry.Id && x.IntakeStaffUserId == staff.Id && x.IntakeStartsAt > startUtc.AddMinutes(-480) && x.IntakeStartsAt < endUtc)
            .Select(x => new { x.IntakeStartsAt, x.IntakeDurationMinutes }).ToListAsync(ct);
        var visit = visits.Select(v => (Start: ProviderLocalTime.AsUtc(v.IntakeStartsAt!.Value), End: ProviderLocalTime.AsUtc(v.IntakeStartsAt!.Value).AddMinutes(v.IntakeDurationMinutes ?? DefaultDuration)))
            .Where(v => v.End > startUtc).OrderBy(v => v.Start).FirstOrDefault();
        if (visit == default) return null;
        var (visitFrom, visitTo) = (ProviderLocalTime.UtcToLocal(visit.Start, zone), ProviderLocalTime.UtcToLocal(visit.End, zone));
        return $"{staff.FullName} has another intake visit {IntakeWording.Span(visitFrom, visitTo)} on {IntakeWording.ShortDay(visitFrom)}.";
    }

    internal static bool IsSendable(string email) => email.Length <= 200 && MailAddress.TryCreate(email, out var parsed) && parsed.Address == email;

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
