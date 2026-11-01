using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>My account: a person edits their own name and mobile, and only theirs. The id comes from the signed-in claim, never from the body or view-as.</summary>
public class ProfileControllerTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();

    private static OdipDbContext CreateDb(Guid? ambientTenant)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(ambientTenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static User Seed(OdipDbContext db, Guid tenantId, string first = "Jane", string last = "Smith", string? mobile = "0400 000 000", Guid? payrollId = null,
        UserRole role = UserRole.Coordinator)
    {
        var u = new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last, Username = Guid.NewGuid().ToString("N"), Email = $"{first.ToLower()}{Guid.NewGuid():N}@x.test",
            Mobile = mobile, Role = role, IsActive = true, ExternalPayrollId = payrollId?.ToString(), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.Users.Add(u);
        db.SaveChanges();
        return u;
    }

    private static ProfileController As(OdipDbContext db, User caller) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, caller.Id.ToString())], "test")) },
        },
    };

    private static UpdateMyProfileDto Dto(string? first = "Jane", string? last = "Smith", string? mobile = "0400 000 000") =>
        new() { FirstName = first, LastName = last, Mobile = mobile };

    private static MyProfileDto Data(ActionResult<ApiResponse<MyProfileDto>> r) =>
        Assert.IsType<ApiResponse<MyProfileDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    private static User Stored(OdipDbContext db, Guid id) => db.Users.IgnoreQueryFilters().AsNoTracking().Single(u => u.Id == id);

    [Fact]
    public async Task Put_changes_only_the_callers_row()
    {
        using var db = CreateDb(A);
        var colleague = Seed(db, A, "Sam", "Roe");
        var elsewhere = Seed(db, B, "Zed", "Out");
        var me = Seed(db, A, "Pat", "Lee");

        Assert.Equal("Alex", Data(await As(db, me).Update(Dto("Alex", "Kim", "0411 111 111"), default)).FirstName);

        Assert.Equal(("Alex", "Kim", "0411 111 111"), (Stored(db, me.Id).FirstName, Stored(db, me.Id).LastName, Stored(db, me.Id).Mobile));
        Assert.Equal(("Sam", "Roe"), (Stored(db, colleague.Id).FirstName, Stored(db, colleague.Id).LastName));
        Assert.Equal(("Zed", "Out"), (Stored(db, elsewhere.Id).FirstName, Stored(db, elsewhere.Id).LastName));
    }

    [Fact]
    public async Task A_body_naming_another_tenants_user_changes_nothing_there()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A, "Pat", "Lee");
        var other = Seed(db, B, "Zed", "Out", role: UserRole.Admin);
        var before = JsonSerializer.Serialize(Stored(db, other.Id));
        var body = JsonSerializer.Deserialize<UpdateMyProfileDto>(
            $$"""{"firstName":"Alex","lastName":"Kim","mobile":"0411 111 111","id":"{{other.Id}}","userId":"{{other.Id}}","tenantId":"{{B}}","role":"SuperAdmin","email":"x@evil.test"}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

        await As(db, me).Update(body, default);

        Assert.Equal(before, JsonSerializer.Serialize(Stored(db, other.Id)));
        var mine = Stored(db, me.Id);
        Assert.Equal(("Alex", A, UserRole.Coordinator), (mine.FirstName, mine.TenantId, mine.Role));
        Assert.NotEqual("x@evil.test", mine.Email);
    }

    [Fact]
    public async Task SuperAdmin_viewing_as_edits_their_own_row_not_the_viewed_user()
    {
        using var db = CreateDb(B); // view-as: the ambient tenant is the viewed organisation
        var viewed = Seed(db, B, "Vera", "Viewed");
        var colleague = Seed(db, A, "Sam", "Roe");
        var me = Seed(db, A, "Root", "Admin", role: UserRole.SuperAdmin);

        Assert.Equal("Rae", Data(await As(db, me).Update(Dto("Rae", "Admin"), default)).FirstName);

        Assert.Equal("Rae", Stored(db, me.Id).FirstName);
        Assert.Equal("Vera", Stored(db, viewed.Id).FirstName);
        Assert.Equal("Sam", Stored(db, colleague.Id).FirstName);
    }

    [Fact]
    public async Task Eh_linked_change_is_409_and_unchanged()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A, "Pat", "Lee", payrollId: Guid.NewGuid());

        var r = await As(db, me).Update(Dto("Alex", "Lee", "0400 000 000"), default);

        var conflict = Assert.IsType<ConflictObjectResult>(r.Result);
        Assert.Equal("EmploymentHeroOwnsProfile", Assert.IsType<ApiResponse<MyProfileDto>>(conflict.Value).Code);
        Assert.Equal("Pat", Stored(db, me.Id).FirstName);
    }

    [Fact]
    public async Task Eh_linked_same_values_is_200()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A, "Pat", "Lee", payrollId: Guid.NewGuid());

        var p = Data(await As(db, me).Update(Dto("Pat", "Lee", "0400 000 000"), default));

        Assert.True(p.ManagedByEmploymentHero);
    }

    [Theory]
    [InlineData("", "Lee", "0400 000 000")]
    [InlineData("   ", "Lee", "0400 000 000")]
    [InlineData("Pat", "", "0400 000 000")]
    [InlineData("Pat", "Lee", "123456789012345678901")]
    [InlineData("Pat", "Lee", "04abc")]
    public async Task Validation_is_400_and_saves_nothing(string first, string last, string mobile)
    {
        using var db = CreateDb(A);
        var me = Seed(db, A, "Pat", "Lee");

        var r = await As(db, me).Update(Dto(first, last, mobile), default);

        Assert.IsType<BadRequestObjectResult>(r.Result);
        Assert.Equal("Pat", Stored(db, me.Id).FirstName);
    }

    [Fact]
    public async Task First_name_over_100_characters_is_400()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A);
        Assert.IsType<BadRequestObjectResult>((await As(db, me).Update(Dto(new string('a', 101)), default)).Result);
    }

    [Fact]
    public async Task Names_are_trimmed_and_a_blank_mobile_saves_null()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A);

        await As(db, me).Update(Dto("  Alex ", " Kim  ", "   "), default);

        var s = Stored(db, me.Id);
        Assert.Equal(("Alex", "Kim", (string?)null), (s.FirstName, s.LastName, s.Mobile));
    }

    [Fact]
    public async Task A_mobile_with_digits_spaces_and_plus_brackets_dashes_saves()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A);
        Assert.Equal("+61 (4) 11-111", Data(await As(db, me).Update(Dto(mobile: "+61 (4) 11-111"), default)).Mobile);
    }

    [Fact]
    public async Task Get_returns_own_email_and_the_eh_flag()
    {
        using var db = CreateDb(A);
        var me = Seed(db, A, "Pat", "Lee", payrollId: Guid.NewGuid());
        Seed(db, A, "Sam", "Roe");

        var p = Data(await As(db, me).Get(default));

        Assert.Equal((me.Email, "Pat", "Lee", true), (p.Email, p.FirstName, p.LastName, p.ManagedByEmploymentHero));
    }

    [Theory]
    [InlineData(nameof(ProfileController.Get), "Admin", true)]
    [InlineData(nameof(ProfileController.Get), "Coordinator", true)]
    [InlineData(nameof(ProfileController.Get), "SuperAdmin", true)]
    [InlineData(nameof(ProfileController.Get), "ReadOnly", false)]
    [InlineData(nameof(ProfileController.Get), "SupportWorker", false)]
    [InlineData(nameof(ProfileController.Update), "Coordinator", true)]
    [InlineData(nameof(ProfileController.Update), "ReadOnly", false)]
    [InlineData(nameof(ProfileController.Update), "SupportWorker", false)]
    public void Roles_are_named_on_each_action(string action, string role, bool admitted)
    {
        var type = typeof(ProfileController);
        var attrs = type.GetCustomAttributes<AuthorizeAttribute>(true).Concat(type.GetMethod(action)!.GetCustomAttributes<AuthorizeAttribute>(true)).Where(a => a.Roles != null).ToList();
        Assert.NotEmpty(attrs);
        Assert.Equal(admitted, attrs.All(a => a.Roles!.Split(',').Select(r => r.Trim()).Contains(role)));
    }

    [Fact]
    public void Class_requires_a_signed_in_user_and_the_write_is_rate_limited()
    {
        Assert.NotNull(typeof(ProfileController).GetCustomAttribute<AuthorizeAttribute>());
        Assert.Equal("api", typeof(ProfileController).GetMethod(nameof(ProfileController.Update))!.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }
}
