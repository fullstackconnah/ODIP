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
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Portal;

/// <summary>
/// Break Start and End now bind an optional body. An old client posts none (no body, no Content-Type), and that must still bind to null and
/// behave as before; a controller-level call cannot show model binding, only a real request can.
/// </summary>
public class PortalLateWritesHttpTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("{}")]
    public async Task BreakStartAndEnd_AcceptNoBody_OrAnEmptyObject(string? body)
    {
        await using var host = await Host.StartAsync();
        var (shiftId, _) = await host.SeedAsync();

        var started = await host.PostAsync($"api/v1/portal/shifts/{shiftId}/breaks/start", body);
        Assert.True(started.StatusCode == HttpStatusCode.OK, await started.Content.ReadAsStringAsync());
        var breakId = (await host.ReadAsync(db => db.ShiftBreaks.Select(b => b.Id).SingleAsync()));

        host.Clock.Set(host.Clock.GetUtcNow().AddMinutes(10));   // a break must end after it starts
        var ended = await host.PostAsync($"api/v1/portal/shifts/{shiftId}/breaks/{breakId}/end", body);
        Assert.True(ended.StatusCode == HttpStatusCode.OK, await ended.Content.ReadAsStringAsync());
        Assert.NotNull(await host.ReadAsync(db => db.ShiftBreaks.Select(b => b.EndedAt).SingleAsync()));
    }

    [Fact]
    public async Task BreakStart_WithAClientIdAndTime_StoresThem_AndAResendIsAOkNoOp()
    {
        await using var host = await Host.StartAsync();
        var (shiftId, _) = await host.SeedAsync();
        var id = Guid.NewGuid();
        var body = $$"""{"breakId":"{{id}}","startedAt":"2026-07-14T00:30:00Z"}""";

        Assert.Equal(HttpStatusCode.OK, (await host.PostAsync($"api/v1/portal/shifts/{shiftId}/breaks/start", body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.PostAsync($"api/v1/portal/shifts/{shiftId}/breaks/start", body)).StatusCode);

        var stored = await host.ReadAsync(db => db.ShiftBreaks.SingleAsync());
        Assert.Equal((id, new DateTime(2026, 7, 14, 0, 30, 0, DateTimeKind.Utc)), (stored.Id, stored.StartedAt));
    }

    private sealed class OnlyPortalController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyPortalController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(PortalController).GetTypeInfo() };
    }

    /// <summary>Signs every request in as the seeded worker.</summary>
    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Host.WorkerId.ToString()), new("fullName", "Ben Turner") };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        public static readonly Guid WorkerId = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
        private readonly WebApplication _app;
        private readonly HttpClient _client;

        public FakeClock Clock { get; private init; } = null!;

        private Host(WebApplication app, FakeClock clock) { Clock = clock; _app = app; _client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) }; }

        public static async Task<Host> StartAsync()
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            var tenant = new Mock<ICurrentTenant>();
            tenant.Setup(t => t.TenantId).Returns(Guid.Empty);
            tenant.Setup(t => t.IsSuperAdmin).Returns(true);
            builder.Services.AddSingleton(tenant.Object);
            var clock = FakeClock.AtUtc(2026, 7, 14, 1, 0);
            builder.Services.AddSingleton<TimeProvider>(clock);
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName)
                .ConfigureWarnings(w => w.Ignore(CoreEventId.ManyServiceProvidersCreatedWarning)));
            builder.Services.AddAuthentication(HeaderAuth.Scheme).AddScheme<AuthenticationSchemeOptions, HeaderAuth>(HeaderAuth.Scheme, _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddControllers()
                .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyPortalController()); })
                .AddJsonOptions(o => ApiJsonOptions.Configure(o.JsonSerializerOptions));

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();
            await app.StartAsync();
            return new Host(app, clock);
        }

        public async Task<(Guid ShiftId, Guid CompletionId)> SeedAsync()
        {
            using var scope = _app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
            var worker = new User
            {
                Id = WorkerId, Email = "ben@example.com", Username = "ben", FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true,
                IsMedicationCompetent = true, MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1),
            };
            var shift = new Shift
            {
                Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = worker.Id, ServiceDate = new DateOnly(2026, 7, 14),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.InProgress,
            };
            var start = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc);
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = start, TimeZoneId = "Australia/Sydney", SubmittedByUserId = worker.Id, StartedAt = start, IsActive = true,
            };
            db.AddRange(participant, worker, shift, completion);
            await db.SaveChangesAsync();
            return (shift.Id, completion.Id);
        }

        public async Task<T> ReadAsync<T>(Func<OdipDbContext, Task<T>> read)
        {
            using var scope = _app.Services.CreateScope();
            return await read(scope.ServiceProvider.GetRequiredService<OdipDbContext>());
        }

        /// <summary>A POST with exactly <paramref name="json"/> as its body; null sends no body and no Content-Type, as an old client does.</summary>
        public Task<HttpResponseMessage> PostAsync(string path, string? json) =>
            _client.PostAsync(path, json is null ? null : new StringContent(json, Encoding.UTF8, "application/json"));

        public async ValueTask DisposeAsync()
        {
            _client.Dispose();
            await _app.DisposeAsync();
        }
    }
}
