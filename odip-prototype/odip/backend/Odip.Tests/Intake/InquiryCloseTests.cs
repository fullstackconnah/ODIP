using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Xunit;
using static Odip.Tests.Intake.IntakeBookingsControllerTests;

namespace Odip.Tests.Intake;

/// <summary>Closing and reopening an enquiry (spec addendum E1-E4): why, the visit's cancellation, the contacts deleted, read-only while closed, the views.</summary>
public class InquiryCloseTests
{
    private static CloseInquiryDto Why(InquiryCloseOutcome? outcome = InquiryCloseOutcome.NotGoingAhead, string? note = null) => new() { Outcome = outcome, Note = note };

    private static CloseInquiryResultDto Closed(ActionResult<ApiResponse<CloseInquiryResultDto>> r) => Ok<CloseInquiryResultDto>(r.Result!);

    private static (string? Code, string Message) Refusal<T>(ActionResult<ApiResponse<T>> r)
    {
        var body = Assert.IsType<ApiResponse<T>>(Assert.IsType<ConflictObjectResult>(r.Result).Value);
        return (body.Code, Assert.Single(body.Errors!));
    }

    private static void SeedContacts(Fixture f, int count)
    {
        for (var i = 0; i < count; i++)
            f.Db.InquiryContacts.Add(new InquiryContact { Id = Guid.NewGuid(), TenantId = f.TenantId, InquiryId = f.Noah.Id, SortOrder = i, Role = ContactRoleType.NextOfKin, FirstName = $"C{i}", LastName = "Ng" });
        f.Db.SaveChanges();
    }

