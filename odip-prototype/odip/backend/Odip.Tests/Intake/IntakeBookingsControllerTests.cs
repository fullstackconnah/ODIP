using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>Booking an intake visit from an enquiry: validation, tenancy, the invite sent and its outcome stored, and the staff member's outbox rows.</summary>
public class IntakeBookingsControllerTests
{
    internal static readonly DateTime Now = new(2026, 10, 14, 3, 0, 0, DateTimeKind.Utc);    // Wed 14 Oct 2026, 2:00 pm in Sydney
    internal static readonly DateTime Start = new(2026, 10, 15, 23, 0, 0, DateTimeKind.Utc); // Fri 16 Oct 2026, 10:00 am in Sydney

    internal sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now);
    }

    internal sealed class RecordingChannel(ChannelSendOutcome outcome) : INotificationChannel
    {
        public ChannelSendOutcome Outcome { get; set; } = outcome; // a test can switch SMTP on or off between calls
        public List<NotificationMessage> Sent { get; } = [];
        public NotificationChannelKind Kind => NotificationChannelKind.Email;
        public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
        {
            Sent.Add(message);
            return Task.FromResult(new ChannelSendResult(Outcome, null, Outcome == ChannelSendOutcome.Skipped ? "SMTP is not configured" : null));
        }
    }

    internal sealed class Fixture
    {
        public Guid TenantId { get; } = Guid.NewGuid();
        public OdipDbContext Db { get; }
        public User Dana { get; }  // the signed-in coordinator who books
        public User Sam { get; }   // an admin who can be sent
        public ParticipantInquiry Noah { get; }
        public RecordingChannel Channel { get; }

        public Fixture(ChannelSendOutcome outcome = ChannelSendOutcome.Skipped, string? contactEmail = "priya.nair@example.com.au")
        {
            Db = TestDb.ForTenant(Guid.NewGuid().ToString(), TenantId);
            Dana = Staff("Dana", "Smith", UserRole.Coordinator, "dana@provider.example");
            Sam = Staff("Sam", "Lee", UserRole.Admin, "sam@provider.example");
            Db.Users.AddRange(Dana, Sam);
            Db.ProviderSettings.Add(new ProviderSettings
            {
                Id = Guid.NewGuid(), TenantId = TenantId, State = "NSW", OrganisationName = "Sample Support Co", Address = "1 George St, Sydney",
                ManagerName = "Alex Brown", ManagerPhone = "02 9000 0000",
            });
            Noah = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = TenantId, FirstName = "Noah", LastName = "Fitzgerald", Source = "Phone", Phone = "0412 555 010", Email = contactEmail };
            Db.ParticipantInquiries.Add(Noah);
            Db.SaveChanges();
            Channel = new RecordingChannel(outcome);
        }

        public User Staff(string first, string last, UserRole role, string? email = null, bool active = true, Guid? tenantId = null) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantId, Username = $"{first}{Guid.NewGuid():N}", Email = email ?? $"{Guid.NewGuid():N}@example.com",
            FirstName = first, LastName = last, Role = role, IsActive = active,
        };

        public IntakeBookingsController Controller(DateTime? now = null, string role = "Coordinator", Guid? userId = null, Guid? tenantId = null, bool superAdmin = false,
            bool noTenant = false, INotificationChannel? channel = null)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.SetupGet(t => t.TenantId).Returns(noTenant ? (Guid?)null : tenantId ?? TenantId);
            tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
            var sender = new IntakeInviteSender([channel ?? Channel], NullLogger<IntakeInviteSender>.Instance);
            var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, (userId ?? Dana.Id).ToString()), new Claim(ClaimTypes.Role, role)], "test");
            return new IntakeBookingsController(Db, tenant.Object, sender, new NotificationRaiser(Db), new FixedClock(now ?? Now))
            {
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
            };
        }

        public SetIntakeBookingDto Body(Guid? staffId = null) => new()
        {
            StartsAt = Start, DurationMinutes = 90, Location = "12 Smith St, Parramatta", StaffUserId = staffId ?? Sam.Id, Notes = "Bring the consent forms",
        };

        public async Task<ParticipantInquiryDto> BookAsync(SetIntakeBookingDto? body = null, DateTime? now = null) =>
            Ok<ParticipantInquiryDto>((await Controller(now).Set(Noah.Id, body ?? Body(), CancellationToken.None)).Result!);

        public ParticipantInquiry Row() => Db.ParticipantInquiries.AsNoTracking().Single(x => x.Id == Noah.Id);
        public List<NotificationOutbox> Outbox() => Db.NotificationOutbox.AsNoTracking().OrderBy(o => o.CreatedAt).ToList();
    }

    internal static T Ok<T>(IActionResult result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    internal static IDictionary<string, string[]> Problems(IActionResult result) =>
        Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>(result).Value).Errors;

    private static JsonElement Payload(NotificationOutbox row) => JsonDocument.Parse(row.PayloadJson).RootElement;

    [Fact]
    public async Task A_new_booking_saves_sends_the_invite_and_stores_not_configured_when_there_is_no_smtp()
    {
        var f = new Fixture(ChannelSendOutcome.Skipped);

        var dto = await f.BookAsync();

        Assert.Equal(Start, dto.IntakeStartsAt);
        Assert.Equal(90, dto.IntakeDurationMinutes);
        Assert.Equal("12 Smith St, Parramatta", dto.IntakeLocation);
        Assert.Equal(f.Sam.Id, dto.IntakeStaffUserId);
        Assert.Equal("Sam", dto.IntakeStaffFirstName);
        Assert.Equal("Bring the consent forms", dto.IntakeNotes);
        Assert.Equal("NotConfigured", dto.IntakeInviteError);
        Assert.Null(dto.IntakeInviteSentAt);
        Assert.Equal("Australia/Sydney", dto.TimeZoneId);
        var row = f.Row();
        Assert.Equal(0, row.IntakeIcsSequence);
        Assert.EndsWith("@odip", row.IntakeUid);
        Assert.Equal(f.Dana.Id, row.IntakeBookedByUserId);
        var email = Assert.Single(f.Channel.Sent);
        Assert.Equal("priya.nair@example.com.au", email.RecipientAddress);
        Assert.Equal("Your intake visit with Sample Support Co: Fri 16 Oct, 10:00 am", email.Subject);
        Assert.Equal("dana@provider.example", email.ReplyTo);
        Assert.Equal("REQUEST", email.Ics!.Method);
        Assert.Contains($"UID:{row.IntakeUid}", email.Ics.Content);
        Assert.DoesNotContain("consent", email.PlainTextBody); // the notes are internal
        var staffRow = Assert.Single(f.Outbox());
        Assert.Equal((NotificationEventType.IntakeBooked, "IntakeVisit", f.Sam.Id), (staffRow.EventType, staffRow.EntityType, staffRow.RecipientUserId));
        Assert.Equal("Booked", Payload(staffRow).GetProperty("Kind").GetString());
        Assert.Equal("Bring the consent forms", Payload(staffRow).GetProperty("Notes").GetString());
        Assert.Equal("Dana Smith", Payload(staffRow).GetProperty("BookedByName").GetString());
    }

    [Fact]
    public async Task A_send_that_works_stores_when_it_went_and_no_error()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);

        var dto = await f.BookAsync();

        Assert.Equal(Now, dto.IntakeInviteSentAt);
        Assert.Null(dto.IntakeInviteError);
    }

    [Fact]
    public async Task A_failed_send_is_stored_as_failed_and_the_booking_is_kept()
    {
        var f = new Fixture(ChannelSendOutcome.TransientFailure);

        var dto = await f.BookAsync();

        Assert.Equal("Failed", dto.IntakeInviteError);
        Assert.Equal(Start, f.Row().IntakeStartsAt);
    }

    [Fact]
    public async Task A_reschedule_bumps_the_sequence_keeps_the_uid_sends_an_update_and_needs_confirming_again()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        var uid = f.Row().IntakeUid;
        f.Db.ParticipantInquiries.Single(x => x.Id == f.Noah.Id).IntakeConfirmedAt = Now; // the family had confirmed the old time
        f.Db.SaveChanges();

        var dto = await f.BookAsync(f.Body() with { StartsAt = Start.AddDays(1) });

        var row = f.Row();
        Assert.Equal((1, uid), (row.IntakeIcsSequence, row.IntakeUid));
        Assert.Null(dto.IntakeConfirmedAt);
        Assert.Equal(2, f.Channel.Sent.Count);
        Assert.StartsWith("Updated: your intake visit", f.Channel.Sent[1].Subject);
        Assert.Contains("SEQUENCE:1", f.Channel.Sent[1].Ics!.Content);
        // Two rows for Sam inside five minutes: each revision gets its own entity id, so the raiser's dedupe cannot swallow the update.
        Assert.Equal(new[] { "Booked", "Changed" }, f.Outbox().Select(o => Payload(o).GetProperty("Kind").GetString()).Order().ToArray());
    }

    [Fact]
    public async Task A_notes_only_save_emails_nobody_and_keeps_the_sequence()
    {
        var f = new Fixture();
        await f.BookAsync();

        var dto = await f.BookAsync(f.Body() with { Notes = "Side gate, dog is friendly" });

        Assert.Equal("Side gate, dog is friendly", dto.IntakeNotes);
        Assert.Single(f.Channel.Sent);
        Assert.Single(f.Outbox());
        Assert.Equal(0, f.Row().IntakeIcsSequence);
    }

    // A double click, or a retry after a slow answer: the second identical save changes nothing, so it sends nothing.
    [Fact]
    public async Task Saving_the_same_booking_twice_sends_one_invite()
    {
        var f = new Fixture();

        await f.BookAsync();
        await f.BookAsync();

        Assert.Single(f.Channel.Sent);
        Assert.Single(f.Outbox());
        Assert.Equal(0, f.Row().IntakeIcsSequence);
    }

    [Fact]
    public async Task Changing_who_goes_cancels_for_the_old_staff_member_and_books_the_new_one()
    {
        var f = new Fixture();
        await f.BookAsync();

        await f.BookAsync(f.Body(f.Dana.Id));

        string?[] KindsFor(Guid userId) => f.Outbox().Where(r => r.RecipientUserId == userId).Select(r => Payload(r).GetProperty("Kind").GetString()).Order().ToArray();
        Assert.Equal(new[] { "Booked", "Cancelled" }, KindsFor(f.Sam.Id));
        Assert.Equal(new[] { "Booked" }, KindsFor(f.Dana.Id));
        Assert.Contains("Dana Smith", f.Channel.Sent[1].PlainTextBody); // "Who's coming"
    }

    [Fact]
    public async Task A_past_visit_can_still_have_its_notes_saved()
    {
        var f = new Fixture();
        await f.BookAsync();

        var result = await f.Controller(now: Start.AddHours(3)).Set(f.Noah.Id, f.Body() with { Notes = "Went well" }, CancellationToken.None);

        Assert.Equal("Went well", Ok<ParticipantInquiryDto>(result.Result!).IntakeNotes);
        Assert.Single(f.Channel.Sent);
    }

    // A staff member deactivated (or moved to support worker) after booking keeps the visit until it is rescheduled; then someone eligible must go.
    [Fact]
    public async Task A_since_deactivated_staff_member_keeps_the_visit_until_it_is_rescheduled()
    {
        var f = new Fixture();
        await f.BookAsync();
        f.Db.Users.Single(u => u.Id == f.Sam.Id).IsActive = false;
        f.Db.SaveChanges();

        await f.BookAsync(f.Body() with { Notes = "Updated notes" });
        var reschedule = await f.Controller().Set(f.Noah.Id, f.Body() with { StartsAt = Start.AddDays(1) }, CancellationToken.None);

        Assert.Equal(new[] { "Sam can't do intakes. Choose an active coordinator or admin." }, Problems(reschedule.Result!)["staffUserId"]);
        Assert.Equal(Start, f.Row().IntakeStartsAt);
    }

    public static TheoryData<string, string, string> Refusals => new()
    {
        { "past", "startsAt", "Choose a time that hasn't passed." },
        { "short", "durationMinutes", "Choose a length between 15 minutes and 8 hours." },
        { "long", "durationMinutes", "Choose a length between 15 minutes and 8 hours." },
        { "nowhere", "location", "Say where the visit is." },
        { "far", "location", "Keep it under 300 characters." },
        { "notes", "notes", "Keep notes under 1,000 characters." },
        { "nobody", "staffUserId", "Choose who's going." },
    };

    [Theory]
    [MemberData(nameof(Refusals))]
    public async Task An_invalid_booking_is_refused_on_its_field_and_nothing_is_saved_or_sent(string @case, string field, string sentence)
    {
        var f = new Fixture();
        var body = @case switch
        {
            "past" => f.Body() with { StartsAt = Now.AddMinutes(-1) },
            "short" => f.Body() with { DurationMinutes = 14 },
            "long" => f.Body() with { DurationMinutes = 481 },
            "nowhere" => f.Body() with { Location = "   " },
            "far" => f.Body() with { Location = new string('x', 301) },
            "notes" => f.Body() with { Notes = new string('x', 1001) },
            _ => f.Body() with { StaffUserId = Guid.NewGuid() },
        };

        var result = await f.Controller().Set(f.Noah.Id, body, CancellationToken.None);

        Assert.Equal(new[] { sentence }, Problems(result.Result!)[field]);
        Assert.Null(f.Row().IntakeStartsAt);
        Assert.Empty(f.Channel.Sent);
        Assert.Empty(f.Outbox());
    }

    [Theory]
    [InlineData(UserRole.SupportWorker, true)]
    [InlineData(UserRole.ReadOnly, true)]
    [InlineData(UserRole.SuperAdmin, true)]
    [InlineData(UserRole.Coordinator, false)]
    public async Task Only_an_active_coordinator_or_admin_can_be_sent(UserRole role, bool active)
    {
        var f = new Fixture();
        var jo = f.Staff("Jo", "Ng", role, active: active);
        f.Db.Users.Add(jo);
        f.Db.SaveChanges();

        var result = await f.Controller().Set(f.Noah.Id, f.Body(jo.Id), CancellationToken.None);

        Assert.Equal(new[] { "Jo can't do intakes. Choose an active coordinator or admin." }, Problems(result.Result!)["staffUserId"]);
    }

    // The staff lookup is keyed on the ENQUIRY's organisation, so a SuperAdmin (whose context has no query filter) cannot send another organisation's user.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_staff_member_of_another_organisation_is_not_found_and_not_named(bool superAdmin)
    {
        var f = new Fixture();
        var kim = f.Staff("Kim", "Other", UserRole.Coordinator, tenantId: Guid.NewGuid());
        f.Db.Users.Add(kim);
        f.Db.SaveChanges();

        var result = await f.Controller(superAdmin: superAdmin, role: superAdmin ? "SuperAdmin" : "Coordinator").Set(f.Noah.Id, f.Body(kim.Id), CancellationToken.None);

        Assert.Equal(new[] { "Choose who's going." }, Problems(result.Result!)["staffUserId"]);
    }

    [Fact]
    public async Task An_enquiry_of_another_organisation_is_not_found_and_untouched()
    {
        var f = new Fixture();

        var result = await f.Controller(tenantId: Guid.NewGuid()).Set(f.Noah.Id, f.Body(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Null(f.Row().IntakeStartsAt);
        Assert.Empty(f.Channel.Sent);
    }

    [Fact]
    public async Task Without_a_tenant_context_nothing_is_booked()
    {
        var f = new Fixture();

        var result = await f.Controller(noTenant: true).Set(f.Noah.Id, f.Body(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Null(f.Row().IntakeStartsAt);
    }

    [Fact]
    public async Task A_contact_without_an_email_must_be_given_one_and_it_is_saved_with_the_booking()
    {
        var f = new Fixture(contactEmail: null);
        var controller = f.Controller();

        var missing = await controller.Set(f.Noah.Id, f.Body(), CancellationToken.None);
        var invalid = await controller.Set(f.Noah.Id, f.Body() with { ContactEmail = "noah at home" }, CancellationToken.None);
        var dto = Ok<ParticipantInquiryDto>((await controller.Set(f.Noah.Id, f.Body() with { ContactEmail = " noah@example.com " }, CancellationToken.None)).Result!);

        Assert.Equal(new[] { "Add Noah's email to send the invite." }, Problems(missing.Result!)["contactEmail"]);
        Assert.Equal(new[] { "Enter a full email address, like name@example.com." }, Problems(invalid.Result!)["contactEmail"]);
        Assert.Equal("noah@example.com", dto.Email);
        Assert.Equal("noah@example.com", f.Row().Email);
        Assert.Equal("noah@example.com", Assert.Single(f.Channel.Sent).RecipientAddress);
    }

    [Fact]
    public async Task A_contact_email_sent_for_an_enquiry_that_already_has_one_is_ignored()
    {
        var f = new Fixture();

        await f.BookAsync(f.Body() with { ContactEmail = "someone.else@example.com" });

        Assert.Equal("priya.nair@example.com.au", f.Row().Email);
        Assert.Equal("priya.nair@example.com.au", Assert.Single(f.Channel.Sent).RecipientAddress);
    }

    private static void ClearEnquiryEmail(Fixture f)
    {
        f.Db.ParticipantInquiries.Single(x => x.Id == f.Noah.Id).Email = null;
        f.Db.SaveChanges();
    }

    // The contact's email is needed only by a save that emails them (call 9): notes on a visit whose email was later cleared still save.
    [Fact]
    public async Task A_notes_only_save_still_works_after_the_enquiry_email_was_cleared()
    {
        var f = new Fixture();
        await f.BookAsync();
        ClearEnquiryEmail(f);

        var dto = await f.BookAsync(f.Body() with { Notes = "Called the GP" });

        Assert.Equal("Called the GP", dto.IntakeNotes);
        Assert.Single(f.Channel.Sent);
    }

    [Fact]
    public async Task Giving_the_missing_email_on_a_booked_visit_saves_it_and_sends_the_invite_there()
    {
        var f = new Fixture();
        await f.BookAsync();
        ClearEnquiryEmail(f);

        await f.BookAsync(f.Body() with { ContactEmail = "noah@example.com" });

        Assert.Equal("noah@example.com", f.Row().Email);
        Assert.Equal("noah@example.com", f.Channel.Sent[1].RecipientAddress);
        Assert.Equal(1, f.Row().IntakeIcsSequence);
    }

    // Lead decision S2: one UID keeps one ORGANIZER. A reschedule by another coordinator still comes from the one who booked.
    [Fact]
    public async Task A_reschedule_by_another_coordinator_keeps_the_first_organizer_and_reply_to()
    {
        var f = new Fixture();
        await f.BookAsync();

        await f.Controller(userId: f.Sam.Id, role: "Admin").Set(f.Noah.Id, f.Body() with { StartsAt = Start.AddDays(1) }, CancellationToken.None);

        var update = f.Channel.Sent[1];
        Assert.Equal("dana@provider.example", update.ReplyTo);
        Assert.Contains("ORGANIZER;CN=\"Dana Smith\":mailto:dana@provider.example", update.Ics!.Content.Replace("\r\n ", ""));
        Assert.Equal(f.Dana.Id, f.Row().IntakeBookedByUserId);
        Assert.All(f.Outbox(), o => Assert.Equal("Dana Smith", Payload(o).GetProperty("BookedByName").GetString()));
    }

    [Theory]
    [InlineData("deactivated")]
    [InlineData("no email")]
    public async Task When_the_booker_can_no_longer_organise_the_organizer_is_left_out_and_reply_to_is_whoever_acts(string what)
    {
        var f = new Fixture();
        await f.BookAsync();
        var dana = f.Db.Users.Single(u => u.Id == f.Dana.Id);
        if (what == "deactivated") dana.IsActive = false; else dana.Email = string.Empty;
        f.Db.SaveChanges();

        await f.Controller(userId: f.Sam.Id, role: "Admin").Set(f.Noah.Id, f.Body() with { StartsAt = Start.AddDays(1) }, CancellationToken.None);

        var update = f.Channel.Sent[1];
        Assert.Equal("sam@provider.example", update.ReplyTo);
        Assert.DoesNotContain("ORGANIZER", update.Ics!.Content);
    }

    private static CancelIntakeBookingResultDto Cancelled(ActionResult<ApiResponse<CancelIntakeBookingResultDto>> r) => Ok<CancelIntakeBookingResultDto>(r.Result!);

    [Fact]
    public async Task Cancelling_a_visit_whose_invite_went_emails_a_cancel_with_the_same_uid_and_clears_the_booking()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        var uid = f.Row().IntakeUid;

        var result = Cancelled(await f.Controller().Cancel(f.Noah.Id, CancellationToken.None));

        Assert.Equal("Sent", result.CancellationEmail);
        Assert.Null(result.Inquiry.IntakeStartsAt);
        var cancel = f.Channel.Sent[1];
        Assert.Equal("CANCEL", cancel.Ics!.Method);
        Assert.Contains($"UID:{uid}", cancel.Ics.Content);
        Assert.Contains("SEQUENCE:1", cancel.Ics.Content);
        var row = f.Row();
        Assert.Null(row.IntakeStartsAt);
        Assert.Null(row.IntakeStaffUserId);
        Assert.Null(row.IntakeUid);
        Assert.Null(row.IntakeBookedByUserId);
        Assert.Equal(0, row.IntakeIcsSequence);
        Assert.Equal(2, f.Outbox().Count(o => o.RecipientUserId == f.Sam.Id)); // Booked, then Cancelled
        Assert.Contains("ORGANIZER;CN=\"Dana Smith\":mailto:dana@provider.example", cancel.Ics.Content.Replace("\r\n ", ""));
    }

    // The browser goes away while the CANCEL is on its way. The booking is already cleared, so nothing could send it later: it must still go.
    private sealed class AbortingChannel(CancellationTokenSource request) : INotificationChannel
    {
        public List<NotificationMessage> Sent { get; } = [];
        public NotificationChannelKind Kind => NotificationChannelKind.Email;
        public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
        {
            request.Cancel();
            if (ct.IsCancellationRequested) return Task.FromResult(new ChannelSendResult(ChannelSendOutcome.TransientFailure, null, "aborted"));
            Sent.Add(message);
            return Task.FromResult(new ChannelSendResult(ChannelSendOutcome.Sent, null, null));
        }
    }

    [Fact]
    public async Task A_cancellation_still_goes_when_the_request_is_aborted_mid_send()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        using var request = new CancellationTokenSource();
        var aborting = new AbortingChannel(request);

        var result = Cancelled(await f.Controller(channel: aborting).Cancel(f.Noah.Id, request.Token));

        Assert.Equal("Sent", result.CancellationEmail);
        Assert.Equal("CANCEL", Assert.Single(aborting.Sent).Ics!.Method);
    }

    [Fact]
    public async Task Cancelling_when_no_invite_ever_went_emails_nobody_but_still_tells_the_staff_member()
    {
        var f = new Fixture(ChannelSendOutcome.Skipped);
        await f.BookAsync();

        var result = Cancelled(await f.Controller().Cancel(f.Noah.Id, CancellationToken.None));

        Assert.Equal("NoInvite", result.CancellationEmail);
        Assert.Single(f.Channel.Sent);
        Assert.Equal(2, f.Outbox().Count);
    }

    [Fact]
    public async Task A_cancellation_that_cannot_be_emailed_says_why()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        f.Channel.Outcome = ChannelSendOutcome.Skipped;

        Assert.Equal("NotConfigured", Cancelled(await f.Controller().Cancel(f.Noah.Id, CancellationToken.None)).CancellationEmail);
    }

    // v1 keeps no sent-to address: an update, a cancel or a Send again goes to the enquiry's CURRENT email (lead call 11).
    [Fact]
    public async Task A_cancel_after_the_enquiry_email_was_edited_goes_to_the_current_address()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        f.Db.ParticipantInquiries.Single(x => x.Id == f.Noah.Id).Email = "new.address@example.com";
        f.Db.SaveChanges();

        await f.Controller().Cancel(f.Noah.Id, CancellationToken.None);

        Assert.Equal("new.address@example.com", f.Channel.Sent[1].RecipientAddress);
    }

    [Fact]
    public async Task A_visit_that_has_happened_cannot_be_cancelled()
    {
        var f = new Fixture();
        await f.BookAsync();

        var result = await f.Controller(now: Start.AddMinutes(90)).Cancel(f.Noah.Id, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(Start, f.Row().IntakeStartsAt);
    }

    [Fact]
    public async Task Cancel_confirm_and_send_again_need_a_booking_in_the_callers_organisation()
    {
        var f = new Fixture();
        var other = f.Controller(tenantId: Guid.NewGuid());
        Assert.IsType<NotFoundObjectResult>((await f.Controller().Cancel(f.Noah.Id, CancellationToken.None)).Result);
        await f.BookAsync();

        Assert.IsType<NotFoundObjectResult>((await other.Cancel(f.Noah.Id, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await other.Confirm(f.Noah.Id, new ConfirmIntakeBookingDto { Confirmed = true }, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await other.Resend(f.Noah.Id, CancellationToken.None)).Result);
        Assert.Equal(Start, f.Row().IntakeStartsAt);
        Assert.Null(f.Row().IntakeConfirmedAt);
    }

    [Fact]
    public async Task Mark_confirmed_sets_and_clears_the_moment()
    {
        var f = new Fixture();
        await f.BookAsync();

        var on = Ok<ParticipantInquiryDto>((await f.Controller().Confirm(f.Noah.Id, new ConfirmIntakeBookingDto { Confirmed = true }, CancellationToken.None)).Result!);
        var off = Ok<ParticipantInquiryDto>((await f.Controller().Confirm(f.Noah.Id, new ConfirmIntakeBookingDto { Confirmed = false }, CancellationToken.None)).Result!);

        Assert.Equal(Now, on.IntakeConfirmedAt);
        Assert.Null(off.IntakeConfirmedAt);
        Assert.Single(f.Channel.Sent); // confirming emails nobody
    }

    [Fact]
    public async Task Send_again_resends_the_same_invite_and_stores_the_new_outcome()
    {
        var f = new Fixture(ChannelSendOutcome.Skipped);
        await f.BookAsync();
        f.Channel.Outcome = ChannelSendOutcome.Sent;

        var dto = Ok<ParticipantInquiryDto>((await f.Controller().Resend(f.Noah.Id, CancellationToken.None)).Result!);

        Assert.Equal(Now, dto.IntakeInviteSentAt);
        Assert.Null(dto.IntakeInviteError);
        Assert.Equal(f.Channel.Sent[0].Subject, f.Channel.Sent[1].Subject);
        Assert.Contains("SEQUENCE:0", f.Channel.Sent[1].Ics!.Content);
        Assert.Equal(0, f.Row().IntakeIcsSequence);
    }

    [Fact]
    public async Task Send_again_without_an_enquiry_email_says_so()
    {
        var f = new Fixture();
        await f.BookAsync();
        f.Db.ParticipantInquiries.Single(x => x.Id == f.Noah.Id).Email = null;
        f.Db.SaveChanges();

        var result = await f.Controller().Resend(f.Noah.Id, CancellationToken.None);

        Assert.Equal(new[] { "Add Noah's email to the enquiry to send the invite." }, Problems(result.Result!)["contactEmail"]);
    }

    [Fact]
    public async Task Send_again_for_a_visit_that_has_happened_is_refused()
    {
        var f = new Fixture();
        await f.BookAsync();

        Assert.IsType<ConflictObjectResult>((await f.Controller(now: Start.AddHours(2)).Resend(f.Noah.Id, CancellationToken.None)).Result);
    }

    [Theory]
    [InlineData(nameof(IntakeBookingsController.Set))]
    [InlineData(nameof(IntakeBookingsController.Cancel))]
    [InlineData(nameof(IntakeBookingsController.Confirm))]
    [InlineData(nameof(IntakeBookingsController.Resend))]
    public void Every_booking_write_takes_the_same_roles_as_the_enquiry_update(string action)
    {
        var roles = typeof(IntakeBookingsController).GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>()!.Roles;

        Assert.Equal("Admin,Coordinator,SuperAdmin", roles);
    }
}
