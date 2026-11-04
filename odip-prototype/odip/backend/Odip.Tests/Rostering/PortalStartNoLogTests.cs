using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Reflection;
using System.Security.Claims;
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
using Odip.Api.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Location check PR2, no-log: a real pipeline with every log line captured. A Start that carries a latitude and longitude must leave neither string in any log line, and must save neither.</summary>
public class PortalStartNoLogTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid Worker = Guid.NewGuid();

    [Fact]
    public async Task A_Start_with_coordinates_writes_no_log_line_containing_them()
    {
        var lines = new ConcurrentQueue<string>();
        await using var host = await Host.StartAsync(lines);
        var shiftId = await host.SeedShiftWithPlaceAsync();

        var response = await host.Client.SendAsync(new HttpRequestMessage(HttpMethod.Post, $"/api/v1/portal/shifts/{shiftId}/start")
        {
            Headers = { { "X-Test-Role", "SupportWorker" } },
            Content = JsonContent.Create(new { latitude = -27.46977, longitude = 153.02512, accuracyMetres = 18, locationReason = "Parked round the corner" }),
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain(lines, l => l.Contains("27.46977") || l.Contains("153.02512"));
        Assert.Equal(LocationCheckStatus.NotAtLocation, await host.SavedCheckAsync(shiftId));
    }

    private sealed class OnlyPortalController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyPortalController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(PortalController).GetTypeInfo() };
    }

    private sealed class CapturingLogger(ConcurrentQueue<string> lines) : ILoggerProvider, ILogger
    {
        public ILogger CreateLogger(string categoryName) => this;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => lines.Enqueue(formatter(state, exception) + " " + exception);
        public bool IsEnabled(LogLevel logLevel) => true;
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public void Dispose() { }
    }

    private sealed class HeaderAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Scheme = "Test";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (Request.Headers["X-Test-Role"].FirstOrDefault() is not { } role) return Task.FromResult(AuthenticateResult.NoResult());
            var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, Worker.ToString()), new(ClaimTypes.Role, role), new("tenant_id", Tenant.ToString()) };
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme)), Scheme)));
        }
    }

    private sealed class Host : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private Host(WebApplication app, HttpClient client) { _app = app; Client = client; }
        public HttpClient Client { get; }

        public static async Task<Host> StartAsync(ConcurrentQueue<string> lines)
        {
            var databaseName = Guid.NewGuid().ToString();
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Logging.ClearProviders();
            builder.Logging.SetMinimumLevel(LogLevel.Trace);
            builder.Logging.AddProvider(new CapturingLogger(lines));
            builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddScoped<ICurrentTenant, CurrentTenant>();
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
            return new Host(app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(60) });
        }

        public async Task<Guid> SeedShiftWithPlaceAsync()
        {
            await using var scope = _app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Amy", LastName = "Ng", IsActive = true };
            var place = new ServiceLocation { Id = Guid.NewGuid(), TenantId = Tenant, Name = "Southside Library", Latitude = -33.8688m, Longitude = 151.2093m, RadiusMetres = 200 };
            var shift = new Shift
            {
                Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = participant.Id, UserId = Worker, ServiceDate = new DateOnly(2026, 9, 8),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
                Status = ShiftStatus.Published, ServiceLocationId = place.Id,
            };
            db.AddRange(new User { Id = Worker, TenantId = Tenant, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true },
                participant, place, shift);
            await db.SaveChangesAsync();
            return shift.Id;
        }

        public async Task<LocationCheckStatus?> SavedCheckAsync(Guid shiftId)
        {
            await using var scope = _app.Services.CreateAsyncScope();
            return (await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ShiftCompletions.IgnoreQueryFilters().SingleAsync(c => c.ShiftId == shiftId)).LocationCheck;
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}
