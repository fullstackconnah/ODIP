using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Claims;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.DataRetention;

/// <summary>The early returns of the due list and the confirmed purge, on InMemory (nothing is deleted on these paths). The deleting path is in ParticipantPurgePostgresTests.</summary>
public class DataRetentionHttpTests
{
    private static readonly DateOnly Old = new(2018, 1, 1);
    private readonly string _store = Guid.NewGuid().ToString();
    private readonly Guid _tenant = Guid.NewGuid();
    private readonly FixedClock _clock = new(new DateTimeOffset(2026, 11, 5, 3, 0, 0, TimeSpan.Zero));

    private DataRetentionController Controller(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = DataExport.DataExportTestKit.Tenant(tenantId, superAdmin);
        var db = DataExport.DataExportTestKit.InMemory(_store, tenant);
        return new DataRetentionController(db, tenant, _clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Name, "Ada Admin"), new Claim(ClaimTypes.Role, "Admin")], "test")),
                },
            },
        };
    }

    private Participant Seed(Guid tenantId, bool active = false, DateOnly? start = null, string last = "Lee")
    {
        using var db = TestDb.Create(_store);
        if (!db.Tenants.Any(t => t.Id == tenantId))
        {
            db.Tenants.Add(new Tenant { Id = tenantId, Name = "Org " + tenantId.ToString("N")[..4], EmailDomain = $"{tenantId:N}.example.com" });
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" });
        }
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = last, NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged,
            IsActive = active, RetentionStartsOn = active ? null : start ?? Old,
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static T Body<T>(ActionResult<ApiResponse<T>> r, Type status)
    {
        Assert.IsType(status, r.Result);
        return ((ApiResponse<T>)((ObjectResult)r.Result!).Value!).Data!;
    }

    private static string Message<T>(ActionResult<ApiResponse<T>> r) => Assert.Single(((ApiResponse<T>)((ObjectResult)r.Result!).Value!).Errors!);

    private static PurgeParticipantRequest Req(string last = "Lee", string reason = "Seven years passed") => new() { LastName = last, Reason = reason };

    [Fact]
    public async Task The_due_list_holds_only_this_organisations_due_participants_with_their_counts()
    {
        var mine = Seed(_tenant);
        Seed(_tenant, start: new DateOnly(2025, 1, 1)); // not due
        Seed(_tenant, active: true);
        Seed(Guid.NewGuid()); // another organisation's due participant

        var list = Body(await Controller(_tenant).Due(CancellationToken.None), typeof(OkObjectResult));

        var row = Assert.Single(list);
        Assert.Equal(mine.Id, row.ParticipantId);
        Assert.Equal(new DateOnly(2025, 1, 1), row.DueOn);
        Assert.Equal(1, row.RowCounts["Participants"]);
    }

    [Fact]
    public async Task A_SuperAdmin_viewing_as_an_organisation_gets_403_on_both_routes()
    {
        var p = Seed(_tenant);
        var controller = Controller(_tenant, superAdmin: true);

        Assert.Equal(403, ((ObjectResult)(await controller.Due(CancellationToken.None)).Result!).StatusCode);
        Assert.Equal(403, ((ObjectResult)(await controller.Purge(p.Id, Req(), CancellationToken.None)).Result!).StatusCode);
    }

    [Fact]
    public async Task Another_organisations_participant_is_404()
    {
        var theirs = Seed(Guid.NewGuid());
        var result = await Controller(_tenant).Purge(theirs.Id, Req(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task A_blank_reason_is_400(string reason)
    {
        var p = Seed(_tenant);
        var result = await Controller(_tenant).Purge(p.Id, Req(reason: reason), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(DataRetentionController.ReasonRequired, Message(result));
    }

    [Fact]
    public async Task A_reason_over_500_characters_is_400()
    {
        var p = Seed(_tenant);
        var result = await Controller(_tenant).Purge(p.Id, Req(reason: new string('x', PurgeRecord.ReasonMaxLength + 1)), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task A_wrong_last_name_is_400_and_a_name_that_differs_only_in_case_and_spaces_is_accepted()
    {
        var p = Seed(_tenant, active: true, last: "Lee"); // active, so a name that passes the check meets the next gate (409) and nothing is deleted
        var controller = Controller(_tenant);

        var wrong = await controller.Purge(p.Id, Req(last: "Smith"), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(wrong.Result);
        Assert.Equal(DataRetentionController.NameMismatch, Message(wrong));

        var accepted = await controller.Purge(p.Id, Req(last: "  LEE "), CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(accepted.Result);
    }

    [Fact]
    public async Task An_active_participant_is_409()
    {
        var p = Seed(_tenant, active: true);
        var result = await Controller(_tenant).Purge(p.Id, Req(), CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(DataRetentionController.NotDue, Message(result));
    }

    [Fact]
    public async Task A_participant_not_yet_due_is_409()
    {
        var p = Seed(_tenant, start: new DateOnly(2025, 1, 1));
        var result = await Controller(_tenant).Purge(p.Id, Req(), CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(result.Result);
        using var db = TestDb.Create(_store);
        Assert.NotNull(db.Participants.Find(p.Id));
    }

    [Fact]
    public async Task A_participant_already_purged_answers_200_with_the_same_record_and_changes_nothing()
    {
        var id = Guid.NewGuid();
        var record = new PurgeRecord
        {
            Id = Guid.NewGuid(), TenantId = _tenant, EntityType = PurgeRecord.ParticipantType, EntityId = id, ConfirmedById = Guid.NewGuid(), ConfirmedByName = "Ada Admin",
            ConfirmedAt = _clock.GetUtcNow(), Reason = "Seven years passed", RetentionStartsOn = Old, DueOn = Old.AddYears(7), RowCounts = JsonSerializer.Serialize(new Dictionary<string, int> { ["Participants"] = 1 }),
        };
        using (var db = TestDb.Create(_store)) { db.PurgeRecords.Add(record); db.SaveChanges(); }

        var result = await Controller(_tenant).Purge(id, Req(last: "Whoever"), CancellationToken.None);

        var dto = Body(result, typeof(OkObjectResult));
        Assert.Equal(record.Id, dto.Id);
        Assert.Equal(1, dto.RowCounts["Participants"]);
    }
}
