using System.Text.Json;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Caregiver;

/// <summary>
/// The projection the caregiver page opens with, written by <see cref="CaregiverFieldPolicy.BuildProjection"/> and nothing else, for the frontend's caregiver tests to read. The page's tests used to
/// build their projections by hand, and a hand-made one holds what its author believed the API sends: text and yes/no values the step checks accept, with no enum in it. The real one sends null for a
/// blank text, true/false for a yes/no answer and every enum (HIDPA categories, service streams, ambulant status, consent types) by name, and the page threw on it twice (review of fix PR B: N1, N5).
///
/// The test builds a fully populated participant (every row of the fixed lists, two flags in each flags enum), takes its projection and compares it with
/// <c>frontend/src/test/fixtures/golden/caregiver-projection.json</c>. If the API changes what it sends, this fails and says how to rewrite the file; the frontend's tests then run against the new
/// projection. Regenerate: <c>ODIP_REGENERATE_GOLDEN=1 dotnet test --filter CaregiverProjectionFixtureTests</c>, then run the frontend tests. A build that has no frontend beside the backend (the backend
/// image) skips it. Same arrangement as <c>PlanQuoteFrontendFixtureTests</c>.
/// </summary>
public class CaregiverProjectionFixtureTests
{
    private const string RegenerateVariable = "ODIP_REGENERATE_GOLDEN";
    private const string FileName = "caregiver-projection.json";
    private static readonly Guid ParticipantId = new("11111111-1111-1111-1111-111111111111");

    private static string? FixtureDirectory()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        if (dir is null) return null;
        var frontend = Path.GetFullPath(Path.Combine(dir, "..", "frontend", "src", "test", "fixtures"));
        return Directory.Exists(frontend) ? Path.Combine(frontend, "golden") : null;
    }

    /// <summary>Every list is the fixed set the API always sends, with a mix of answered and unanswered rows. The kept-only-when rules the wizard applies (a signature only when granted, a severity only when the
    /// condition is held, a note only when a level is set) are respected, as the stored data does.</summary>
    private static ParticipantDetailDto Populated()
    {
        var consents = Enum.GetValues<ConsentType>().Select((type, i) => new ParticipantConsentDto
        {
            ParticipantId = ParticipantId, ConsentType = type, Granted = i % 3 == 0 ? true : i % 3 == 1 ? false : null,
            SignedByName = i % 3 == 0 ? "Jane Brown" : null, SignedDate = i % 3 == 0 ? new DateOnly(2026, 8, 1) : null,
        }).ToList();
        var conditions = Enum.GetValues<HealthConditionType>().Select((type, i) => new ParticipantHealthConditionDto
        {
            ParticipantId = ParticipantId, ConditionType = type, Has = i % 3 == 0 ? true : i % 3 == 1 ? false : null,
            Severity = i % 3 == 0 ? "Moderate" : null, PlanProvided = i % 3 == 0 ? true : null, TrainingRequired = i % 3 == 0 ? false : null, Notes = i % 3 == 0 ? "Seizure plan on file" : null,
        }).ToList();
        var adls = Enum.GetValues<AdlType>().Select((type, i) => new ParticipantAdlAssessmentDto
        {
            ParticipantId = ParticipantId, AdlType = type, Level = i % 2 == 0 ? Enum.GetValues<AdlLevel>()[i % Enum.GetValues<AdlLevel>().Length] : null,
            Notes = i % 2 == 0 ? "Needs prompting" : null, HowToHelpNotes = i % 2 == 0 ? "Stay close" : null,
        }).ToList();
        var checklist = Enum.GetValues<ChecklistItemType>().Select((type, i) => new ParticipantChecklistItemDto
        {
            ParticipantId = ParticipantId, ItemType = type, Value = i % 2 == 0 ? Enum.GetValues<ChecklistItemValue>()[i % Enum.GetValues<ChecklistItemValue>().Length] : null, Notes = i % 2 == 0 ? "As agreed" : null,
        }).ToList();
        var risks = Enum.GetValues<CommunityAccessRiskItemType>().Select((type, i) => new ParticipantCommunityAccessRiskItemDto
        {
            ParticipantId = ParticipantId, ItemType = type, Rating = i % 2 == 0 ? Enum.GetValues<RiskRatingLevel>()[i % Enum.GetValues<RiskRatingLevel>().Length] : null, StrategyNotes = i % 2 == 0 ? "Plan the route" : null,
        }).ToList();

        return new ParticipantDetailDto
        {
            Id = ParticipantId, FirstName = "Sophie", LastName = "Brown", DateOfBirth = new DateOnly(1994, 3, 9), Phone = "0412 345 678",
            ServiceStreams = ServiceStreams.STA | ServiceStreams.Trip,
            HidpaSupportCategories = HidpaSupportCategory.ComplexBowelCare | HidpaSupportCategory.EnteralFeeding,
            PrimaryDiagnosis = "Autism", OtherDiagnoses = new() { "Epilepsy" }, MedicalSummary = "Well managed",
            MobilitySupportOptions = new() { "Wheelchair" }, AmbulantStatus = AmbulantStatus.Frame, FallsRiskRating = RiskRatingLevel.Medium, LevelOfPersonalCare = PersonalCareLevel.OnePerson,
            UnevenGroundFlag = true, Orthotics = "Left ankle brace",
            MedicareNumber = "2123 45670 1", MedicareExpiry = new DateOnly(2027, 3, 1), WeightKg = 72.5m, HeightCm = 168m,
            IsCald = true, IsLgbtqi = false, ReceivedPrivacyAndConfidentialityInfo = true, PersonalInterests = "Swimming",
            IsAnaphylaxisRisk = true, AllergiesDetail = "Peanuts",
            Memory = MemoryLevel.Fair, MemoryAids = true, ImpairedUnderstanding = false, BehavioursOfConcernCurrent = true, RidsLogged = false, BspPlanProvided = true,
            ExpressiveSkills = "Uses short sentences", Goals = "Learn to swim", LikesDislikes = "Likes music",
            Consents = consents, HealthConditions = conditions, AdlAssessments = adls, ChecklistItems = checklist, CommunityAccessRiskItems = risks,
            CreatedAt = new DateTime(2026, 7, 1, 2, 0, 0), UpdatedAt = new DateTime(2026, 9, 1, 2, 0, 0),
        };
    }

    [SkippableFact]
    public void TheProjectionTheCaregiverPageOpensWith_IsTheFileTheFrontendTestsRead()
    {
        var directory = FixtureDirectory();
        Skip.If(directory is null, "There is no frontend beside the backend here (the backend image): nothing to compare the projection with.");
        var path = Path.Combine(directory!, FileName);
        var actual = CaregiverFieldPolicy.BuildProjection(Populated()).ToJsonString(new JsonSerializerOptions { WriteIndented = true }).Replace("\r\n", "\n") + "\n";

        if (Environment.GetEnvironmentVariable(RegenerateVariable) == "1")
        {
            Directory.CreateDirectory(directory!);
            File.WriteAllText(path, actual);
            return;
        }

        Assert.True(File.Exists(path), $"{FileName} is missing: run once with {RegenerateVariable}=1 to write it.");
        var committed = File.ReadAllText(path).Replace("\r\n", "\n");
        Assert.True(committed == actual, $"The projection is no longer the one frontend/src/test/fixtures/golden/{FileName} holds. If the change is meant, run `{RegenerateVariable}=1 dotnet test --filter CaregiverProjectionFixtureTests` and then the frontend's caregiver tests.");
    }
}
