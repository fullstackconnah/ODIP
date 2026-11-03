using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The participant's MM level (travel cap): its own remoteness PATCH group, so an address save that omits it can never clear it (EF InMemory).</summary>
public class ParticipantMmLevelPatchTests
{
    private static readonly Guid Tenant = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");

    private static (OdipDbContext Db, ParticipantsController Controller, Guid Id) Create(int? mm)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        var actor = new Mock<IHttpContextAccessor>();
        actor.Setup(a => a.HttpContext).Returns(new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Synthetic Coordinator")], "Test")) });
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(new AuditInterceptor(actor.Object)).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Sophie", LastName = "Brown", AddressState = "QLD", MmLevel = mm };
        db.Participants.Add(p);
        db.SaveChanges();
        return (db, new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db)), p.Id);
    }

    private static PatchParticipantDto Level(int? mm, Dictionary<string, int>? expected = null) => new() { Remoteness = new PatchRemotenessDto { MmLevel = mm }, ExpectedRevisions = expected };

    [Fact]
    public async Task Remoteness_patch_sets_the_level_and_the_detail_reads_it_back()
    {
        var (db, controller, id) = Create(null);
        var ok = Assert.IsType<OkObjectResult>((await controller.Patch(id, Level(4), default)).Result);
        Assert.Equal(1, Assert.IsType<ApiResponse<ParticipantDetailDto>>(ok.Value).Data!.GroupRevisions!["remoteness"]);
        var detail = Assert.IsType<OkObjectResult>((await controller.GetById(id, default)).Result);
        Assert.Equal(4, Assert.IsType<ApiResponse<ParticipantDetailDto>>(detail.Value).Data!.MmLevel);
    }

    [Fact]
    public async Task M1_An_address_patch_that_omits_the_level_leaves_a_stored_level_alone()
    {
        var (db, controller, id) = Create(4);
        var address = new PatchParticipantDto { Address = new PatchAddressDto { AddressState = "NSW", AddressPostcode = "2000" } };
        Assert.IsType<OkObjectResult>((await controller.Patch(id, address, default)).Result);
        var p = await db.Participants.SingleAsync();
        Assert.Equal("NSW", p.AddressState);
        Assert.Equal(4, p.MmLevel);
    }

    [Fact]
    public async Task A_null_level_clears_it_when_the_remoteness_group_is_sent()
    {
        var (db, controller, id) = Create(6);
        Assert.IsType<OkObjectResult>((await controller.Patch(id, Level(null), default)).Result);
        Assert.Null((await db.Participants.SingleAsync()).MmLevel);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(8)]
    [InlineData(-1)]
    public async Task A_level_outside_1_to_7_is_a_400_with_the_message_and_changes_nothing(int mm)
    {
        var (db, controller, id) = Create(4);
        var bad = Assert.IsType<BadRequestObjectResult>((await controller.Patch(id, Level(mm), default)).Result);
        Assert.Equal("Choose a level from 1 to 7.", Assert.IsType<ApiResponse<ParticipantDetailDto>>(bad.Value).Errors[0]);
        Assert.Equal(4, (await db.Participants.SingleAsync()).MmLevel);
    }

    [Fact]
    public async Task M1_A_remoteness_patch_with_the_wrong_revision_gets_the_section_changed_409()
    {
        var (db, controller, id) = Create(4);
        db.ParticipantGroupRevisions.Add(new ParticipantGroupRevision { ParticipantId = id, GroupKey = "remoteness", Revision = 2, UpdatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var conflict = Assert.IsType<ConflictObjectResult>((await controller.Patch(id, Level(6, new() { ["remoteness"] = 1 }), default)).Result);
        Assert.Equal("participant-section-changed", Assert.IsType<ApiResponse<ParticipantSectionChangedDto>>(conflict.Value).Code);
        Assert.Equal(4, (await db.Participants.SingleAsync()).MmLevel);
    }

    [Fact]
    public async Task The_change_is_audited_with_the_old_and_new_level()
    {
        var (db, controller, id) = Create(null);
        await controller.Patch(id, Level(4), default);
        var audit = Assert.Single(await db.AuditLogs.Where(a => a.EntityId == id && a.Action == AuditAction.Updated).ToListAsync());
        var change = Assert.Single(JsonDocument.Parse(audit.Changes).RootElement.EnumerateArray().ToArray(), c => c.GetProperty("Field").GetString() == "MmLevel");
        Assert.Null(change.GetProperty("Old").GetString());
        Assert.Equal("4", change.GetProperty("New").GetString());
    }

    [Fact]
    public void The_caregiver_projection_never_carries_the_level_and_a_submission_cannot_set_it()
    {
        Assert.True(CaregiverFieldPolicy.IsInternalFieldId("mmLevel"));
        var projection = CaregiverFieldPolicy.BuildProjection(new ParticipantDetailDto { Id = Guid.NewGuid(), FirstName = "S", LastName = "B", MmLevel = 4 });
        Assert.False(projection.ContainsKey("mmLevel"));
        var clean = CaregiverFieldPolicy.Sanitise(new PatchParticipantDto { Remoteness = new PatchRemotenessDto { MmLevel = 7 } }, new Participant { MmLevel = 4 });
        Assert.Null(clean.Remoteness);
    }
}
