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
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Notes;

/// <summary>
/// The add-note POST through the real MVC pipeline (a Kestrel host with only the notes controller and a signed-in Admin), because
/// [StringLength] on the retry key is enforced by [ApiController] model validation, which calling the action directly skips.
/// </summary>
public class ParticipantNoteRetryHttpTests
{
    private sealed class AdminHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e) : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(
                new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin")], "Test")), "Test")));
    }

    private sealed class OnlyNotesController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyNotesController);
        public IEnumerable<TypeInfo> Types { get; } = new[] { typeof(ParticipantNotesController).GetTypeInfo() };
    }

    private static async Task<(WebApplication App, HttpClient Client, Guid ParticipantId)> StartAsync()
    {
        var dbName = Guid.NewGuid().ToString();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        builder.Services.AddSingleton(tenant.Object);
        builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(dbName));
        builder.Services.AddScoped<SafetyNoteSyncService>();
        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, AdminHandler>("Test", null);
        builder.Services.AddControllers()
            .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyNotesController()); })
            .AddJsonOptions(o => Odip.Api.Serialization.ApiJsonOptions.Configure(o.JsonSerializerOptions));
        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapControllers();
        await app.StartAsync();

        var participantId = Guid.NewGuid();
        await using (var scope = app.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
            db.Participants.Add(new Participant { Id = participantId, TenantId = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true });
            await db.SaveChangesAsync();
        }
        return (app, new HttpClient { BaseAddress = new Uri(app.Urls.Single()) }, participantId);
    }

    private static async Task<int> CountAsync(WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<OdipDbContext>().ParticipantNotes.CountAsync();
    }

    [Fact]
    public async Task Post_AKeyOver100Characters_Returns400_AndMakesNoNote_WhileOneOf100Saves()
    {
        var (app, client, participantId) = await StartAsync();
        await using var _app = app;
        using var _client = client;
        var url = $"/api/v1/participants/{participantId}/notes";

        var tooLong = await client.PostAsJsonAsync(url, new { title = "Haircut", description = "Short bob.", idempotencyKey = new string('k', 101) });

        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Equal(0, await CountAsync(app));

        var ok = await client.PostAsJsonAsync(url, new { title = "Haircut", description = "Short bob.", idempotencyKey = new string('k', 100) });

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(1, await CountAsync(app));
    }
}
