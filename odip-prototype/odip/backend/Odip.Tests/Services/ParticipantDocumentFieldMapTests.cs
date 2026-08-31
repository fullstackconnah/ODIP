using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// DOC-01 — reflection-based completeness coverage for <see cref="ParticipantDocumentFieldMap"/>,
/// mirroring <c>AdlTypeGroupsTests</c>/<c>ChecklistItemTypeGroupsTests</c>'s style: every scalar
/// entry's declared Participant property must actually exist (fails loudly with the field id on a
/// rename), every table entry's backing collection/entity must resolve, and no field id is
/// duplicated.
/// </summary>
public class ParticipantDocumentFieldMapTests
{
    [Fact]
    public void EveryScalarEntry_ParticipantPropertyName_ExistsOnParticipant()
    {
        foreach (var entry in ParticipantDocumentFieldMap.Entries.Where(e => !e.IsTable))
        {
            Assert.NotNull(entry.ParticipantPropertyName);
            var property = typeof(Participant).GetProperty(entry.ParticipantPropertyName!);
            Assert.True(property != null,
                $"Field '{entry.FieldId}' declares ParticipantPropertyName '{entry.ParticipantPropertyName}', which does not exist on Participant.");
        }
    }

    [Fact]
    public void EveryTableEntry_ParticipantPropertyNameIsNull()
    {
        foreach (var entry in ParticipantDocumentFieldMap.Entries.Where(e => e.IsTable))
            Assert.Null(entry.ParticipantPropertyName);
    }

    [Fact]
    public void NoDuplicateFieldIds()
    {
        var ids = ParticipantDocumentFieldMap.Entries.Select(e => e.FieldId).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void ContactsTable_BackingCollection_ExistsOnParticipant()
    {
        Assert.NotNull(typeof(Participant).GetProperty("ContactRoles"));
        Assert.NotNull(typeof(Odip.Domain.Entities.ParticipantContactRole).GetProperty("Person"));
    }

    [Fact]
    public void HealthConditionsTable_BackingCollection_ExistsOnParticipant()
    {
        Assert.NotNull(typeof(Participant).GetProperty("HealthConditions"));
    }

    [Fact]
    public void ConsentsTable_BackingCollection_ExistsOnParticipant()
    {
        Assert.NotNull(typeof(Participant).GetProperty("Consents"));
    }

    [Fact]
    public void AdlAssessmentsTable_BackingCollection_ExistsOnParticipant()
    {
        Assert.NotNull(typeof(Participant).GetProperty("AdlAssessments"));
    }

    [Fact]
    public void ChecklistItemsTable_BackingCollection_ExistsOnParticipant()
    {
        Assert.NotNull(typeof(Participant).GetProperty("ChecklistItems"));
    }

    [Fact]
    public void RiskEntriesTable_BackingEntity_ResolvesWithParticipantIdProperty()
    {
        var type = typeof(Odip.Domain.Entities.ParticipantRiskEntry);
        Assert.NotNull(type);
        Assert.NotNull(type.GetProperty("ParticipantId"));
    }

    [Fact]
    public void EveryTableFieldId_HasARegisteredBackingAssertionAbove()
    {
        // Guards against a 7th table being added to the field map without a matching
        // backing-collection assertion above (or a composer table-builder case) being added too.
        var knownTableFieldIds = new[] { "contactRoles", "healthConditions", "consents", "adlAssessments", "checklistItems", "riskEntries" };
        var actualTableFieldIds = ParticipantDocumentFieldMap.Entries.Where(e => e.IsTable).Select(e => e.FieldId).ToList();
        Assert.Equal(knownTableFieldIds.OrderBy(x => x), actualTableFieldIds.OrderBy(x => x));
    }
}
