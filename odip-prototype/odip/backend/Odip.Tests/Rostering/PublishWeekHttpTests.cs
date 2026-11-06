using System.Net;
using System.Reflection;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The wire contract of POST /api/v1/rostering/weeks/{weekStart}/publish on a real Kestrel host (the EarlyAccessHttpTests approach), which a direct controller call cannot see:
/// model binding runs before the action. No body must still bind (the whole week); an empty ids list must be refused, never mean the whole week.
/// </summary>
public class PublishWeekHttpTests
{
    private static readonly Guid Tenant = Guid.NewGuid();

    [Fact]
    public async Task NoBody_Binds_AndPublishesTheWholeWeek_ButAnEmptyIdsListIsRefused()
    {
        await using var app = await StartAsync();
        var client = new HttpClient { BaseAddress = new Uri(app.Urls.Single()), Timeout = TimeSpan.FromSeconds(30) };

        var noBody = await client.PostAsync("/api/v1/rostering/weeks/2026-11-02/publish", null);
        var emptyIds = await client.PostAsync("/api/v1/rostering/weeks/2026-11-02/publish", Json("{\"shiftIds\":[]}"));

        Assert.Equal(HttpStatusCode.OK, noBody.StatusCode);   // a 400/415 here is the body being required
        Assert.Equal(HttpStatusCode.BadRequest, emptyIds.StatusCode);
        Assert.Contains("Choose at least one shift", await emptyIds.Content.ReadAsStringAsync());
    }

    private static StringContent Json(string body) => new(body, Encoding.UTF8, new MediaTypeHeaderValue("application/json"));

    private static async Task<WebApplication> StartAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        var databaseName = Guid.NewGuid().ToString();
        builder.Services.AddDbContext<OdipDbContext>(o => o.UseInMemoryDatabase(databaseName));
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        builder.Services.AddScoped(_ => tenant.Object);
        builder.Services.AddScoped<StaffCompatibilityLinkService>();
        builder.Services.AddScoped<IStaffUnavailabilityQuery, StaffUnavailabilityQuery>();
        builder.Services.AddControllers()
            .ConfigureApplicationPartManager(m => { m.ApplicationParts.Clear(); m.ApplicationParts.Add(new OnlyRosteringController()); })
            .AddJsonOptions(o => Odip.Api.Serialization.ApiJsonOptions.Configure(o.JsonSerializerOptions));

        var app = builder.Build();
        app.UseMiddleware<ExceptionHandlingMiddleware>();
        app.MapControllers().WithMetadata(new AllowAnonymousAttribute());   // the roles are covered by ControllerRoleTests, this is about binding
        await app.StartAsync();
        return app;
    }

    private sealed class OnlyRosteringController : ApplicationPart, IApplicationPartTypeProvider
    {
        public override string Name => nameof(OnlyRosteringController);
        public IEnumerable<System.Reflection.TypeInfo> Types { get; } = [typeof(RosteringController).GetTypeInfo()];
    }
}
