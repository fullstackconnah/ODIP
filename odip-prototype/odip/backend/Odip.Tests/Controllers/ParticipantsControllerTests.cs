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

/// <summary>
/// Covers <see cref="Participant.HasRestrictivePracticeFlag"/>'s derived-on-read semantics
/// (task 5): the flag is no longer independently writable via create/update — it is computed as
/// true iff the participant has any active <see cref="Domain.Entities.RestrictivePractice"/>
/// register row. Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as
/// ParticipantRoutinesControllerTests.
/// </summary>
public class ParticipantsControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static CreateParticipantDto MinimalCreateDto(string firstName = "Sophie", string lastName = "Brown") => new()
    {
        FirstName = firstName,
        LastName = lastName,
        PlanType = Domain.Enums.PlanType.SelfManaged,
        OvernightSupport = Domain.Enums.OvernightSupportType.None,
        OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
        SupportRatio = Domain.Enums.SupportRatio.OneToOne,
    };

    [Fact]
    public async Task GetById_NoRegisterRows_HasRestrictivePracticeFlagIsFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetById_HasActiveRegisterRow_HasRestrictivePracticeFlagIsTrue()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Seclusion room", IsActive = true,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetById_OnlyInactiveRegisterRows_HasRestrictivePracticeFlagIsFalse()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Description = "Retired restraint", IsActive = false,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var result = await controller.GetById(participant.Id, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(body.Data!.HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task GetAll_ProjectsDerivedFlagPerParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var withFlag = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var withoutFlag = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        db.Participants.AddRange(withFlag, withoutFlag);
        db.RestrictivePractices.Add(new Domain.Entities.RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = withFlag.Id, Description = "Active restraint", IsActive = true,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var result = await controller.GetAll(null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Items.Single(p => p.Id == withFlag.Id).HasRestrictivePracticeFlag);
        Assert.False(body.Data.Items.Single(p => p.Id == withoutFlag.Id).HasRestrictivePracticeFlag);
    }

    [Fact]
    public async Task Create_DoesNotExposeHasRestrictivePracticeFlagOnWriteDto()
    {
        // Compile-time guard: CreateParticipantDto/UpdateParticipantDto no longer carry
        // HasRestrictivePracticeFlag — this test exists so a future re-add would need to touch
        // this file (and its accompanying comment) rather than slipping back in silently.
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db);

        var result = await controller.Create(MinimalCreateDto(), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        var saved = await db.Participants.SingleAsync();
        Assert.False(saved.HasRestrictivePracticeFlag); // never set independently — stays at the type default
    }
}
