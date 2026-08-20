using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Dictionary;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Tests for FieldRegistryController — the field-registry/forms-engine API slice covering
/// field definitions, form templates, and the FieldValue EAV store.
/// </summary>
public class FieldRegistryControllerTests
{
    private static OdipDbContext CreateDb(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            FirstName = "Test",
            LastName = "Participant",
            IsActive = true,
        };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static FieldDefinition SeedField(
        OdipDbContext db, Guid tenantId, string fieldId, string name, string domain,
        FieldDataType dataType, string? allowedValuesRaw = null, bool isSensitive = false,
        params string[] appearsIn)
    {
        var def = new FieldDefinition
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            FieldId = fieldId,
            Name = name,
            Domain = domain,
            DataType = dataType,
            PicklistOptionsRaw = allowedValuesRaw,
            IsSensitive = isSensitive,
            IsActive = true,
            AppearsInForms = appearsIn.ToList(),
        };
        db.FieldDefinitions.Add(def);
        db.SaveChanges();
        return def;
    }

    // ── GET fields paging ──────────────────────────────────────────────

    [Fact]
    public async Task GetFields_Paging_ReturnsRequestedPageSizeNotAllRows()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        for (var i = 0; i < 280; i++)
        {
            SeedField(db, tenantId, $"PID-{i:000}", $"Field {i}", "Participant Identity", FieldDataType.Text);
        }

        var controller = new FieldRegistryController(db);

        var result = await controller.GetFields(domain: null, appearsIn: null, search: null, page: 1, pageSize: 25, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<FieldDefinitionDto>>>(ok.Value);
        Assert.True(body.Success);
        Assert.Equal(25, body.Data!.Items.Count);
        Assert.Equal(280, body.Data.TotalCount);
        Assert.Equal(1, body.Data.Page);
        Assert.Equal(25, body.Data.PageSize);
    }

    [Fact]
    public async Task GetFields_PageSizeClampedTo200()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        for (var i = 0; i < 280; i++)
        {
            SeedField(db, tenantId, $"PID-{i:000}", $"Field {i}", "Participant Identity", FieldDataType.Text);
        }

        var controller = new FieldRegistryController(db);
        var result = await controller.GetFields(null, null, null, page: 1, pageSize: 1000, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<PagedResult<FieldDefinitionDto>>>(ok.Value);
        Assert.Equal(200, body.Data!.Items.Count);
        Assert.Equal(200, body.Data.PageSize);
    }

    // ── forms/{formName} ────────────────────────────────────────────────

    [Fact]
    public async Task GetFormByName_ReturnsFieldsMappedToThatForm()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        SeedField(db, tenantId, "PID-001", "Participant Full Name", "Participant Identity",
            FieldDataType.Text, appearsIn: "Risk Assessment");
        SeedField(db, tenantId, "PID-002", "Date of Birth", "Participant Identity",
            FieldDataType.Date, appearsIn: "Risk Assessment");
        SeedField(db, tenantId, "ORG-001", "Provider Legal Name", "Organisation & Provider",
            FieldDataType.Text, appearsIn: "BSP Service Agreement");

        var controller = new FieldRegistryController(db);
        var result = await controller.GetFormByName("Risk Assessment", CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<FormTemplateDto>>(ok.Value);
        Assert.True(body.Success);
        var allFieldIds = body.Data!.Sections.SelectMany(s => s.Fields).Select(f => f.FieldId).ToList();
        Assert.Contains("PID-001", allFieldIds);
        Assert.Contains("PID-002", allFieldIds);
        Assert.DoesNotContain("ORG-001", allFieldIds);
    }

    [Fact]
    public async Task GetFormByName_UnknownForm_ReturnsNotFound()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        SeedField(db, tenantId, "PID-001", "Participant Full Name", "Participant Identity",
            FieldDataType.Text, appearsIn: "Risk Assessment");

        var controller = new FieldRegistryController(db);
        var result = await controller.GetFormByName("Nonexistent Form", CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // ── PUT values validation ────────────────────────────────────────────

    [Fact]
    public async Task UpsertValues_InvalidTypeInBatch_RejectsAndPersistsNothing()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = SeedParticipant(db, tenantId);
        var numberField = SeedField(db, tenantId, "NUM-001", "Weekly Hours", "Health & Medical", FieldDataType.Integer);
        var textField = SeedField(db, tenantId, "TXT-001", "Notes", "Health & Medical", FieldDataType.Text);

        var controller = new FieldRegistryController(db);
        var dto = new UpsertFieldValuesDto
        {
            Values = new List<UpsertFieldValueDto>
            {
                new() { FieldDefinitionId = textField.Id, Value = "Valid note" },
                new() { FieldDefinitionId = numberField.Id, Value = "abc" }, // not a valid integer
            }
        };

        var result = await controller.UpsertValues("participant", participant.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<FieldValueDto>>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.NotNull(body.Errors);
        Assert.Contains(body.Errors!, e => e.Contains("NUM-001"));

        // Nothing persisted from the batch — not even the valid text field entry.
        Assert.Empty(await db.FieldValues.Where(v => v.ParticipantId == participant.Id).ToListAsync());
    }

    [Fact]
    public async Task UpsertValues_InvalidPicklistValue_Rejected()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = SeedParticipant(db, tenantId);
        var picklistField = SeedField(db, tenantId, "SEL-001", "Plan Type", "Participant Identity",
            FieldDataType.SingleSelect, allowedValuesRaw: "Agency; Plan; Self");

        var controller = new FieldRegistryController(db);
        var dto = new UpsertFieldValuesDto
        {
            Values = new List<UpsertFieldValueDto>
            {
                new() { FieldDefinitionId = picklistField.Id, Value = "NotAnOption" }
            }
        };

        var result = await controller.UpsertValues("participant", participant.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<FieldValueDto>>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Empty(await db.FieldValues.Where(v => v.ParticipantId == participant.Id).ToListAsync());
    }

    [Fact]
    public async Task UpsertValues_UnknownFieldDefinitionId_Rejected()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = SeedParticipant(db, tenantId);

        var controller = new FieldRegistryController(db);
        var dto = new UpsertFieldValuesDto
        {
            Values = new List<UpsertFieldValueDto>
            {
                new() { FieldDefinitionId = Guid.NewGuid(), Value = "whatever" }
            }
        };

        var result = await controller.UpsertValues("participant", participant.Id, dto, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<FieldValueDto>>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Contains(body.Errors!, e => e.Contains("field definition not found"));
    }

    [Fact]
    public async Task UpsertValues_ValidBatch_PersistsAndSecondUpsertUpdatesNotDuplicates()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = SeedParticipant(db, tenantId);
        var textField = SeedField(db, tenantId, "TXT-001", "Notes", "Health & Medical", FieldDataType.Text);
        var numberField = SeedField(db, tenantId, "NUM-001", "Weekly Hours", "Health & Medical", FieldDataType.Integer);

        var controller = new FieldRegistryController(db);

        var firstDto = new UpsertFieldValuesDto
        {
            Values = new List<UpsertFieldValueDto>
            {
                new() { FieldDefinitionId = textField.Id, Value = "First note" },
                new() { FieldDefinitionId = numberField.Id, Value = "40" },
            }
        };
        var firstResult = await controller.UpsertValues("participant", participant.Id, firstDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(firstResult.Result);

        var afterFirst = await db.FieldValues.Where(v => v.ParticipantId == participant.Id).ToListAsync();
        Assert.Equal(2, afterFirst.Count);

        var secondDto = new UpsertFieldValuesDto
        {
            Values = new List<UpsertFieldValueDto>
            {
                new() { FieldDefinitionId = textField.Id, Value = "Updated note" },
            }
        };
        var secondResult = await controller.UpsertValues("participant", participant.Id, secondDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(secondResult.Result);

        var afterSecond = await db.FieldValues.Where(v => v.ParticipantId == participant.Id).ToListAsync();
        // Still 2 rows — the text field value was updated in place, not duplicated.
        Assert.Equal(2, afterSecond.Count);
        var updatedText = afterSecond.Single(v => v.FieldDefinitionId == textField.Id);
        Assert.Equal("Updated note", updatedText.Value);
    }

    [Fact]
    public async Task GetValues_UnsupportedEntityType_ReturnsBadRequest()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var controller = new FieldRegistryController(db);

        var result = await controller.GetValues("staff", Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }
}
