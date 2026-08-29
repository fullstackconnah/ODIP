using System.Text.Json;
using System.Text.Json.Serialization;
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
    private static readonly JsonSerializerOptions ApiJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() }
    };

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
    public async Task Create_ServiceStreamsFlags_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db);

        var dto = MinimalCreateDto() with { ServiceStreams = Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip };
        var createResult = await controller.Create(dto, CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var getResult = await controller.GetById(createdBody.Data!.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);

        Assert.Equal(Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip, body.Data!.ServiceStreams);
        Assert.True(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.STA));
        Assert.True(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.Trip));
        Assert.False(body.Data.ServiceStreams.HasFlag(Domain.Enums.ServiceStreams.BSP));
    }

    [Fact]
    public async Task Update_ServiceStreamsFlags_RoundTripThroughGetById()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var updateDto = new UpdateParticipantDto
        {
            FirstName = "Sophie", LastName = "Brown", PlanType = Domain.Enums.PlanType.SelfManaged,
            OvernightSupport = Domain.Enums.OvernightSupportType.None, OvernightRatio = Domain.Enums.SupportRatio.OneToOne,
            SupportRatio = Domain.Enums.SupportRatio.OneToOne, IsActive = true,
            ServiceStreams = Domain.Enums.ServiceStreams.BSP | Domain.Enums.ServiceStreams.CommunityNursing,
        };

        var updateResult = await controller.Update(participant.Id, updateDto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(updateResult.Result);

        var getResult = await controller.GetById(participant.Id, CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(getResult.Result).Value);
        Assert.Equal(Domain.Enums.ServiceStreams.BSP | Domain.Enums.ServiceStreams.CommunityNursing, body.Data!.ServiceStreams);
    }

    [Fact]
    public void ParticipantListDto_CombinedServiceStreams_SerialisesAsCommaSeparatedString()
    {
        // Proves the actual wire format the frontend receives: JsonStringEnumConverter (registered
        // globally in Program.cs — see ApiJsonOptions here) natively serialises a combined [Flags]
        // value as a comma-separated list of member names, and Enum.Parse/JsonStringEnumConverter
        // read that same format back on input — no custom List<string> conversion needed.
        var dto = new ParticipantListDto
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", FullName = "Sophie Brown",
            ServiceStreams = Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip,
        };

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);
        var value = doc.RootElement.GetProperty("serviceStreams").GetString();

        Assert.Equal("STA, Trip", value);

        var roundTripped = JsonSerializer.Deserialize<ParticipantListDto>(json, ApiJsonOptions);
        Assert.Equal(Domain.Enums.ServiceStreams.STA | Domain.Enums.ServiceStreams.Trip, roundTripped!.ServiceStreams);
    }

    [Fact]
    public void ParticipantListDto_NoServiceStreams_SerialisesAsNone()
    {
        var dto = new ParticipantListDto { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", FullName = "Sophie Brown" };

        var json = JsonSerializer.Serialize(dto, ApiJsonOptions);
        using var doc = JsonDocument.Parse(json);

        Assert.Equal("None", doc.RootElement.GetProperty("serviceStreams").GetString());
    }

    [Fact]
    public async Task Create_DefaultServiceStreams_IsNone()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db);

        var createResult = await controller.Create(MinimalCreateDto(), CancellationToken.None);
        var created = Assert.IsType<CreatedAtActionResult>(createResult.Result);
        var createdBody = Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value);

        var saved = await db.Participants.SingleAsync(p => p.Id == createdBody.Data!.Id);
        Assert.Equal(Domain.Enums.ServiceStreams.None, saved.ServiceStreams);
    }

    [Fact]
    public async Task GetAll_ProjectsHasActiveMedicationsPerParticipant()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var withActiveMed = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var withOnlyCeasedMed = new Participant { Id = Guid.NewGuid(), FirstName = "Harrison", LastName = "Lee", IsActive = true };
        var withNoMeds = new Participant { Id = Guid.NewGuid(), FirstName = "Jamie", LastName = "Kim", IsActive = true };
        db.Participants.AddRange(withActiveMed, withOnlyCeasedMed, withNoMeds);
        db.ParticipantMedications.Add(new Domain.Entities.ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = withActiveMed.Id, Name = "Paracetamol",
            Type = Domain.Enums.MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = Domain.Enums.MedicationStatus.Active, StartDate = DateTime.UtcNow,
        });
        db.ParticipantMedications.Add(new Domain.Entities.ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = withOnlyCeasedMed.Id, Name = "Ibuprofen",
            Type = Domain.Enums.MedicationType.Prn, PrnIndication = "Pain", PrnMaxDosesPer24h = 4,
            Status = Domain.Enums.MedicationStatus.Ceased, StartDate = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ParticipantsController(db);
        var result = await controller.GetAll(null, null, null, null, null, 1, 50, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(body.Data!.Items.Single(p => p.Id == withActiveMed.Id).HasActiveMedications);
        Assert.False(body.Data.Items.Single(p => p.Id == withOnlyCeasedMed.Id).HasActiveMedications);
        Assert.False(body.Data.Items.Single(p => p.Id == withNoMeds.Id).HasActiveMedications);
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
