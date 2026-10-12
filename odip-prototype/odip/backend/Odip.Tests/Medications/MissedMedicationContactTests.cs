using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Medications;

/// <summary>
/// PARTICIPANTS-2: the missed-medication guidance read the manager contact from provider settings, which only Admin, Coordinator and SuperAdmin
/// may read, so the support worker who gives the doses was told no contact was configured. The guidance now has its own read, open to every
/// signed-in role, that carries the manager contact and the state (for the health advice line) and nothing else from the settings.
/// </summary>
public class MissedMedicationContactTests
{
    [Fact]
    public async Task GuidanceContact_ReturnsOwnOrganisationsManagerAndState()
    {
        using var db = Db();
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = B, State = "WA", ManagerName = "Other", ManagerPhone = "0811111111" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = A, State = "NSW", ManagerName = "Morgan Manager", ManagerPhone = "0299990000", BSB = "062000", AccountNumber = "12345678" });
        db.SaveChanges();

        var result = await new MedicationsController(db, Moq.Mock.Of<Odip.Domain.Interfaces.ICurrentTenant>()).GetMissedGuidanceContact(CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MissedMedicationContactDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(("Morgan Manager", "0299990000", "NSW"), (body.Data!.ManagerName, body.Data.ManagerPhone, body.Data.State));
    }

    [Fact]
    public async Task GuidanceContact_NoSettings_ReturnsNull()
    {
        using var db = Db();

        var result = await new MedicationsController(db, Moq.Mock.Of<Odip.Domain.Interfaces.ICurrentTenant>()).GetMissedGuidanceContact(CancellationToken.None);

        Assert.Null(Assert.IsType<ApiResponse<MissedMedicationContactDto?>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data);
    }

    [Fact]
    public void GuidanceContact_IsOpenToEveryRole_AndCarriesOnlyTheContact()
    {
        var method = typeof(MedicationsController).GetMethod(nameof(MedicationsController.GetMissedGuidanceContact))!;
        Assert.NotNull(method.GetCustomAttribute<HttpGetAttribute>());
        Assert.All(method.GetCustomAttributes<AuthorizeAttribute>(), a => Assert.Null(a.Roles));
        Assert.All(typeof(MedicationsController).GetCustomAttributes<AuthorizeAttribute>(), a => Assert.Null(a.Roles));

        Assert.Equal(new[] { "ManagerName", "ManagerPhone", "State" },
            typeof(MissedMedicationContactDto).GetProperties().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal));
    }
}
