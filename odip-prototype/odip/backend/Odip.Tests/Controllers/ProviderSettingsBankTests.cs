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

/// <summary>H80-1 and H80-2: bank details print on every invoice. A changed BSB or account number is checked and audited (never copied into the log); an unchanged echo is neither.</summary>
public class ProviderSettingsBankTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid Actor = Guid.NewGuid();
    private const string BsbRefusal = "Enter the BSB as 6 numbers, like 062-000.";

    private static (OdipDbContext db, ProviderSettingsController controller) Create(string? bsb = "123-456", string? account = "12345678")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        db.ProviderSettings.Add(new ProviderSettings
        {
            Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = "NSW",
            GSTRegistered = false, BankAccountName = "Synthetic Org", BSB = bsb, AccountNumber = account
        });
        db.SaveChanges();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Actor.ToString()), new Claim(ClaimTypes.Role, "Admin")], "Test"));
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static UpsertProviderSettingsDto Dto(string? bsb = "123-456", string? account = "12345678", bool gst = false, string state = "NSW", string? bankName = "Synthetic Org") => new()
    {
        RegistrationNumber = "REG", ABN = "12345678901", OrganisationName = "Org", Address = "1 St", State = state, GSTRegistered = gst,
        BankAccountName = bankName, BSB = bsb, AccountNumber = account
    };

    private static Task<List<AuditLog>> Audits(OdipDbContext db) => db.AuditLogs.IgnoreQueryFilters().ToListAsync();

    private static string? Refusal(ActionResult<ApiResponse<DateTime>> result) =>
        Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors![0];

    [Theory]
    [InlineData("abc")]
    [InlineData("12-3456")]
    [InlineData("0620000")]
    [InlineData("06 2000")]
    public async Task A_changed_BSB_that_is_not_six_digits_is_400_with_a_sentence_and_nothing_is_written(string bsb)
    {
        var (db, controller) = Create();
        using var _ = db;

        Assert.Equal(BsbRefusal, Refusal(await controller.Upsert(Dto(bsb: bsb), CancellationToken.None)));

        Assert.Equal("123-456", (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).BSB);
        Assert.Empty(await Audits(db));
    }

    [Theory]
    [InlineData("062-000", "062-000")]
    [InlineData("062000", "062000")]
    [InlineData("062 000", "062 000")]
    [InlineData("  062000 ", "062000")]
    public async Task A_valid_BSB_is_saved_trimmed(string typed, string stored)
    {
        var (db, controller) = Create();
        using var _ = db;

        Assert.IsNotType<BadRequestObjectResult>((await controller.Upsert(Dto(bsb: typed), CancellationToken.None)).Result);

        Assert.Equal(stored, (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).BSB);
    }

    [Theory]
    [InlineData("12a4")]
    [InlineData("123")]
    [InlineData("-1234")]
    [InlineData("123456789012345678901")]
    public async Task A_changed_account_number_with_other_characters_is_400(string account)
    {
        var (db, controller) = Create();
        using var _ = db;

        Assert.Equal("Enter the account number as 4 to 20 numbers.", Refusal(await controller.Upsert(Dto(account: account), CancellationToken.None)));

        Assert.Equal("12345678", (await db.ProviderSettings.IgnoreQueryFilters().SingleAsync()).AccountNumber);
    }

    [Fact]
    public async Task An_unchanged_odd_stored_BSB_and_account_number_still_re_save_with_no_audit_row()
    {
        var (db, controller) = Create(bsb: "12-34", account: "ab");
        using var _ = db;

        Assert.IsNotType<BadRequestObjectResult>((await controller.Upsert(Dto(bsb: "12-34", account: "ab"), CancellationToken.None)).Result);

        Assert.Empty(await Audits(db));
    }

    [Fact]
    public async Task A_changed_BSB_writes_one_masked_row_with_the_actor_and_neither_number()
    {
        var (db, controller) = Create();
        using var _ = db;

        await controller.Upsert(Dto(bsb: "062-000"), CancellationToken.None);

        var row = Assert.Single(await Audits(db));
        Assert.Equal(Actor, row.ChangedById);
        Assert.Contains("BSB", row.Changes);
        Assert.Contains("changed", row.Changes);
        Assert.DoesNotContain("062", row.Changes);
        Assert.DoesNotContain("123-456", row.Changes);
    }

    [Fact]
    public async Task Clearing_and_setting_the_account_number_each_write_one_row_without_the_number()
    {
        var (db, controller) = Create();
        using var _ = db;

        await controller.Upsert(Dto(account: ""), CancellationToken.None);
        await controller.Upsert(Dto(account: "87654321"), CancellationToken.None);

        var rows = await Audits(db);
        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.Changes!.Contains("cleared"));
        Assert.Contains(rows, r => r.Changes!.Contains("set"));
        Assert.All(rows, r => Assert.DoesNotContain("8765", r.Changes));
        Assert.All(rows, r => Assert.DoesNotContain("12345678", r.Changes));
    }

    [Fact]
    public async Task A_changed_bank_account_name_writes_one_row_without_either_name()
    {
        var (db, controller) = Create();
        using var _ = db;
        await controller.Upsert(Dto(bankName: "Brand New Holder"), CancellationToken.None);

        var row = Assert.Single(await Audits(db));
        Assert.Contains("BankAccountName", row.Changes);
        Assert.DoesNotContain("Brand New", row.Changes);
        Assert.DoesNotContain("Synthetic Org", row.Changes);
    }

    [Fact]
    public async Task The_first_save_of_a_new_settings_row_writes_one_set_row_for_the_BSB_and_no_value()
    {
        var (db, controller) = Create();
        using var _ = db;
        db.ProviderSettings.RemoveRange(await db.ProviderSettings.IgnoreQueryFilters().ToListAsync());
        db.SaveChanges();
        await controller.Upsert(Dto(bsb: "062-000", account: null, bankName: null), CancellationToken.None);

        var row = Assert.Single(await Audits(db));
        Assert.Contains("BSB", row.Changes);
        Assert.Contains("set", row.Changes);
        Assert.DoesNotContain("062", row.Changes);
    }

    [Fact]
    public async Task An_unchanged_echo_writes_no_rows_and_GST_and_State_changes_write_one_row_each_with_old_and_new()
    {
        var (db, controller) = Create();
        using var _ = db;

        await controller.Upsert(Dto(), CancellationToken.None);
        Assert.Empty(await Audits(db));

        await controller.Upsert(Dto(gst: true, state: "VIC"), CancellationToken.None);

        var rows = await Audits(db);
        Assert.Equal(2, rows.Count);
        var gst = Assert.Single(rows, r => r.Changes!.Contains("GSTRegistered"));
        Assert.Contains("False", gst.Changes);
        Assert.Contains("True", gst.Changes);
        var state = Assert.Single(rows, r => r.Changes!.Contains("\"State\""));
        Assert.Contains("NSW", state.Changes);
        Assert.Contains("VIC", state.Changes);
    }
}
