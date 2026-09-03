using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// DOC-01 — pure composition tests: a hand-built <see cref="Participant"/> (plus child
/// collections) directly in memory, NO DbContext, NO QuestPDF. Verifies
/// <see cref="ParticipantDocumentComposer"/>'s tag filtering, the Community Access stream gate,
/// table row filtering, and the empty-value-renders-as-em-dash convention.
/// </summary>
public class ParticipantDocumentComposerTests
{
    private static Participant BuildParticipant(ServiceStreams serviceStreams = ServiceStreams.None)
    {
        var participantId = Guid.NewGuid();
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Nora", LastName = "Kin", Phone = "0400 000 000", Email = "nora@example.com" };

        var participant = new Participant
        {
            Id = participantId,
            FirstName = "Sophie",
            LastName = "Brown",
            NdisNumber = "123456789",
            ServiceStreams = serviceStreams,
            // Support Needs & Mobility — mobilityAidWalker is Intake-only, mobilityNotes is Profile-only.
            MobilityAidWalker = true,
            MobilityNotes = "Uses a walking frame indoors",
            // Key Identifiers — Profile-only section, should never appear on the Intake Form.
            PensionCardNumber = "PEN-001",
            // Medical
            HidpaSupportCategories = HidpaSupportCategory.EpilepsyManagement | HidpaSupportCategory.EnteralFeeding,
            HidpaNotes = "Shared visibility per hidpaSupportCategories",
            // Community Access — only relevant when the stream flag is set.
            SignsHappyAndSettled = "Smiling and humming",
        };

        participant.ContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, PersonId = person.Id, Person = person,
            RoleType = ContactRoleType.NextOfKin, IsPrimary = true, Status = ContactRoleStatus.Active,
        });

        participant.HealthConditions.Add(new ParticipantHealthCondition
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ConditionType = HealthConditionType.Epilepsy, Has = true, Severity = "Grand Mal", Notes = "Seizure plan on file",
        });
        participant.HealthConditions.Add(new ParticipantHealthCondition
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ConditionType = HealthConditionType.Diabetes, Has = false,
        });

        participant.Consents.Add(new ParticipantConsent
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ConsentType = ConsentType.PhotoVideo, Granted = true, SignedByName = "Sophie Brown",
        });

        participant.AdlAssessments.Add(new ParticipantAdlAssessment
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, AdlType = AdlType.Dressing, Level = AdlLevel.Supervision, Notes = "Needs prompting", HowToHelpNotes = "Lay clothes out in order",
        });

        participant.ChecklistItems.Add(new ParticipantChecklistItem
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.Yes,
        });
        // Unanswered — must be excluded from the checklist table (Value.HasValue filter).
        participant.ChecklistItems.Add(new ParticipantChecklistItem
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ItemType = ChecklistItemType.FallsRisk, Value = null,
        });

        return participant;
    }

    private static List<ParticipantRiskEntry> BuildRiskEntries(Guid participantId) => new()
    {
        new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participantId, AtRiskParty = AtRiskParty.Participant, Description = "Falls risk on stairs", IsActive = true },
        new ParticipantRiskEntry { Id = Guid.NewGuid(), ParticipantId = participantId, AtRiskParty = AtRiskParty.Staff, Description = "Retired risk", IsActive = false },
    };

    [Fact]
    public void ComposeIntakeForm_IncludesIntakeAndSharedSections_ExcludesProfileOnlySections()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeIntakeForm(participant, BuildRiskEntries(participant.Id));

        Assert.Contains(model.Sections, s => s.Heading == "Participant Details");
        Assert.Contains(model.Sections, s => s.Heading == "Support Needs & Mobility");
        // Key Identifiers is entirely Profile-tagged — must never appear on the Intake Form.
        Assert.DoesNotContain(model.Sections, s => s.Heading == "Key Identifiers");
    }

    [Fact]
    public void ComposeIntakeForm_MobilityAidWalker_IsIncluded_ButMobilityNotes_IsNot()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeIntakeForm(participant, BuildRiskEntries(participant.Id));

        var mobilitySection = model.Sections.Single(s => s.Heading == "Support Needs & Mobility");
        Assert.Contains(mobilitySection.Fields, f => f.Label == "Walker");
        Assert.DoesNotContain(mobilitySection.Fields, f => f.Label == "Mobility Notes");
    }

    [Fact]
    public void ComposeParticipantProfile_IncludesProfileAndSharedSections()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        Assert.Contains(model.Sections, s => s.Heading == "Participant Details");
        Assert.Contains(model.Sections, s => s.Heading == "Key Identifiers");

        var keyIdentifiers = model.Sections.Single(s => s.Heading == "Key Identifiers");
        Assert.Contains(keyIdentifiers.Fields, f => f.Label == "Pension Card Number" && f.Value == "PEN-001");
    }

    [Fact]
    public void ComposeParticipantProfile_MobilityAidWalker_IsExcluded_IntakeOnlyField()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var mobilitySection = model.Sections.Single(s => s.Heading == "Support Needs & Mobility");
        Assert.DoesNotContain(mobilitySection.Fields, f => f.Label == "Walker");
        Assert.Contains(mobilitySection.Fields, f => f.Label == "Mobility Notes" && f.Value == "Uses a walking frame indoors");
    }

    [Fact]
    public void CommunityAccessSection_AbsentWhenStreamNotSet_PresentWhenSet()
    {
        var withoutStream = BuildParticipant(ServiceStreams.None);
        var withoutModel = ParticipantDocumentComposer.ComposeParticipantProfile(withoutStream, BuildRiskEntries(withoutStream.Id));
        Assert.DoesNotContain(withoutModel.Sections, s => s.Heading == "Community Access");

        var withStream = BuildParticipant(ServiceStreams.CommunityAccessDailyLiving);
        var withModel = ParticipantDocumentComposer.ComposeParticipantProfile(withStream, BuildRiskEntries(withStream.Id));
        var caSection = Assert.Single(withModel.Sections, s => s.Heading == "Community Access");
        Assert.Contains(caSection.Fields, f => f.Label == "Signs I Am Happy and Settled" && f.Value == "Smiling and humming");
    }

    [Fact]
    public void CommunityAccessSection_NeverAppearsOnIntakeForm_EvenWithStreamSet()
    {
        var participant = BuildParticipant(ServiceStreams.CommunityAccessDailyLiving);
        var model = ParticipantDocumentComposer.ComposeIntakeForm(participant, BuildRiskEntries(participant.Id));

        Assert.DoesNotContain(model.Sections, s => s.Heading == "Community Access");
    }

    [Fact]
    public void HealthConditionsTable_OnlyIncludesRowsWithHasTrue()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var medical = model.Sections.Single(s => s.Heading == "Medical");
        var table = medical.Tables.Single(t => t.Heading == "Health Conditions");
        Assert.Single(table.Rows);
        Assert.Contains(table.Rows, row => row[0] == "Epilepsy");
        Assert.DoesNotContain(table.Rows, row => row[0] == "Diabetes");
    }

    [Fact]
    public void AdlAssessmentsTable_IncludesHowToHelpColumn_OnlyWhenCommunityAccessStreamSet()
    {
        var withoutStream = BuildParticipant(ServiceStreams.None);
        var withoutModel = ParticipantDocumentComposer.ComposeParticipantProfile(withoutStream, BuildRiskEntries(withoutStream.Id));
        var withoutAdl = withoutModel.Sections.Single(s => s.Heading == "Daily Living").Tables.Single(t => t.Heading == "ADL Assessments");
        Assert.DoesNotContain("How To Help", withoutAdl.Columns);

        var withStream = BuildParticipant(ServiceStreams.CommunityAccessDailyLiving);
        var withModel = ParticipantDocumentComposer.ComposeParticipantProfile(withStream, BuildRiskEntries(withStream.Id));
        var withAdl = withModel.Sections.Single(s => s.Heading == "Daily Living").Tables.Single(t => t.Heading == "ADL Assessments");
        Assert.Contains("How To Help", withAdl.Columns);
    }

    [Fact]
    public void AdlAssessmentsTable_MaterializesEveryAdlType_FixedOrder()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var table = model.Sections.Single(s => s.Heading == "Daily Living").Tables.Single(t => t.Heading == "ADL Assessments");
        Assert.Equal(Enum.GetValues<AdlType>().Length, table.Rows.Count);
        // Fixed order: Personal ADLs first (Dressing is first), then Community/Domestic.
        Assert.Equal("Dressing", table.Rows[0][0]);
    }

    [Fact]
    public void ChecklistItemsTable_OnlyIncludesAnsweredRows()
    {
        var participant = BuildParticipant(ServiceStreams.CommunityAccessDailyLiving);
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var caSection = model.Sections.Single(s => s.Heading == "Community Access");
        var table = caSection.Tables.Single(t => t.Heading == "Checklist Items");
        Assert.Single(table.Rows);
        Assert.Contains(table.Rows, row => row[0] == "Uses Wheelchair");
    }

    [Fact]
    public void RiskEntriesTable_OnlyIncludesActiveRows()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var table = model.Sections.Single(s => s.Heading == "Risks & Hazards").Tables.Single(t => t.Heading == "Risk Entries");
        Assert.Single(table.Rows);
        Assert.Contains(table.Rows, row => row[1] == "Falls risk on stairs");
    }

    [Fact]
    public void EmptyScalarValue_RendersAsEmDash()
    {
        var participant = BuildParticipant();
        participant.MedicalSummary = null;
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var medical = model.Sections.Single(s => s.Heading == "Medical");
        var field = medical.Fields.Single(f => f.Label == "Medical Summary");
        Assert.Equal("—", field.Value);
    }

    [Fact]
    public void FlagsEnumField_RendersCommaJoinedSetValues()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));

        var medical = model.Sections.Single(s => s.Heading == "Medical");
        var field = medical.Fields.Single(f => f.Label == "HIDPA Support Categories");
        Assert.Contains("Epilepsy Management", field.Value);
        Assert.Contains("Enteral Feeding", field.Value);
    }

    [Fact]
    public void ContactsTable_IncludesEveryRow_OnBothDocuments()
    {
        var participant = BuildParticipant();

        var intake = ParticipantDocumentComposer.ComposeIntakeForm(participant, BuildRiskEntries(participant.Id));
        var intakeContacts = intake.Sections.Single(s => s.Heading == "Contacts").Tables.Single(t => t.Heading == "Contacts");
        Assert.Single(intakeContacts.Rows);
        Assert.Equal("Nora Kin", intakeContacts.Rows[0][1]);

        var profile = ParticipantDocumentComposer.ComposeParticipantProfile(participant, BuildRiskEntries(participant.Id));
        var profileContacts = profile.Sections.Single(s => s.Heading == "Contacts").Tables.Single(t => t.Heading == "Contacts");
        Assert.Single(profileContacts.Rows);
    }

    // ── PF-10.6 — Client Overview ────────────────────────────────────────────────────────

    private static TripInstance BuildTrip(string groupName = "Group A") => new()
    {
        Id = Guid.NewGuid(),
        TripName = "Spring Coastal Trip",
        StartDate = new DateOnly(2026, 10, 12),
        DefaultActivityGroup = new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP-A", DisplayName = groupName },
    };

    /// <summary>
    /// The exact, fixed field list per SPEC-05 PF-10.6 — asserting the full label set (not just
    /// "contains") means an accidental future addition/removal of a field is caught here, which is
    /// the closest a composer-level test can get to "every field it renders is sourced from an
    /// existing Participant/RestrictivePractice property, not a new writable field": every label
    /// below is produced via FormatParticipantProperty's reflection lookup against Participant,
    /// which throws if the referenced property doesn't exist — so this test passing at all already
    /// proves every scalar field resolves to a real, pre-existing Participant property.
    /// </summary>
    [Fact]
    public void ComposeClientOverview_RendersFixedFieldList()
    {
        var participant = BuildParticipant();
        var model = ParticipantDocumentComposer.ComposeClientOverview(participant, BuildTrip());

        var section = Assert.Single(model.Sections);
        Assert.Equal("Client Support Needs Summary", section.Heading);
        Assert.Equal(
            new[]
            {
                "Personal Care", "Night Support", "Night Support Ratio", "Modified Diet",
                "Thickened Fluids / Choking Risk", "Medication Approach",
                "Behaviours of Concern (Current)", "Behaviour Risk Rating", "Health Conditions Alerts",
            },
            section.Fields.Select(f => f.Label).ToArray());
    }

    [Fact]
    public void ComposeClientOverview_WithTrip_PopulatesTripHeaderFields()
    {
        var participant = BuildParticipant();
        var trip = BuildTrip("Coastal Explorers");

        var model = ParticipantDocumentComposer.ComposeClientOverview(participant, trip);

        Assert.Equal("Spring Coastal Trip", model.TripName);
        Assert.Equal("12 Oct 2026", model.TripDate);
        Assert.Equal("Coastal Explorers", model.TripGroup);
    }

    /// <summary>Acceptance: generating with no trip context (Participant-detail-page surface) must not throw, and header fields render blank, not omitted.</summary>
    [Fact]
    public void ComposeClientOverview_WithoutTrip_HeaderFieldsAreBlankPlaceholder_NoException()
    {
        var participant = BuildParticipant();

        var model = ParticipantDocumentComposer.ComposeClientOverview(participant, trip: null);

        Assert.Equal("—", model.TripName);
        Assert.Equal("—", model.TripDate);
        Assert.Equal("—", model.TripGroup);
    }

    [Fact]
    public void ComposeClientOverview_RestrictivePracticeTable_OmittedWhenNoActiveEntries()
    {
        var participant = BuildParticipant();
        participant.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.Seclusion,
            Description = "Retired practice", IsActive = false,
        });

        var model = ParticipantDocumentComposer.ComposeClientOverview(participant, BuildTrip());

        var section = Assert.Single(model.Sections);
        Assert.Empty(section.Tables);
    }

    [Fact]
    public void ComposeClientOverview_RestrictivePracticeTable_IncludesOnlyActiveEntries()
    {
        var participant = BuildParticipant();
        participant.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.ChemicalRestraint,
            Description = "PRN sedative on outings", AuthorisedBy = "Dr Lee", IsActive = true,
        });
        participant.RestrictivePractices.Add(new RestrictivePractice
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, Type = RestrictivePracticeType.MechanicalRestraint,
            Description = "Retired practice", IsActive = false,
        });

        var model = ParticipantDocumentComposer.ComposeClientOverview(participant, BuildTrip());

        var section = Assert.Single(model.Sections);
        var table = Assert.Single(section.Tables);
        Assert.Equal("Restrictive Practices (Active)", table.Heading);
        var row = Assert.Single(table.Rows);
        Assert.Equal("Chemical Restraint", row[0]);
        Assert.Equal("PRN sedative on outings", row[1]);
        Assert.Equal("Dr Lee", row[2]);
    }
}
