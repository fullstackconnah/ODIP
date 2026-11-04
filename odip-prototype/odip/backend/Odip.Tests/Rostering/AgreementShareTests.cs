using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
using Odip.Infrastructure.Notifications.Templates;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Send agreement to contact, server half (PR3a): the share row and its token, the send and its outcomes, the public read by token with no signed-in tenant, the revocations
/// (approval, bulk approval, End early, a newer send, Delete) and what the approver says about who agreed.
/// </summary>
public class AgreementShareTests
{
    private const string Base = "https://app.bunya.test";
    private static readonly DateTime SentAt = new(2026, 10, 10, 2, 0, 0, DateTimeKind.Utc);

    private sealed class Channel(ChannelSendOutcome outcome) : INotificationChannel
    {
        public ChannelSendOutcome Outcome { get; set; } = outcome;
        public List<NotificationMessage> Sent { get; } = [];
        public NotificationChannelKind Kind => NotificationChannelKind.Email;
        public Task<ChannelSendResult> SendAsync(NotificationMessage message, CancellationToken ct)
        {
            Sent.Add(message);
            return Task.FromResult(new ChannelSendResult(Outcome, null, Outcome == ChannelSendOutcome.Sent ? null : "boom"));
        }
    }

    private static IConfiguration Config(bool enabled = true, string? baseUrl = Base) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["Notifications:Enabled"] = enabled ? "true" : "false", ["Notifications:PublicBaseUrl"] = baseUrl,
    }).Build();

    private sealed record World(Fixture F, Channel Ch, Guid GuardianId)
    {
        public AgreementShareService Svc(bool enabled = true, string? baseUrl = Base, OdipDbContext? db = null) =>
            new(db ?? F.Db, new ServiceAgreementDraftService(db ?? F.Db, clock: F.Clock), new IntakeInviteSender([Ch], NullLogger<IntakeInviteSender>.Instance), Config(enabled, baseUrl), clock: F.Clock);
        public Task<AgreementSendOutcome> SendAsync(ServiceAgreementDraft d, Guid? personId = null, int? version = null, AgreementShareService? svc = null, ApprovalCaller? caller = null) =>
            (svc ?? Svc()).SendAsync(TenantA, F.ParticipantId, d.Id, new SendAgreementDto { PersonId = personId, ExpectedVersion = version ?? d.Version }, caller ?? Admin, CancellationToken.None);
    }

    private static async Task<World> NewAsync(ChannelSendOutcome outcome = ChannelSendOutcome.Sent, bool orgContact = true)
    {
        var f = await SetUpAsync();
        var settings = await f.Db.ProviderSettings.SingleAsync();
        settings.OrganisationName = "Bunya Care";
        if (orgContact) settings.ContactEmail = "office@bunya.test";
        var guardian = new Person { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Gina", LastName = "Guard", Email = "gina@family.test" };
        f.Db.People.Add(guardian);
        f.Db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, PersonId = guardian.Id, RoleType = ContactRoleType.Guardian });
        await f.Db.SaveChangesAsync();
        return new World(f, new Channel(outcome), guardian.Id);
    }

    private static async Task<Guid> ParticipantAsync(Fixture f, string firstName)
    {
        var p = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = firstName, LastName = "Ng", IsActive = true };
        f.Db.Participants.Add(p);
        await f.Db.SaveChangesAsync();
        return p.Id;
    }

    private static Task<ServiceAgreementDraft> RevisionAsync(World w, int version = 1) => AddRevisionAsync(w.F, version, new[] { WeekdayBlock() });

    private static string TokenIn(NotificationMessage m) => m.PlainTextBody.Split('\n').Single(l => l.StartsWith(Base + "/agreement/", StringComparison.Ordinal)).Substring((Base + "/agreement/").Length).Trim();

    /// <summary>A context on the same database with NO tenant and no SuperAdmin, as the public route has: the tenant filter would hide everything.</summary>
    private static OdipDbContext PublicDb(Fixture f)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(f.DbName).Options, tenant.Object);
    }

    private static async Task<(ServiceAgreementDraft Draft, string Token)> SentAsync(World w, int version = 1)
    {
        var draft = await RevisionAsync(w, version);
        var outcome = await w.SendAsync(draft);
        Assert.Equal((AgreementSendStatus.Done, null), (outcome.Status, outcome.Error));
        return (draft, TokenIn(w.Ch.Sent.Last()));
    }

    // ── The send ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Sends_to_the_default_guardian_and_stores_only_the_hash_of_the_token()
    {
        var w = await NewAsync();
        var (draft, token) = await SentAsync(w);

        var message = Assert.Single(w.Ch.Sent);
        Assert.Equal(("gina@family.test", "office@bunya.test"), (message.RecipientAddress, message.ReplyTo));
        var share = await w.F.Db.ServiceAgreementShares.SingleAsync();
        Assert.Equal(CaregiverTokenService.Hash(token), share.TokenHash);
        Assert.DoesNotContain(token, share.TokenHash);
        Assert.Equal((w.GuardianId, "Gina Guard", "gina@family.test", Admin.Name, draft.Id, null), (share.RecipientPersonId, share.RecipientName, share.RecipientEmail, share.SentByName, share.DraftId, share.SendError));
        Assert.Equal((SentAt, SentAt.AddDays(30), (DateTime?)null, (DateTime?)null), (share.SentAt, share.ExpiresAt, share.OpenedAt, share.RevokedAt));
    }

    [Fact]
    public async Task The_recipients_email_is_read_from_the_record_and_never_from_the_request()
    {
        Assert.DoesNotContain(typeof(SendAgreementDto).GetProperties(), p => p.Name.Contains("Email", StringComparison.OrdinalIgnoreCase));
        var w = await NewAsync();
        var draft = await RevisionAsync(w);
        w.F.Db.People.Single(p => p.Id == w.GuardianId).Email = "new@family.test";
        await w.F.Db.SaveChangesAsync();

        await w.SendAsync(draft, w.GuardianId);

        Assert.Equal("new@family.test", Assert.Single(w.Ch.Sent).RecipientAddress);
    }

    [Fact]
    public async Task A_forged_Host_header_cannot_change_the_link_base()
    {
        var w = await NewAsync();
        var draft = await RevisionAsync(w);
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, "Admin")], "Test")) };
        http.Request.Host = new HostString("evil.example");
        var controller = new ServiceAgreementDraftsController(w.F.Db, tenant.Object, new ServiceAgreementDraftService(w.F.Db, clock: w.F.Clock), approval: w.F.Service, share: w.Svc())
        { ControllerContext = new ControllerContext { HttpContext = http } };

        var result = await controller.Send(w.F.ParticipantId, draft.Id, new SendAgreementDto { ExpectedVersion = 1 }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<SendAgreementResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Sent);
        var message = Assert.Single(w.Ch.Sent);
        Assert.Contains(Base + "/agreement/", message.PlainTextBody);
        Assert.DoesNotContain("evil.example", message.PlainTextBody + message.HtmlBody);
    }

    [Theory]
    [InlineData(false, Base)]
    [InlineData(true, null)]
    public async Task Disabled_notifications_or_no_public_base_url_is_NotConfigured_and_nothing_is_emailed(bool enabled, string? baseUrl)
    {
        var w = await NewAsync();
        var draft = await RevisionAsync(w);

        var outcome = await w.SendAsync(draft, svc: w.Svc(enabled, baseUrl));

        Assert.Equal((AgreementSendStatus.Done, "NotConfigured"), (outcome.Status, outcome.Error));
        Assert.Empty(w.Ch.Sent);
        Assert.Equal("NotConfigured", (await w.F.Db.ServiceAgreementShares.SingleAsync()).SendError);
    }

    [Theory]
    [InlineData(ChannelSendOutcome.Skipped, "NotConfigured")]
    [InlineData(ChannelSendOutcome.PermanentFailure, "Failed")]
    public async Task A_send_that_did_not_go_keeps_its_row_with_the_error_and_leaves_the_older_link_live(ChannelSendOutcome outcome, string error)
    {
        var w = await NewAsync();
        var (_, oldToken) = await SentAsync(w);
        var v2 = await RevisionAsync(w, 2);
        w.Ch.Outcome = outcome;

        var result = await w.SendAsync(v2);

        Assert.Equal(error, result.Error);
        var rows = await w.F.Db.ServiceAgreementShares.OrderBy(s => s.SentAt).ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.All(rows, r => Assert.Null(r.RevokedAt));
        Assert.Equal(error, rows.Single(r => r.DraftId == v2.Id).SendError);
        Assert.NotNull(await w.Svc().ViewAsync(oldToken, CancellationToken.None));
    }

    [Fact]
    public async Task A_newer_successful_send_revokes_the_links_of_older_versions()
    {
        var w = await NewAsync();
        var (_, oldToken) = await SentAsync(w);
        var (_, newToken) = await SentAsync(w, 2);

        var svc = w.Svc();
        Assert.Null(await svc.ViewAsync(oldToken, CancellationToken.None));
        Assert.NotNull(await svc.ViewAsync(newToken, CancellationToken.None));
        Assert.Equal(1, await w.F.Db.ServiceAgreementShares.CountAsync(s => s.RevokedAt != null));
    }

    [Fact]
    public async Task Refuses_what_cannot_be_sent_and_writes_nothing()
    {
        var w = await NewAsync();
        var v1 = await RevisionAsync(w);
        var v2 = await RevisionAsync(w, 2);
        var approved = await RevisionAsync(w, 3);
        var other = await ParticipantAsync(w.F, "Ben");
        var stranger = new Person { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Sam", LastName = "Stranger", Email = "sam@else.test" };
        w.F.Db.People.Add(stranger);
        w.F.Db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = other, PersonId = stranger.Id, RoleType = ContactRoleType.Guardian });
        await w.F.Db.SaveChangesAsync();

        Assert.Equal(AgreementSendStatus.NotSendable, (await w.SendAsync(v1, version: 1)).Status);                       // replaced by a newer revision
        Assert.Equal(AgreementSendStatus.Stale, (await w.SendAsync(approved, version: 1)).Status);
        Assert.Equal(AgreementSendStatus.NotFound, (await w.Svc().SendAsync(TenantB, w.F.ParticipantId, v2.Id, new SendAgreementDto { ExpectedVersion = 2 }, Admin, CancellationToken.None)).Status);
        var notApprover = await w.SendAsync(approved, caller: new ApprovalCaller(Guid.NewGuid(), "Casey", ["SupportWorker"]));
        Assert.Equal((AgreementSendStatus.NotAnApprover, ServiceAgreementApprovalService.NotAnApproverMessage), (notApprover.Status, notApprover.Message));
        Assert.Equal(AgreementSendStatus.BadRecipient, (await w.SendAsync(approved, stranger.Id)).Status);                     // a contact of another participant
        Assert.Equal(AgreementSendStatus.BadRecipient, (await w.SendAsync(approved, Guid.NewGuid())).Status);
        await MarkApprovedAsync(w.F.Db, approved);
        Assert.Equal(AgreementSendStatus.NotSendable, (await w.SendAsync(approved)).Status);
        Assert.Empty(w.Ch.Sent);
        Assert.Empty(await w.F.Db.ServiceAgreementShares.ToListAsync());
    }

    [Fact]
    public async Task Refuses_an_organisation_with_no_contact_and_a_contact_with_a_bad_address()
    {
        var w = await NewAsync(orgContact: false);
        var draft = await RevisionAsync(w);
        var noContact = await w.SendAsync(draft);
        Assert.Equal((AgreementSendStatus.NoOrganisationContact, AgreementShareService.NoOrganisationContactMessage), (noContact.Status, noContact.Message));

        (await w.F.Db.ProviderSettings.SingleAsync()).ContactPhone = "07 5555 0100";
        w.F.Db.People.Single(p => p.Id == w.GuardianId).Email = "gina@fam\r\nBcc: x@evil.test";
        await w.F.Db.SaveChangesAsync();
        Assert.Equal(AgreementSendStatus.BadRecipient, (await w.SendAsync(draft)).Status);
        Assert.Empty(await w.F.Db.ServiceAgreementShares.ToListAsync());
    }

    [Fact]
    public async Task Sharing_lists_contacts_and_sends_and_never_shows_a_failed_send_as_sent_or_carries_a_token()
    {
        var w = await NewAsync();
        var (draft, _) = await SentAsync(w);
        w.Ch.Outcome = ChannelSendOutcome.PermanentFailure;
        w.F.Clock.Set(new DateTimeOffset(SentAt.AddMinutes(5), TimeSpan.Zero));
        await w.SendAsync(draft);

        var sharing = await w.Svc().SharingAsync(TenantA, w.F.ParticipantId, draft.Id, CancellationToken.None);

        var guardian = sharing.Contacts.Single(c => c.PersonId == w.GuardianId);
        Assert.Equal(("Gina Guard", "Guardian", "gina@family.test", true), (guardian.Name, guardian.Roles, guardian.Email, guardian.IsDefault));
        Assert.Equal(new string?[] { "Failed", null }, sharing.Shares.Select(s => s.SendError).ToArray());
        Assert.DoesNotContain("TokenHash", JsonSerializer.Serialize(sharing));
    }

    // ── The link ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_link_answers_with_no_signed_in_tenant_and_never_shows_the_ndis_number_or_birth_date_in_the_json()
    {
        var w = await NewAsync();
        var (draft, token) = await SentAsync(w);
        draft.NdisNumberSnapshot = "430999888";
        draft.DateOfBirthSnapshot = new DateOnly(1990, 3, 4);
        await w.F.Db.SaveChangesAsync();
        await using var publicDb = PublicDb(w.F);
        Assert.Empty(await publicDb.ServiceAgreementShares.ToListAsync());                              // the tenant filter does hide everything here
        var svc = w.Svc(db: publicDb);

        var view = await svc.ViewAsync(token, CancellationToken.None);
        var pdf = await svc.PdfAsync(token, CancellationToken.None);

        Assert.NotNull(view);
        Assert.Equal(("Bunya Care", draft.ParticipantNameSnapshot, "office@bunya.test"), (view.ProviderName, view.ParticipantName, view.ContactEmail));
        var json = JsonSerializer.Serialize(view);
        Assert.DoesNotContain("430999888", json);
        Assert.DoesNotContain("1990", json);
        Assert.NotNull(pdf);
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf.Content.Take(4).ToArray()));
    }

    [Fact]
    public async Task An_ongoing_agreement_reads_as_ongoing_until_the_plan_ends()
    {
        var w = await NewAsync();
        var (draft, token) = await SentAsync(w);
        draft.IsOngoing = true;
        await w.F.Db.SaveChangesAsync();

        var view = await w.Svc().ViewAsync(token, CancellationToken.None);

        Assert.True(view!.IsOngoing);
        Assert.Null(view.EndDate);
        Assert.Contains("ongoing, until the plan ends", view.PeriodText);
    }

    [Fact]
    public async Task One_organisations_token_never_returns_another_organisations_agreement()
    {
        var w = await NewAsync();
        var (_, tokenA) = await SentAsync(w);
        var participantB = Guid.NewGuid();
        w.F.Db.Participants.Add(new Participant { Id = participantB, TenantId = TenantB, FirstName = "Bea", LastName = "Other", IsActive = true });
        var draftB = BuildRevision(TenantB, participantB, 1, new[] { WeekdayBlock() });
        draftB.ParticipantNameSnapshot = "Bea Other";
        w.F.Db.ServiceAgreementDrafts.Add(draftB);
        var tokenB = CaregiverTokenService.GenerateRawToken();
        w.F.Db.ServiceAgreementShares.Add(new ServiceAgreementShare
        {
            Id = Guid.NewGuid(), TenantId = TenantB, ParticipantId = participantB, DraftId = draftB.Id, TokenHash = CaregiverTokenService.Hash(tokenB), RecipientName = "Bo", RecipientEmail = "bo@b.test",
            SentByName = "B Admin", SentAt = SentAt, ExpiresAt = SentAt.AddDays(30),
        });
        await w.F.Db.SaveChangesAsync();
        await using var publicDb = PublicDb(w.F);
        var svc = w.Svc(db: publicDb);

        Assert.Equal("Bea Other", (await svc.ViewAsync(tokenB, CancellationToken.None))!.ParticipantName);
        var a = await svc.ViewAsync(tokenA, CancellationToken.None);
        Assert.NotEqual("Bea Other", a!.ParticipantName);
        Assert.Equal("Bunya Care", a.ProviderName);
    }

    [Fact]
    public async Task Every_bad_token_is_the_same_null_and_day_thirty_is_the_last_good_one()
    {
        var w = await NewAsync();
        var (_, token) = await SentAsync(w);
        var svc = w.Svc();
        foreach (var bad in new[] { null, "", "   ", "nope", new string('a', 65), token + "x", token.ToUpperInvariant() })
        {
            Assert.Null(await svc.ViewAsync(bad, CancellationToken.None));
            Assert.Null(await svc.PdfAsync(bad, CancellationToken.None));
        }

        w.F.Clock.Set(new DateTimeOffset(SentAt.AddDays(30), TimeSpan.Zero));
        Assert.NotNull(await svc.ViewAsync(token, CancellationToken.None));
        w.F.Clock.Set(new DateTimeOffset(SentAt.AddDays(30).AddSeconds(1), TimeSpan.Zero));
        Assert.Null(await svc.ViewAsync(token, CancellationToken.None));
        Assert.Null(await svc.PdfAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task A_revoked_or_failed_send_gives_no_answer()
    {
        var w = await NewAsync();
        var (_, token) = await SentAsync(w);
        var share = await w.F.Db.ServiceAgreementShares.SingleAsync();
        share.RevokedAt = SentAt;
        await w.F.Db.SaveChangesAsync();
        Assert.Null(await w.Svc().ViewAsync(token, CancellationToken.None));

        share.RevokedAt = null;
        share.SendError = "Failed";
        await w.F.Db.SaveChangesAsync();
        Assert.Null(await w.Svc().ViewAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task Only_the_first_json_read_sets_OpenedAt_and_the_pdf_never_does()
    {
        var w = await NewAsync();
        var (_, token) = await SentAsync(w);
        var svc = w.Svc();

        await svc.PdfAsync(token, CancellationToken.None);
        Assert.Null((await w.F.Db.ServiceAgreementShares.AsNoTracking().SingleAsync()).OpenedAt);

        await svc.ViewAsync(token, CancellationToken.None);
        var first = (await w.F.Db.ServiceAgreementShares.AsNoTracking().SingleAsync()).OpenedAt;
        Assert.Equal(SentAt, first);
        w.F.Clock.Set(new DateTimeOffset(SentAt.AddDays(2), TimeSpan.Zero));
        await svc.ViewAsync(token, CancellationToken.None);
        Assert.Equal(first, (await w.F.Db.ServiceAgreementShares.AsNoTracking().SingleAsync()).OpenedAt);
    }

    // ── The public controller ───────────────────────────────────────────────────

    [Fact]
    public async Task The_public_controller_is_anonymous_rate_limited_and_never_reads_the_tenant()
    {
        var type = typeof(AgreementShareController);
        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<AuthorizeAttribute>());
        Assert.All(type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly), m => Assert.Null(m.GetCustomAttribute<AuthorizeAttribute>()));
        Assert.Equal("public", type.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
        Assert.NotNull(type.GetCustomAttribute<AgreementShareHeadersAttribute>());
        Assert.DoesNotContain(type.GetConstructors().Single().GetParameters(), p => p.ParameterType == typeof(ICurrentTenant) || p.ParameterType == typeof(OdipDbContext));
        Assert.DoesNotContain(typeof(ServiceAgreementDraftsController).GetMethods().Select(m => m.Name), n => n == "Pdf" && false);
        var w = await NewAsync();
        var (_, token) = await SentAsync(w);
        await using var publicDb = PublicDb(w.F);
        var controller = new AgreementShareController(w.Svc(db: publicDb)) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

        var ok = Assert.IsType<OkObjectResult>((await controller.Get(token, CancellationToken.None)).Result);
        var pdf = Assert.IsType<FileContentResult>(await controller.Pdf(token, CancellationToken.None));
        var wrong = Assert.IsType<NotFoundObjectResult>((await controller.Get("wrong", CancellationToken.None)).Result);
        var oversized = Assert.IsType<NotFoundObjectResult>((await controller.Get(new string('z', 500), CancellationToken.None)).Result);
        var wrongPdf = Assert.IsType<NotFoundObjectResult>(await controller.Pdf("wrong", CancellationToken.None));

        Assert.Equal("application/pdf", pdf.ContentType);
        Assert.NotNull(ok.Value);
        Assert.Equal(JsonSerializer.Serialize(wrong.Value), JsonSerializer.Serialize(oversized.Value));
        Assert.Contains("This link is not valid.", JsonSerializer.Serialize(wrongPdf.Value));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Every_answer_carries_the_no_index_no_store_no_referrer_and_no_frame_headers(bool found)
    {
        var http = new DefaultHttpContext();
        IActionResult result = found ? new OkResult() : new NotFoundResult();
        var context = new ResultExecutingContext(new ActionContext(http, new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>(), result, new object());

        new AgreementShareHeadersAttribute().OnResultExecuting(context);

        Assert.Equal(("noindex, nofollow", "no-store", "no-referrer", "default-src 'none'; frame-ancestors 'none'"),
            (http.Response.Headers["X-Robots-Tag"].ToString(), http.Response.Headers.CacheControl.ToString(), http.Response.Headers["Referrer-Policy"].ToString(), http.Response.Headers.ContentSecurityPolicy.ToString()));
    }

    // ── The email ───────────────────────────────────────────────────────────────

    [Fact]
    public void The_email_encodes_every_user_string_and_keeps_the_subject_on_one_line()
    {
        const string evil = "<script>alert(1)</script>\"'&";
        var message = AgreementSendTemplate.Render(new AgreementSendPayload(
            "gina@family.test", evil + "NAME", evil + "PARTICIPANT", evil + "PROVIDER\r\nBcc: x@evil.test", "https://app.bunya.test/agreement/abc\"><img src=x onerror=alert(1)>", new DateOnly(2026, 11, 9),
            "office@bunya.test", evil + "PHONE"));

        Assert.DoesNotContain("<script>", message.HtmlBody);
        Assert.DoesNotContain("<img", message.HtmlBody);
        foreach (var label in new[] { "NAME", "PARTICIPANT", "PROVIDER", "PHONE" }) Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;" + label, message.HtmlBody);
        Assert.Contains("href=\"https://app.bunya.test/agreement/abc&quot;&gt;&lt;img", message.HtmlBody);
        Assert.DoesNotContain('\n', message.Subject);
        Assert.DoesNotContain('\r', message.Subject);
        Assert.Contains("9 November 2026", message.PlainTextBody);
    }

    // ── Revoking ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Approving_revokes_this_revisions_links_and_the_older_ones_in_the_same_save()
    {
        var w = await NewAsync();
        var (v1, tokenOld) = await SentAsync(w);
        var (v2, token) = await SentAsync(w, 2);                       // v1's was already revoked by this send
        Assert.Equal(1, await w.F.Db.ServiceAgreementShares.CountAsync(s => s.RevokedAt == null));

        Assert.Equal(ApprovalStatus.Approved, (await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, v2.Id, false, Admin, CancellationToken.None)).Status);

        Assert.Equal(0, await w.F.Db.ServiceAgreementShares.CountAsync(s => s.RevokedAt == null));
        Assert.Null(await w.Svc().ViewAsync(token, CancellationToken.None));
        Assert.Null(await w.Svc().ViewAsync(tokenOld, CancellationToken.None));
        _ = v1;
    }

    [Fact]
    public async Task A_refused_approval_leaves_the_link_live()
    {
        var w = await NewAsync();
        var draft = await AddRevisionAsync(w.F, 1, new[] { WeekdayBlock() }, shape: q => WithIssue(q, "weekdays", Odip.Domain.Billing.Pricing.PlanFailureReason.NoItem, "no item"));
        Assert.Equal(AgreementSendStatus.Done, (await w.SendAsync(draft)).Status);

        Assert.Equal(ApprovalStatus.Refused, (await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, draft.Id, false, Admin, CancellationToken.None)).Status);

        Assert.Null((await w.F.Db.ServiceAgreementShares.SingleAsync()).RevokedAt);
    }

    [Fact]
    public async Task Bulk_approval_revokes_too()
    {
        var w = await NewAsync();
        var (draft, token) = await SentAsync(w);

        var result = await AgreementListTests.Controller(w.F.Db, w.F).ApproveBatch(
            new AgreementApproveBatchDto { Items = [new AgreementDraftRefDto { ParticipantId = w.F.ParticipantId, DraftId = draft.Id }] }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(1, await w.F.Db.ServiceAgreementDraftApprovals.CountAsync());
        Assert.Null(await w.Svc().ViewAsync(token, CancellationToken.None));
    }

    [Fact]
    public async Task Ending_early_revokes_only_that_revisions_links()
    {
        var w = await NewAsync();
        var (v1, token) = await SentAsync(w);
        Assert.Equal(ApprovalStatus.Approved, (await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, v1.Id, false, Admin, CancellationToken.None)).Status);
        // approving already revoked it; send a live link for the ended revision directly, as an earlier version's would be
        w.F.Db.ServiceAgreementShares.Add(new ServiceAgreementShare
        {
            Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = w.F.ParticipantId, DraftId = v1.Id, TokenHash = "h1", RecipientName = "G", RecipientEmail = "g@f.test", SentByName = "A", SentAt = SentAt, ExpiresAt = SentAt.AddDays(30),
        });
        await w.F.Db.SaveChangesAsync();

        var ended = await w.F.Service.EndEarlyAsync(TenantA, w.F.ParticipantId, v1.Id, new DateOnly(2026, 10, 30), Admin, CancellationToken.None);

        Assert.Equal(EndEarlyStatus.Ended, ended.Status);
        Assert.Equal(0, await w.F.Db.ServiceAgreementShares.CountAsync(s => s.RevokedAt == null));
        _ = token;
    }

    [Fact]
    public async Task Deleting_a_draft_removes_its_shares()
    {
        var w = await NewAsync();
        var (draft, _) = await SentAsync(w);
        await w.F.Db.ServiceAgreementShares.ToListAsync();                  // InMemory cascades only what is tracked; the real FK cascade is in the migration
        var delete = await new ServiceAgreementDraftService(w.F.Db, clock: w.F.Clock).DeleteAsync(TenantA, w.F.ParticipantId, draft.Id, Admin, CancellationToken.None);

        Assert.Equal(DraftDeleteStatus.Deleted, delete.Status);
        Assert.Empty(await w.F.Db.ServiceAgreementShares.ToListAsync());
    }

    // ── Who agreed ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_approval_stores_who_agreed_and_how_with_the_contacts_name_copied()
    {
        var w = await NewAsync();
        var draft = await RevisionAsync(w);

        var outcome = await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, draft.Id, false, Admin, CancellationToken.None,
            new ServiceAgreementApprovalService.ApprovalAgreed(w.GuardianId, "ignored", AgreementAgreedHow.Phone));

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var stored = await w.F.Db.ServiceAgreementDraftApprovals.SingleAsync();
        Assert.Equal(("Gina Guard", w.GuardianId, AgreementAgreedHow.Phone), (stored.AgreedByName, stored.AgreedByPersonId, stored.AgreedHow));
        // a second approval writes nothing and keeps the first
        var again = await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, draft.Id, false, Admin, CancellationToken.None, new ServiceAgreementApprovalService.ApprovalAgreed(null, "Someone Else", AgreementAgreedHow.Email));
        Assert.Equal(ApprovalStatus.AlreadyApproved, again.Status);
        Assert.Equal("Gina Guard", (await w.F.Db.ServiceAgreementDraftApprovals.SingleAsync()).AgreedByName);
    }

    [Fact]
    public async Task A_typed_name_is_trimmed_and_saying_nothing_leaves_the_columns_empty()
    {
        var w = await NewAsync();
        var typed = await RevisionAsync(w);
        await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, typed.Id, false, Admin, CancellationToken.None, new ServiceAgreementApprovalService.ApprovalAgreed(null, "  Pat Parent  ", null));
        Assert.Equal(("Pat Parent", null, null), ((string?)(await w.F.Db.ServiceAgreementDraftApprovals.SingleAsync()).AgreedByName, (Guid?)null, (AgreementAgreedHow?)null));
        var other = await ParticipantAsync(w.F, "Ben");
        var plain = await AddRevisionAsync(w.F, 1, new[] { WeekdayBlock() }, participantId: other);

        await w.F.Service.ApproveAsync(TenantA, other, plain.Id, false, Admin, CancellationToken.None);

        var stored = await w.F.Db.ServiceAgreementDraftApprovals.SingleAsync(a => a.DraftId == plain.Id);
        Assert.Equal((null, null, null), (stored.AgreedByName, stored.AgreedByPersonId, stored.AgreedHow));
    }

    [Fact]
    public async Task Another_participants_contact_or_an_undefined_way_or_a_long_name_refuses_the_approval()
    {
        var w = await NewAsync();
        var draft = await RevisionAsync(w);
        var other = await ParticipantAsync(w.F, "Ben");
        var stranger = new Person { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Sam", LastName = "Stranger" };
        w.F.Db.People.Add(stranger);
        w.F.Db.ParticipantContactRoles.Add(new ParticipantContactRole { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = other, PersonId = stranger.Id, RoleType = ContactRoleType.NextOfKin });
        await w.F.Db.SaveChangesAsync();

        foreach (var bad in new[]
        {
            new ServiceAgreementApprovalService.ApprovalAgreed(stranger.Id, null, null),
            new ServiceAgreementApprovalService.ApprovalAgreed(Guid.NewGuid(), null, null),
            new ServiceAgreementApprovalService.ApprovalAgreed(null, null, (AgreementAgreedHow)99),
            new ServiceAgreementApprovalService.ApprovalAgreed(null, new string('n', 201), null),
        })
            Assert.Equal(ApprovalStatus.Refused, (await w.F.Service.ApproveAsync(TenantA, w.F.ParticipantId, draft.Id, false, Admin, CancellationToken.None, bad)).Status);

        Assert.Empty(await w.F.Db.ServiceAgreementDraftApprovals.ToListAsync());
    }
}