    private static ParticipantInquiriesController Inquiries(Fixture f, string role = "Coordinator")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(f.TenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(false);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, f.Dana.Id.ToString()), new Claim(ClaimTypes.Role, role)], "test");
        return new ParticipantInquiriesController(f.Db, tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private static void CloseDirectly(OdipDbContext db, Guid id)
    {
        var row = db.ParticipantInquiries.Single(x => x.Id == id);
        row.ClosedAt = Now; row.CloseOutcome = InquiryCloseOutcome.Other; row.UpdatedAt = Now.AddSeconds(1);
        db.SaveChanges();
    }

    [Fact]
    public async Task Closing_cancels_an_upcoming_visit_deletes_the_contacts_and_records_why()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();
        var uid = f.Row().IntakeUid;
        SeedContacts(f, 2);

        var result = Closed(await f.Controller().Close(f.Noah.Id, Why(note: " Chose another provider "), CancellationToken.None));

        Assert.Equal("Sent", result.CancellationEmail);
        Assert.Equal((InquiryCloseOutcome.NotGoingAhead, "Chose another provider", (DateTime?)null), (result.Inquiry.CloseOutcome, result.Inquiry.CloseNote, result.Inquiry.IntakeStartsAt));
        var row = f.Row();
        Assert.Equal((Now, f.Dana.Id), (row.ClosedAt!.Value, row.ClosedByUserId!.Value));
        Assert.Null(row.IntakeUid);
        Assert.Empty(f.Db.InquiryContacts.AsNoTracking().Where(c => c.InquiryId == f.Noah.Id));
        var cancel = f.Channel.Sent.Last();
        Assert.Equal("CANCEL", cancel.Ics!.Method);
        Assert.Contains($"UID:{uid}", cancel.Ics.Content);
        Assert.Contains("SEQUENCE:1", cancel.Ics.Content);
        Assert.Equal(2, f.Outbox().Count(o => o.RecipientUserId == f.Sam.Id)); // Booked, then Cancelled
    }

    [Fact]
    public async Task Closing_with_no_visit_sends_nothing()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);

        Assert.Equal("NoVisit", Closed(await f.Controller().Close(f.Noah.Id, Why(), CancellationToken.None)).CancellationEmail);

        Assert.Empty(f.Channel.Sent);
        Assert.Empty(f.Outbox());
    }

    [Fact]
    public async Task A_past_visit_stays_as_the_record_when_its_enquiry_closes()
    {
        var f = new Fixture(ChannelSendOutcome.Sent);
        await f.BookAsync();

        var result = Closed(await f.Controller(now: Start.AddHours(3)).Close(f.Noah.Id, Why(), CancellationToken.None));

        Assert.Equal("NoVisit", result.CancellationEmail);
        Assert.Equal(Start, f.Row().IntakeStartsAt);
        Assert.Single(f.Channel.Sent); // the booking's invite only
    }

    [Fact]
    public async Task Close_needs_an_outcome_and_keeps_the_note_under_500()
    {
        var f = new Fixture();

        Assert.Equal(["Choose why it's closing."], Problems((await f.Controller().Close(f.Noah.Id, Why(outcome: null), CancellationToken.None)).Result!)["outcome"]);
        Assert.Equal(["Keep the note under 500 characters."], Problems((await f.Controller().Close(f.Noah.Id, Why(note: new string('n', 501)), CancellationToken.None)).Result!)["note"]);
        // Trimmed first: spaces round 500 characters are fine.
        Assert.IsType<OkObjectResult>((await f.Controller().Close(f.Noah.Id, Why(note: $"  {new string('n', 500)}  "), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task An_invalid_close_leaves_the_enquiry_open()
    {
        var f = new Fixture();
        await f.Controller().Close(f.Noah.Id, Why(outcome: null), CancellationToken.None);
        Assert.Null(f.Row().ClosedAt);
    }

    [Fact]
    public async Task A_converted_or_already_closed_enquiry_cannot_be_closed()
    {
        var f = new Fixture();
        await f.Controller().Close(f.Noah.Id, Why(), CancellationToken.None);
        Assert.Equal(("inquiry-closed", "This enquiry is already closed."), Refusal(await f.Controller().Close(f.Noah.Id, Why(), CancellationToken.None)));

        var g = new Fixture();
        var row = g.Db.ParticipantInquiries.Single(x => x.Id == g.Noah.Id);
        row.ParticipantId = Guid.NewGuid();
        g.Db.SaveChanges();
        Assert.Equal(("inquiry-converted", "Intake has started for Noah, so this enquiry can't be closed."), Refusal(await g.Controller().Close(g.Noah.Id, Why(), CancellationToken.None)));
    }

    [Fact]
    public async Task Reopen_clears_the_close_and_a_second_reopen_is_a_409()
    {
        var f = new Fixture();
        SeedContacts(f, 1);
        await f.Controller().Close(f.Noah.Id, Why(note: "Gone"), CancellationToken.None);

        var reopened = Ok<ParticipantInquiryDto>((await f.Controller().Reopen(f.Noah.Id, CancellationToken.None)).Result!);

        Assert.Null(reopened.ClosedAt);
        var row = f.Row();
        Assert.Equal((null, null, null, null), (row.ClosedAt, row.ClosedByUserId, row.CloseOutcome, row.CloseNote));
        Assert.Empty(f.Db.InquiryContacts.AsNoTracking().Where(c => c.InquiryId == f.Noah.Id)); // they don't come back (E3)
        Assert.Equal(("inquiry-open", "This enquiry is already open."), Refusal(await f.Controller().Reopen(f.Noah.Id, CancellationToken.None)));
    }

    [Fact]
    public async Task A_closed_enquiry_refuses_edits_bookings_and_start_intake()
    {
        var f = new Fixture();
        await f.Controller().Close(f.Noah.Id, Why(), CancellationToken.None);
        const string closed = "This enquiry is closed. Reopen it first.";

        Assert.Equal(("inquiry-closed", closed), Refusal(await f.Controller().Set(f.Noah.Id, f.Body(), CancellationToken.None)));
        var edit = new UpdateParticipantInquiryDto { FirstName = "Changed", LastName = "Fitzgerald", Source = "Phone", Contacts = [new InquiryContactDto { Role = ContactRoleType.NextOfKin, FirstName = "A", LastName = "B" }] };
        Assert.Equal(("inquiry-closed", closed), Refusal(await Inquiries(f).Update(f.Noah.Id, edit, CancellationToken.None)));
        Assert.Equal(("inquiry-closed", closed), Refusal(await Inquiries(f).Convert(f.Noah.Id, new(), CancellationToken.None)));

        var row = f.Row();
        Assert.Equal(("Noah", (Guid?)null, (DateTime?)null), (row.FirstName, row.ParticipantId, row.IntakeStartsAt));
        Assert.Empty(f.Db.InquiryContacts.AsNoTracking());
    }

    [Fact]
    public async Task The_list_is_open_by_default_and_closed_on_request_and_hides_the_note_from_other_roles()
    {
        var f = new Fixture();
        var other = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = f.TenantId, FirstName = "Ivy", LastName = "Park", Source = "Phone" };
        f.Db.ParticipantInquiries.Add(other);
        f.Db.SaveChanges();
        await f.Controller().Close(f.Noah.Id, Why(note: "Chose another provider"), CancellationToken.None);

        var open = Ok<List<ParticipantInquiryDto>>((await Inquiries(f).GetAll(CancellationToken.None)).Result!);
        Assert.Equal([other.Id], open.Select(r => r.Id));
        var closed = Assert.Single(Ok<List<ParticipantInquiryDto>>((await Inquiries(f).GetAll(CancellationToken.None, "closed")).Result!));
        Assert.Equal((f.Noah.Id, InquiryCloseOutcome.NotGoingAhead, "Chose another provider"), (closed.Id, closed.CloseOutcome!.Value, closed.CloseNote));
        Assert.NotNull(closed.ClosedAt);

        var asWorker = Assert.Single(Ok<List<ParticipantInquiryDto>>((await Inquiries(f, "SupportWorker").GetAll(CancellationToken.None, "closed")).Result!));
        Assert.Equal(InquiryCloseOutcome.NotGoingAhead, asWorker.CloseOutcome);
        Assert.Null(asWorker.CloseNote);
    }

    [Fact]
    public async Task Another_organisations_enquiry_cannot_be_closed_or_reopened()
    {
        var f = new Fixture();
        var theirs = Guid.NewGuid();

        Assert.IsType<NotFoundObjectResult>((await f.Controller(tenantId: theirs).Close(f.Noah.Id, Why(), CancellationToken.None)).Result);
        await f.Controller().Close(f.Noah.Id, Why(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>((await f.Controller(tenantId: theirs).Reopen(f.Noah.Id, CancellationToken.None)).Result);
        Assert.NotNull(f.Row().ClosedAt);
    }

    [Fact]
    public async Task A_booking_racing_a_close_is_a_409_and_the_enquiry_stays_closed_without_a_visit()
    {
        // Check S1: Close bumps UpdatedAt (the enforced version), so a booking that loaded the enquiry before the close matches no row.
        var f = new Fixture();
        var raiser = new InterleavingRaiser(new NotificationRaiser(f.Db), () => { CloseDirectly(f.OtherDb(), f.Noah.Id); return Task.CompletedTask; });

        var result = await f.Controller(raiser: raiser).Set(f.Noah.Id, f.Body(), CancellationToken.None);

        Assert.Equal((null, "Someone else just changed this visit. Reload and try again."), Refusal(result));
        var row = f.OtherDb().ParticipantInquiries.AsNoTracking().Single(x => x.Id == f.Noah.Id);
        Assert.NotNull(row.ClosedAt);
        Assert.Null(row.IntakeStartsAt);
        Assert.Empty(f.Channel.Sent);
    }

    [Fact]
    public async Task A_closed_enquirys_past_visit_is_not_on_the_schedules()
    {
        // Check S2: a past visit stays on a closed enquiry as its record, but it is no visit to be done.
        var f = new Fixture();
        await f.BookAsync();
        var later = Start.AddHours(3);
        await f.Controller(now: later).Close(f.Noah.Id, Why(), CancellationToken.None);
        var day = new DateOnly(2026, 10, 16);

        Assert.Empty(Ok<List<IntakeVisitDto>>((await f.Controller(now: later).Visits(day, day, null, CancellationToken.None)).Result!));
        await f.Controller(now: later).Reopen(f.Noah.Id, CancellationToken.None);
        Assert.Equal(f.Noah.Id, Assert.Single(Ok<List<IntakeVisitDto>>((await f.Controller(now: later).Visits(day, day, null, CancellationToken.None)).Result!)).InquiryId);
    }

    [Theory]
    [InlineData(nameof(IntakeBookingsController.Close))]
    [InlineData(nameof(IntakeBookingsController.Reopen))]
    public void Close_and_reopen_are_for_the_lifecycle_roles(string action) =>
        Assert.Equal("Admin,Coordinator,SuperAdmin", typeof(IntakeBookingsController).GetMethod(action)!.GetCustomAttribute<AuthorizeAttribute>()!.Roles);

    [Fact]
    public async Task Close_and_reopen_each_write_one_narrow_audit_row_with_no_personal_fields()
    {
        var f = new Fixture();
        await f.Controller().Close(f.Noah.Id, Why(note: "Chose another provider"), CancellationToken.None);
        await f.Controller().Reopen(f.Noah.Id, CancellationToken.None);

        var rows = f.Db.AuditLogs.AsNoTracking().Where(a => a.EntityId == f.Noah.Id).OrderBy(a => a.ChangedAt).ToList();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Equal(("ParticipantInquiry", (Guid?)f.Dana.Id), (r.EntityType, r.ChangedById)));
        Assert.Equal("[{\"Field\":\"Close\",\"Old\":null,\"New\":\"NotGoingAhead\"}]", rows[0].Changes);
        Assert.Equal("[{\"Field\":\"Reopen\",\"Old\":\"NotGoingAhead\",\"New\":null}]", rows[1].Changes);
        var json = JsonSerializer.Serialize(rows);
        foreach (var personal in new[] { "Noah", "Fitzgerald", "0412 555 010", "priya.nair", "Chose another provider" }) Assert.DoesNotContain(personal, json);
        Assert.DoesNotContain(typeof(ParticipantInquiry), AuditedEntities.Types);
    }
}
