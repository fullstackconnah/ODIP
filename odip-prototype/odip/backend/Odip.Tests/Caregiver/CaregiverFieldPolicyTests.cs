using System.Text.Json;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

public class CaregiverFieldPolicyTests
{
    private static readonly string[] DetailDtoJsonNames = typeof(ParticipantDetailDto)
        .GetProperties()
        .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name))
        .ToArray();

    [Fact]
    public void EveryInternalFieldExistsOnParticipantDetailDto()
    {
        // A renamed DTO property must not silently un-exclude a field.
        var missing = CaregiverFieldPolicy.InternalFields.Where(f => !DetailDtoJsonNames.Contains(f)).ToList();
        Assert.True(missing.Count == 0, "InternalFields names not on ParticipantDetailDto: " + string.Join(", ", missing));
    }

    [Fact]
    public void ProjectionNeverContainsAnInternalField()
    {
        var detail = new ParticipantDetailDto { Id = Guid.NewGuid(), FirstName = "S", LastName = "B" };
        var projection = CaregiverFieldPolicy.BuildProjection(detail);
        foreach (var f in CaregiverFieldPolicy.InternalFields)
            Assert.False(projection.ContainsKey(f), $"projection leaked internal field '{f}'");
    }

    [Fact]
    public void ProjectionContainsAtLeastTheIdentityFields()
    {
        var detail = new ParticipantDetailDto { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown" };
        var projection = CaregiverFieldPolicy.BuildProjection(detail);
        Assert.Equal("Sophie", projection["firstName"]!.GetValue<string>());
    }

    [Fact]
    public void EveryProfileFieldIsEitherEditableOrInternal()
    {
        // The drift guard: a field added to the Profile allocation later must be consciously
        // classified — this test names it until someone does.
        var profileIds = ParticipantFieldEntryMap.Entries
            .Where(e => e.Phase == ParticipantFieldEntryPhase.Profile)
            .Select(e => e.FieldId).ToHashSet();
        var editable = CaregiverFieldPolicy.EditableFieldIds().ToHashSet();
        var unclassified = profileIds
            .Where(id => !editable.Contains(id) && !CaregiverFieldPolicy.IsInternalFieldId(id))
            .ToList();
        Assert.True(unclassified.Count == 0, "Profile fields neither editable nor internal: " + string.Join(", ", unclassified));
    }

    [Fact]
    public void NoEditableFieldIdMapsToAnInternalDtoProperty()
    {
        foreach (var id in CaregiverFieldPolicy.EditableFieldIds())
            Assert.False(CaregiverFieldPolicy.IsInternalFieldId(id), $"'{id}' is both editable and internal");
    }

    [Fact]
    public void Sanitise_NullsInternalGroups()
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "S", LastName = "B" };
        var dirty = new PatchParticipantDto
        {
            PreferredStaff = new PatchPreferredStaffDto { PreferredStaffId = Guid.NewGuid() },
            NdisPlan = new PatchNdisPlanDto { NdisNumber = "430000000" },
            ServiceProfile = new PatchServiceProfileDto(),
            RisksHazardsSummary = new PatchRisksHazardsSummaryDto { BehaviourRiskSummary = "x" },
            AboutMe = new PatchAboutMeDto { Goals = "Live independently" },
        };
        var clean = CaregiverFieldPolicy.Sanitise(dirty, p);
        Assert.Null(clean.PreferredStaff);
        Assert.Null(clean.NdisPlan);
        Assert.Null(clean.ServiceProfile);
        Assert.Null(clean.RisksHazardsSummary);
        Assert.Equal("Live independently", clean.AboutMe!.Goals);
    }

    [Fact]
    public void Sanitise_OverwritesInternalScalarInsideEditableGroupWithCurrentValue()
    {
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "S", LastName = "B", BehaviourRiskRating = RiskRatingLevel.Low };
        var dirty = new PatchParticipantDto
        {
            BehaviourCommunication = new PatchBehaviourCommunicationDto { BehaviourRiskRating = RiskRatingLevel.Critical, Memory = MemoryLevel.Excellent },
        };
        var clean = CaregiverFieldPolicy.Sanitise(dirty, p);
        Assert.Equal(RiskRatingLevel.Low, clean.BehaviourCommunication!.BehaviourRiskRating);   // preserved, not cleared
        Assert.Equal(MemoryLevel.Excellent, clean.BehaviourCommunication.Memory);                  // caregiver edit kept
    }
}
