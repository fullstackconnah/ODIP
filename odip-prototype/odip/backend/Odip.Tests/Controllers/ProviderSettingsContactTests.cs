using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Settings PR 2b: the organisation's trading name, contact email, phone and website on ProviderSettings. Wire rules (null leaves, blank clears, trimmed), the two refusal sentences, the read paths.</summary>
public class ProviderSettingsContactTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private const string EmailRefusal = "Enter a full email address, like office@example.com.au.";
    private const string WebsiteRefusal = "Enter the full web address, starting with https://.";

    private static (OdipDbContext db, ProviderSettingsController controller) Create(string role = "Admin")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role)], "Test"));
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static void Seed(OdipDbContext db, string? trading = null, string? email = null, string? phone = null, string? website = null)
    {
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St",
            State = "NSW", TradingName = trading, ContactEmail = email, ContactPhone = phone, Website = website,
        });
        db.SaveChanges();
    }

    private static UpsertProviderSettingsDto Dto(string? trading = null, string? email = null, string? phone = null, string? website = null) => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW",
        TradingName = trading, ContactEmail = email, ContactPhone = phone, Website = website,
    };

    private static Task<ProviderSettings> Stored(OdipDbContext db) => db.ProviderSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == TenantA);

    private static string Refusal(ActionResult<ApiResponse<DateTime>> result) =>
        Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors![0];

    [Theory]
    [InlineData("office")]
    [InlineData("office@example")]
    [InlineData("@example.com.au")]
    [InlineData("a b@example.com.au")]
    [InlineData("a@@example.com.au")]
    public async Task Upsert_ABadEmail_Is400WithTheSentence_AndNothingIsWritten(string email)
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db, email: "old@example.com.au");

        var result = await controller.Upsert(Dto(email: email), CancellationToken.None);

        Assert.Equal(EmailRefusal, Refusal(result));
        Assert.Equal("old@example.com.au", (await Stored(db)).ContactEmail);
    }

    [Theory]
    [InlineData("example.com.au")]
    [InlineData("www.example.com.au")]
    [InlineData("ftp://example.com.au")]
    [InlineData("https://localhost")]
    [InlineData("https://")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://exa mple.com.au")]
    public async Task Upsert_ABadWebsite_Is400WithTheSentence_AndNothingIsWritten(string website)
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db, website: "https://old.example.com.au");

        var result = await controller.Upsert(Dto(website: website), CancellationToken.None);

        Assert.Equal(WebsiteRefusal, Refusal(result));
        Assert.Equal("https://old.example.com.au", (await Stored(db)).Website);
    }

    [Theory]
    [InlineData("http://example.com.au")]
    [InlineData("https://www.example.com.au")]
    [InlineData("  https://www.example.com.au/about  ")]
    public async Task Upsert_AValidWebsite_IsSaved_Trimmed(string website)
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db);

        Assert.IsType<OkObjectResult>((await controller.Upsert(Dto(website: website), CancellationToken.None)).Result);

        Assert.Equal(website.Trim(), (await Stored(db)).Website);
    }

    [Fact]
    public async Task Upsert_TrimsEveryField()
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db);

        await controller.Upsert(Dto("  Riverbend  ", " office@example.com.au ", " 03 9123 4567 "), CancellationToken.None);

        var s = await Stored(db);
        Assert.Equal("Riverbend", s.TradingName);
        Assert.Equal("office@example.com.au", s.ContactEmail);
        Assert.Equal("03 9123 4567", s.ContactPhone);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Upsert_ABlankValue_ClearsTheFieldToNull(string blank)
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db, "Riverbend", "office@example.com.au", "03 9123 4567", "https://www.example.com.au");

        Assert.IsType<OkObjectResult>((await controller.Upsert(Dto(blank, blank, blank, blank), CancellationToken.None)).Result);

        var s = await Stored(db);
        Assert.Null(s.TradingName);
        Assert.Null(s.ContactEmail);
        Assert.Null(s.ContactPhone);
        Assert.Null(s.Website);
    }

    [Fact]
    public async Task Upsert_NullFields_LeaveTheStoredValues()
    {
        var (db, controller) = Create();
        using var _ = db;
        Seed(db, "Riverbend", "office@example.com.au", "03 9123 4567", "https://www.example.com.au");

        await controller.Upsert(Dto(), CancellationToken.None);

        var s = await Stored(db);
        Assert.Equal("Riverbend", s.TradingName);
        Assert.Equal("office@example.com.au", s.ContactEmail);
        Assert.Equal("03 9123 4567", s.ContactPhone);
        Assert.Equal("https://www.example.com.au", s.Website);
        Assert.Empty(await db.AuditLogs.ToListAsync());
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    public async Task Get_CarriesTheFourFields_ToEveryRole(string role)
    {
        var (db, controller) = Create(role);
        using var _ = db;
        Seed(db, "Riverbend", "office@example.com.au", "03 9123 4567", "https://www.example.com.au");

        var dto = Assert.IsType<ApiResponse<ProviderSettingsDto>>(Assert.IsType<OkObjectResult>((await controller.Get(CancellationToken.None)).Result).Value).Data!;

        Assert.Equal("Riverbend", dto.TradingName);
        Assert.Equal("office@example.com.au", dto.ContactEmail);
        Assert.Equal("03 9123 4567", dto.ContactPhone);
        Assert.Equal("https://www.example.com.au", dto.Website);
    }

    [Theory]
    [InlineData(nameof(UpsertProviderSettingsDto.TradingName), 200)]
    [InlineData(nameof(UpsertProviderSettingsDto.ContactEmail), 254)]
    [InlineData(nameof(UpsertProviderSettingsDto.ContactPhone), 30)]
    [InlineData(nameof(UpsertProviderSettingsDto.Website), 500)]
    public void TheDto_RefusesAValueOverTheLimit_AndAcceptsOneAtIt(string property, int limit)
    {
        UpsertProviderSettingsDto With(int length) => property switch
        {
            nameof(UpsertProviderSettingsDto.TradingName) => Dto(trading: new string('a', length)),
            nameof(UpsertProviderSettingsDto.ContactEmail) => Dto(email: new string('a', length)),
            nameof(UpsertProviderSettingsDto.ContactPhone) => Dto(phone: new string('1', length)),
            _ => Dto(website: new string('a', length)),
        };
        bool Valid(UpsertProviderSettingsDto d) => Validator.TryValidateObject(d, new ValidationContext(d), null, true);

        Assert.True(Valid(With(limit)));
        Assert.False(Valid(With(limit + 1)));
    }
}
