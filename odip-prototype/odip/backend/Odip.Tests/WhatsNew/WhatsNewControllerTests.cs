using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.WhatsNew;

/// <summary>What's new: who sees which entry, what counts as unread, and the SuperAdmin's writes. The caller is the JWT subject and role, never ICurrentTenant.</summary>
public class WhatsNewControllerTests
{
    private static readonly DateTime T0 = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    private sealed class Ctx
    {
        public required OdipDbContext Db { get; init; }
        public required WhatsNewController Feed { get; init; }
        public required AdminWhatsNewController Admin { get; init; }
        public required Guid UserId { get; init; }
    }

    private static Ctx SetUp(string role = "Admin", DateTime? userCreated = null, bool createUser = true, bool viewAs = false)
    {
        var userId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(viewAs ? Guid.NewGuid() : (Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(!viewAs && role == "SuperAdmin");
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Role, role), new Claim("fullName", "Sam Super") }, "Test"));
        var accessor = new Mock<IHttpContextAccessor>();
        accessor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = principal });
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new AuditInterceptor(accessor.Object))
            .Options;
        var db = new OdipDbContext(options, tenant.Object);
        if (createUser)
        {
            // The user's own row sits in a tenant the view-as filter hides, which is the point of IgnoreQueryFilters.
            db.Users.Add(new User { Id = userId, TenantId = Guid.NewGuid(), Username = "u" + userId.ToString("N"), Email = "u@example.com", FirstName = "A", LastName = "B", CreatedAt = userCreated ?? T0 });
            db.SaveChanges();
        }
        var context = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } };
        return new Ctx
        {
            Db = db, UserId = userId,
            Feed = new WhatsNewController(db) { ControllerContext = context },
            Admin = new AdminWhatsNewController(db) { ControllerContext = context },
        };
    }

    private static WhatsNewEntry Entry(WhatsNewAudience roles, DateTime published, bool important = false, string? title = null, DateTime? archived = null) => new()
    {
        Id = Guid.NewGuid(), Key = "k-" + Guid.NewGuid().ToString("N"), Title = title ?? "Title", Body = "Body", Roles = roles, Important = important,
        PublishedAtUtc = published, ArchivedAtUtc = archived, CreatedAt = published, UpdatedAt = published,
    };

    private static async Task<WhatsNewFeedDto> GetFeed(Ctx c)
    {
        var result = await c.Feed.GetFeed(default);
        return Assert.IsType<ApiResponse<WhatsNewFeedDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static SaveWhatsNewEntryDto Save(string? title = "Hello", string? body = "World", string[]? roles = null, bool important = false) =>
        new() { Title = title, Body = body, Roles = (roles ?? new[] { "Admin" }).ToList(), Important = important };

    private static AdminWhatsNewEntryDto Saved(ActionResult<ApiResponse<AdminWhatsNewEntryDto>> result) =>
        Assert.IsType<ApiResponse<AdminWhatsNewEntryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    // ── The feed ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Admin", WhatsNewAudience.Admin)]
    [InlineData("Coordinator", WhatsNewAudience.Coordinator)]
    [InlineData("SupportWorker", WhatsNewAudience.SupportWorker)]
    [InlineData("ReadOnly", WhatsNewAudience.ReadOnly)]
    public async Task Feed_FiltersByJwtRole(string role, WhatsNewAudience own)
    {
        var c = SetUp(role);
        var now = T0.AddDays(1);
        var audiences = new[] { WhatsNewAudience.Admin, WhatsNewAudience.SupportWorker, WhatsNewAudience.Coordinator | WhatsNewAudience.ReadOnly, WhatsNewAudience.All };
        for (var i = 0; i < audiences.Length; i++) c.Db.WhatsNewEntries.Add(Entry(audiences[i], now.AddMinutes(i), title: "e" + i));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);

        var expected = Enumerable.Range(0, audiences.Length).Where(i => (audiences[i] & own) != 0).Select(i => "e" + i).Reverse().ToArray();
        Assert.Equal(expected, feed.Entries.Select(e => e.Title).ToArray());
    }

    [Fact]
    public async Task Feed_SuperAdminSeesEveryEntry()
    {
        var c = SetUp("SuperAdmin");
        c.Db.WhatsNewEntries.AddRange(Entry(WhatsNewAudience.Admin, T0.AddDays(1)), Entry(WhatsNewAudience.SupportWorker, T0.AddDays(2)), Entry(WhatsNewAudience.All, T0.AddDays(3)));
        c.Db.SaveChanges();

        Assert.Equal(3, (await GetFeed(c)).Entries.Count);
    }

    [Fact]
    public async Task Feed_HidesArchived()
    {
        var c = SetUp();
        c.Db.WhatsNewEntries.AddRange(Entry(WhatsNewAudience.All, T0.AddDays(1)), Entry(WhatsNewAudience.All, T0.AddDays(2), archived: T0.AddDays(3)));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);
        Assert.Single(feed.Entries);
        Assert.Equal(1, feed.UnreadCount);
    }

    [Fact]
    public async Task Unread_CountsOnlyAfterMaxOfLastSeenAndUserCreatedAt()
    {
        var c = SetUp(userCreated: T0);
        c.Db.WhatsNewEntries.AddRange(Entry(WhatsNewAudience.All, T0.AddDays(-1)), Entry(WhatsNewAudience.All, T0.AddDays(1)), Entry(WhatsNewAudience.All, T0.AddDays(2)));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);
        Assert.Equal(3, feed.Entries.Count);
        Assert.Equal(2, feed.UnreadCount);

        c.Db.WhatsNewUserStates.Add(new WhatsNewUserState { Id = Guid.NewGuid(), UserId = c.UserId, LastSeenAtUtc = T0.AddDays(1.5) });
        c.Db.SaveChanges();
        Assert.Equal(1, (await GetFeed(c)).UnreadCount);

        var late = SetUp(userCreated: T0.AddDays(10));
        late.Db.WhatsNewEntries.Add(Entry(WhatsNewAudience.All, T0.AddDays(2), important: true));
        late.Db.SaveChanges();
        var lateFeed = await GetFeed(late);
        Assert.Equal(0, lateFeed.UnreadCount);
        Assert.Empty(lateFeed.Popup);
    }

    [Fact]
    public async Task EditingAnEntry_DoesNotMakeItUnread()
    {
        var c = SetUp("SuperAdmin", userCreated: T0);
        var entry = Entry(WhatsNewAudience.All, T0.AddDays(1));
        c.Db.WhatsNewEntries.Add(entry);
        c.Db.SaveChanges();
        await c.Feed.Seen(default);
        Assert.Equal(0, (await GetFeed(c)).UnreadCount);

        await c.Admin.Update(entry.Id, Save("Edited", "Changed"), default);

        Assert.Equal(0, (await GetFeed(c)).UnreadCount);
        var stored = await c.Db.WhatsNewEntries.AsNoTracking().SingleAsync();
        Assert.Equal(T0.AddDays(1), stored.PublishedAtUtc);
        Assert.True(stored.UpdatedAt > stored.PublishedAtUtc);
    }

    [Fact]
    public async Task Popup_ImportantOnly_RespectsBaseline()
    {
        var c = SetUp(userCreated: T0);
        var important = Entry(WhatsNewAudience.All, T0.AddDays(1), important: true);
        c.Db.WhatsNewEntries.AddRange(important, Entry(WhatsNewAudience.All, T0.AddDays(2)));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);
        Assert.Equal(important.Id, Assert.Single(feed.Popup).Id);
        Assert.Equal(2, feed.UnreadCount);

        await c.Feed.PopupSeen(default);
        Assert.Empty((await GetFeed(c)).Popup);

        // Read in the panel only: an important entry already read must not pop up on the next visit.
        var other = SetUp(userCreated: T0);
        other.Db.WhatsNewEntries.Add(Entry(WhatsNewAudience.All, T0.AddDays(1), important: true));
        other.Db.SaveChanges();
        await other.Feed.Seen(default);
        Assert.Empty((await GetFeed(other)).Popup);
    }

    [Fact]
    public async Task Seen_CreatesStateThenUpdates()
    {
        var c = SetUp();
        await c.Feed.Seen(default);
        var first = (await c.Db.WhatsNewUserStates.AsNoTracking().SingleAsync()).LastSeenAtUtc;
        Assert.NotNull(first);

        await Task.Delay(5);
        await c.Feed.Seen(default);

        var state = await c.Db.WhatsNewUserStates.AsNoTracking().SingleAsync();
        Assert.True(state.LastSeenAtUtc > first);
    }

    [Fact]
    public async Task PopupSeen_SetsOnlyPopupSeenThrough()
    {
        var c = SetUp();
        await c.Feed.PopupSeen(default);

        var state = await c.Db.WhatsNewUserStates.AsNoTracking().SingleAsync();
        Assert.NotNull(state.PopupSeenThroughUtc);
        Assert.Null(state.LastSeenAtUtc);
    }

    [Fact]
    public async Task ViewAs_SuperAdminStillSeesAll()
    {
        var c = SetUp("SuperAdmin", viewAs: true);
        c.Db.WhatsNewEntries.AddRange(Entry(WhatsNewAudience.Admin, T0.AddDays(1)), Entry(WhatsNewAudience.ReadOnly, T0.AddDays(2)));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);

        Assert.Equal(2, feed.Entries.Count);
        Assert.Equal(2, feed.UnreadCount);
    }

    [Fact]
    public async Task UnknownUser_GetsEntriesButNoUnreadAndWritesNothing()
    {
        var c = SetUp(createUser: false);
        c.Db.WhatsNewEntries.Add(Entry(WhatsNewAudience.All, T0.AddDays(1), important: true));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);
        Assert.Single(feed.Entries);
        Assert.Equal(0, feed.UnreadCount);
        Assert.Empty(feed.Popup);
        Assert.IsType<OkObjectResult>((await c.Feed.Seen(default)).Result);
        Assert.Empty(c.Db.WhatsNewUserStates.ToList());
    }

    [Fact]
    public async Task Feed_NewestFirst_CappedAt50_UnreadCountsAll()
    {
        var c = SetUp(userCreated: T0);
        for (var i = 0; i < 55; i++) c.Db.WhatsNewEntries.Add(Entry(WhatsNewAudience.All, T0.AddDays(1).AddMinutes(i % 3)));
        c.Db.SaveChanges();

        var feed = await GetFeed(c);

        Assert.Equal(50, feed.Entries.Count);
        Assert.Equal(55, feed.UnreadCount);
        Assert.Equal(feed.Entries.OrderByDescending(e => e.PublishedAtUtc).ThenByDescending(e => e.Id).Select(e => e.Id), feed.Entries.Select(e => e.Id));
    }

    [Fact]
    public void AdminActions_RequireSuperAdmin()
    {
        var admin = typeof(AdminWhatsNewController);
        Assert.Equal("SuperAdmin", admin.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        var actions = admin.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
        Assert.Equal(5, actions.Length);
        foreach (var action in actions)
            Assert.Equal("SuperAdmin", action.GetCustomAttribute<AuthorizeAttribute>()?.Roles);

        Assert.Null(typeof(WhatsNewController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }

    // ── The SuperAdmin's writes ───────────────────────────────────────────────

    [Theory]
    [InlineData("", "World", "Admin", "Enter a title.")]
    [InlineData("   ", "World", "Admin", "Enter a title.")]
    [InlineData("This title is far too long to fit, because it runs on and on and on and on and on and on", "World", "Admin", "The title can be up to 80 characters.")]
    [InlineData("Hello", "", "Admin", "Enter the text people will read.")]
    [InlineData("Hello", "x", "", "Choose at least one role.")]
    [InlineData("Hello", "x", "Owner", "Choose at least one role.")]
    public async Task Save_Invalid_Returns400_AndStoresNothing(string title, string body, string roles, string message)
    {
        var c = SetUp("SuperAdmin");
        var dto = Save(title, body, roles.Length == 0 ? Array.Empty<string>() : new[] { roles });

        var result = await c.Admin.Create(dto, default);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(message, Assert.IsType<ApiResponse<AdminWhatsNewEntryDto>>(bad.Value).Errors!);
        Assert.Empty(c.Db.WhatsNewEntries.ToList());
    }

    [Fact]
    public async Task Save_MisspeltRole_Returns400_OnCreateAndUpdate_AndChangesNothing()
    {
        var c = SetUp("SuperAdmin");
        var bad = Assert.IsType<BadRequestObjectResult>((await c.Admin.Create(Save(roles: new[] { "Admin", "Cordinator" }), default)).Result);
        Assert.Contains("Unknown role: Cordinator.", Assert.IsType<ApiResponse<AdminWhatsNewEntryDto>>(bad.Value).Errors!);
        Assert.Empty(c.Db.WhatsNewEntries.ToList());

        var id = Saved(await c.Admin.Create(Save(), default)).Id;
        Assert.IsType<BadRequestObjectResult>((await c.Admin.Update(id, Save(roles: new[] { "Admin", "Cordinator" }), default)).Result);
        Assert.Equal(WhatsNewAudience.Admin, c.Db.WhatsNewEntries.Single().Roles);
    }

    [Fact]
    public async Task Save_BodyOver600_Returns400()
    {
        var c = SetUp("SuperAdmin");
        var result = await c.Admin.Create(Save(body: new string('x', 601)), default);
        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("The text can be up to 600 characters.", Assert.IsType<ApiResponse<AdminWhatsNewEntryDto>>(bad.Value).Errors!);
    }

    [Fact]
    public async Task Create_Edit_Archive_Restore()
    {
        var c = SetUp("SuperAdmin", userCreated: T0);
        var created = Saved(await c.Admin.Create(Save(roles: new[] { "Coordinator", "Admin" }, important: true), default));
        Assert.Matches("^admin-[0-9a-f]{8}$", created.Key);
        Assert.True((DateTime.UtcNow - created.PublishedAtUtc).Duration() < TimeSpan.FromMinutes(1));
        Assert.Equal(new[] { "Admin", "Coordinator" }, created.Roles);
        Assert.True(created.Important);

        var edited = Saved(await c.Admin.Update(created.Id, Save("New title", "New body", new[] { "ReadOnly" }), default));
        Assert.Equal(created.Key, edited.Key);
        Assert.Equal(created.PublishedAtUtc, edited.PublishedAtUtc);
        Assert.Equal("New title", edited.Title);
        Assert.Equal(new[] { "ReadOnly" }, edited.Roles);
        Assert.False(edited.Important);

        var archived = Saved(await c.Admin.Archive(created.Id, default));
        Assert.NotNull(archived.ArchivedAtUtc);
        Assert.Empty((await GetFeed(c)).Entries);
        var list = Assert.IsType<ApiResponse<List<AdminWhatsNewEntryDto>>>(Assert.IsType<OkObjectResult>((await c.Admin.GetAll(default)).Result).Value).Data!;
        Assert.NotNull(Assert.Single(list).ArchivedAtUtc);
        Assert.Equal(archived.ArchivedAtUtc, Saved(await c.Admin.Archive(created.Id, default)).ArchivedAtUtc);

        Assert.Null(Saved(await c.Admin.Restore(created.Id, default)).ArchivedAtUtc);

        var missing = Guid.NewGuid();
        Assert.IsType<NotFoundObjectResult>((await c.Admin.Update(missing, Save(), default)).Result);
        Assert.IsType<NotFoundObjectResult>((await c.Admin.Archive(missing, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await c.Admin.Restore(missing, default)).Result);
    }

    [Fact]
    public async Task CreateAndEdit_WriteAuditRows()
    {
        var c = SetUp("SuperAdmin");
        var created = Saved(await c.Admin.Create(Save(), default));
        await c.Admin.Update(created.Id, Save("Other"), default);
        await c.Feed.Seen(default);

        var rows = c.Db.AuditLogs.Where(a => a.EntityType == "WhatsNewEntry").ToList();
        Assert.Equal(2, rows.Count);
        Assert.Single(rows, r => r.Action == Odip.Domain.Enums.AuditAction.Created);
        Assert.Single(rows, r => r.Action == Odip.Domain.Enums.AuditAction.Updated);
        Assert.Equal(2, c.Db.AuditLogs.Count());
    }

    [Fact]
    public async Task Save_NormalisesCrlfAndTrims()
    {
        var c = SetUp("SuperAdmin");
        var created = Saved(await c.Admin.Create(Save(" T ", "  A\r\n\r\nB  "), default));
        Assert.Equal("T", created.Title);
        Assert.Equal("A\n\nB", created.Body);

        var body = string.Join("\r\n", Enumerable.Repeat(new string('x', 19), 30)); // 570 + 29 CRLF = 628 raw, 599 after normalising
        Assert.True(body.Length > 600);
        Assert.IsType<OkObjectResult>((await c.Admin.Create(Save(body: body), default)).Result);
    }
}
