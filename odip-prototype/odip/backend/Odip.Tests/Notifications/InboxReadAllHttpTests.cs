using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Odip.Api.Controllers;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>
/// The wire contract of POST api/v1/notifications/inbox/read-all, against a real Kestrel host that serves just the
/// NotificationsController (same approach as EarlyAccessHttpTests): an old client sends no body at all and still
/// marks every unread item; the new bell sends { "ids": [...] } and only those are marked.
/// </summary>
public class InboxReadAllHttpTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    [Fact]
    public async Task ABodylessPost_FromAnOldClient_MarksEveryUnreadItemOfTheCaller_AndNobodyElses()
    {
        await using var host = await TestHost.StartAsync();
        var mine = await host.SeedAsync(3);

        var response = await host.PostAsync(null);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(new[] { true, true, true }, await host.ReadStatesAsync(mine));
        Assert.Equal(new[] { false }, await host.ReadStatesAsync(host.Colleague));
    }

    [Fact]
    public async Task APostWithIds_MarksOnlyThoseItems()
    {
        await using var host = await TestHost.StartAsync();
        var mine = await host.SeedAsync(3);

        var response = await host.PostAsync($"{{\"ids\":[\"{mine[0]}\",\"{host.Colleague[0]}\"]}}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(new[] { true, false, false }, await host.ReadStatesAsync(mine));
        Assert.Equal(new[] { false }, await host.ReadStatesAsync(host.Colleague)); // a colleague's id is ignored
    }

    private sealed class HeaderAuth : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        public HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : base(options, logger, encoder) { }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var user = Request.Headers["X-Test-User"].FirstOrDefault();
            if (user is null) return Task.FromResult(AuthenticateResult.NoResult());
            var identity = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, user) }, "Test");
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), "Test")));
        }
    }

    private sealed class FixedTenant : ICurrentTenant
    {
        public Guid? TenantId => Tenant;
        public bool IsSuperAdmin => false;
        public Guid? ViewAsUserId => null;
    }

    private sealed class OnlyNotificationsController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyNotificationsController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(NotificationsController).GetTypeInfo() };
    }

    private sealed class TestHost : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private readonly HttpClient _client;
        private readonly Guid _me = Guid.NewGuid();

        private TestHost(WebApplication app, HttpClient client)
        {
            _app = app;
            _client = client;
        }

        /// <summary>The colleague's one unread item.</summary>
        public Guid[] Colleague { get; private set; } = Array.Empty<Guid>();

        public static async Task<TestHost> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddScoped<ICurrentTenant, FixedTenant>();
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, HeaderAuth>("Test", null);
            builder.Services.AddAuthorization();
            builder.Services.AddControllers().ConfigureApplicationPartManager(m =>
            {
                m.ApplicationParts.Clear();
                m.ApplicationParts.Add(new OnlyNotificationsController());
            });

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();

            var host = new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) });
            host._client.DefaultRequestHeaders.Add("X-Test-User", host._me.ToString());
            return host;
        }

        /// <summary>Seeds <paramref name="count"/> unread items for the caller and one for a colleague; returns the caller's ids.</summary>
        public async Task<Guid[]> SeedAsync(int count)
        {
            var colleague = Guid.NewGuid();
            var rows = Enumerable.Range(0, count).Select(i => NewRow(_me, i)).Append(NewRow(colleague, 0)).ToList();
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.InAppNotifications.AddRange(rows);
            await db.SaveChangesAsync();
            Colleague = new[] { rows[^1].Id };
            return rows.Take(count).Select(r => r.Id).ToArray();
        }

        private static InAppNotification NewRow(Guid recipient, int minutesAgo) => new()
        {
            Id = Guid.NewGuid(), TenantId = Tenant, RecipientUserId = recipient, EventType = NotificationEventType.ShiftAssigned,
            EntityType = "Shift", EntityId = Guid.NewGuid(), Title = "t", LinkTo = "/portal", CreatedAt = DateTime.UtcNow.AddMinutes(-minutesAgo),
        };

        /// <summary>A null body sends no content and no Content-Type, as axios does for an undefined payload.</summary>
        public Task<HttpResponseMessage> PostAsync(string? json) =>
            _client.PostAsync("/api/v1/notifications/inbox/read-all", json is null ? null : new StringContent(json, Encoding.UTF8, "application/json"));

        public async Task<bool[]> ReadStatesAsync(Guid[] ids)
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            var rows = await db.InAppNotifications.AsNoTracking().Where(n => ids.Contains(n.Id)).ToDictionaryAsync(n => n.Id);
            return ids.Select(id => rows[id].ReadAt != null).ToArray();
        }

        public async ValueTask DisposeAsync()
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
