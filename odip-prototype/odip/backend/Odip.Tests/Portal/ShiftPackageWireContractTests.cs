using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// What the shift package looks like ON THE WIRE, serialised with the API's real JSON policy (<see cref="ApiJsonOptions"/>, which
/// Program.cs applies to every MVC response: string enums and <c>DefaultIgnoreCondition = WhenWritingNull</c>).
///
/// The contract promises that absence is explicit - "Not recorded" is a null the client can see, e.g. an anaphylaxis risk that is
/// <c>null</c> (not recorded) rather than <c>false</c> (recorded as no risk). Under the global WhenWritingNull a null member is DROPPED
/// from the JSON unless its property opts out with <c>[JsonIgnore(Condition = Never)]</c>, so the key would be missing and a client
/// testing <c>=== null</c> would get <c>undefined</c>. The earlier tests serialised with hand-built options that did not include that
/// policy, which is how the drift went unseen.
/// </summary>
public class ShiftPackageWireContractTests
{
    /// <summary>MVC's web defaults (camelCase) plus the API's own policy - the options the formatter really uses.</summary>
    private static readonly JsonSerializerOptions Wire = ProductionOptions();

    private static JsonSerializerOptions ProductionOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        return options;
    }

    private static JsonElement ToWire<T>(T value) => JsonSerializer.SerializeToElement(value, Wire);

    /// <summary>The key must be PRESENT and its value JSON null.</summary>
    private static void AssertExplicitNull(JsonElement owner, string name, string where)
    {
        Assert.True(owner.TryGetProperty(name, out var value), $"'{name}' is missing from {where}: a null must be written as an explicit null, not omitted.");
        Assert.Equal(JsonValueKind.Null, value.ValueKind);
    }

    private static void AssertExplicitNulls(JsonElement owner, string where, params string[] names)
    {
        foreach (var name in names) AssertExplicitNull(owner, name, where);
    }

    private static ParticipantMedication AddMed(
        ShiftPackageFixture f, string name, string? times, MedicationType type = MedicationType.Regular, string? strength = null)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = name, Strength = strength, DoseDescription = "1 tablet",
            Type = type, TimesOfDay = times, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    /// <summary>A shift with as little recorded as possible, so every "not recorded" null is exercised.</summary>
    private static async Task<ShiftPackageFixture> BareShiftWithEverythingNotRecordedAsync()
    {
        var f = Create();
        AddMed(f, "Levetiracetam", "09:00");
        AddMed(f, "Paracetamol", null, MedicationType.Prn);
        var person = new Person { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = "Sam", LastName = "Contact" };
        f.Db.People.Add(person);
        f.Db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, PersonId = person.Id,
            RoleType = ContactRoleType.EmergencyContact, Status = ContactRoleStatus.Active,
        });
        f.Db.ParticipantRoutines.Add(new ParticipantRoutine
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Title = "No nuts", Description = "Never.",
            IsCritical = true, IsActive = true,
        });
        f.Db.SaveChanges();
        await f.Controller.StartBreak(f.Shift.Id, default);   // a running break: endedAt / editedAt null, and a BREAK_RUNNING blocker
        return f;
    }

    [Fact]
    public async Task ANotRecordedShiftPackage_WritesEveryNullAsAnExplicitNull()
    {
        var f = await BareShiftWithEverythingNotRecordedAsync();

        var data = ToWire(ApiResponse<PortalShiftDetailDto>.Ok(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)))).GetProperty("data");

        AssertExplicitNulls(data, "the shift detail", "handover", "canRecordDosesReason", "canRecordDosesReasonCode");

        var glance = data.GetProperty("atAGlance");
        // The safety tri-state: null means NOT RECORDED, false means recorded as no risk. The key must exist for the client to tell.
        AssertExplicitNulls(glance.GetProperty("allergies"), "atAGlance.allergies", "detail", "isAnaphylaxisRisk", "managementNotes");
        AssertExplicitNulls(glance.GetProperty("diet"), "atAGlance.diet",
            "chokingRiskDetail", "pegRegimeDetail", "modifiedDietDetail", "mealAssistanceDetail", "medicationTricks");
        AssertExplicitNulls(glance.GetProperty("communication"), "atAGlance.communication", "expressiveSkills", "receptiveSkills", "readingAbility", "aids");
        AssertExplicitNulls(glance.GetProperty("behaviour"), "atAGlance.behaviour",
            "triggers", "earlyWarningSigns", "deEscalationStrategies", "whatNotToDo", "whatHelpsMeCalmDown");
        AssertExplicitNulls(glance.GetProperty("address"), "atAGlance.address", "street", "suburb", "state", "postcode");

        AssertExplicitNulls(data.GetProperty("emergencyContacts")[0], "emergencyContacts[0]", "relationship", "phone", "mobile", "priorityOrder");

        var slot = data.GetProperty("medicationsDue")[0];
        AssertExplicitNulls(slot, "medicationsDue[0]", "strength", "directions", "outcome");
        AssertExplicitNulls(slot.GetProperty("witness"), "medicationsDue[0].witness", "status", "witnessName", "requestedAt", "respondedAt");

        AssertExplicitNulls(data.GetProperty("prn")[0], "prn[0]",
            "strength", "directions", "indication", "maxDosesPer24h", "minIntervalMinutes", "lastDoseAt", "nextAvailableAt", "outcomePendingAdministrationId");

        AssertExplicitNulls(data.GetProperty("shiftRoutines")[0], "shiftRoutines[0]", "startTime", "endTime", "occursAt");

        AssertExplicitNulls(data.GetProperty("breaks")[0], "breaks[0]", "endedAt", "editedAt");

        // A BREAK_RUNNING blocker has no medication: the client tells it from a dose blocker by `medicationId === null`.
        var breakBlocker = data.GetProperty("finishBlockers").EnumerateArray().Single(b => b.GetProperty("code").GetString() == "BREAK_RUNNING");
        AssertExplicitNulls(breakBlocker, "finishBlockers[BREAK_RUNNING]", "medicationId", "medicationName", "scheduledAt");

        AssertExplicitNull(data.GetProperty("completion"), "handoverText", "completion");
    }

    [Fact]
    public async Task ADoseOutcomeThatHasNothingToSay_KeepsItsNullsToo()
    {
        // A recorded dose: the outcome exists, but its reason / dose text / notes / timezone may be null.
        var f = Create();
        var med = AddMed(f, "Levetiracetam", "09:00");
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
            ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0), Status = MedicationAdministrationStatus.Missed, RecordedByName = "Ben Turner",
        });
        f.Db.SaveChanges();

        var data = ToWire(ApiResponse<PortalShiftDetailDto>.Ok(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)))).GetProperty("data");

        var outcome = data.GetProperty("medicationsDue")[0].GetProperty("outcome");
        AssertExplicitNulls(outcome, "medicationsDue[0].outcome", "administeredAt", "administeredAtTimeZone", "reason", "doseGiven", "notes");
    }

    [Fact]
    public async Task TheHandoverAnAcknowledgementWaitsOn_KeepsItsNullTextAndReadAt()
    {
        var f = Create(ShiftStatus.Published);
        var previous = f.AddWorker("Previous", "Worker");
        var earlier = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, UserId = previous.Id, ServiceDate = ServiceDate.AddDays(-1),
            StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.PendingReview,
        };
        f.Db.Shifts.Add(earlier);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = earlier.Id, ActualStart = ActualStartUtc.AddDays(-1), ActualEnd = ActualStartUtc.AddDays(-1).AddHours(8),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = previous.Id, StartedAt = ActualStartUtc.AddDays(-1), SubmittedAt = ActualStartUtc.AddDays(-1).AddHours(8),
            IsActive = true, NothingToHandOver = true,
        });
        f.Db.SaveChanges();

        var data = ToWire(ApiResponse<PortalShiftDetailDto>.Ok(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)))).GetProperty("data");

        var handover = data.GetProperty("handover");
        AssertExplicitNulls(handover, "handover", "text", "readAt");
        Assert.True(handover.GetProperty("nothingToHandOver").GetBoolean());
    }

    [Fact]
    public async Task AWithheldShift_WritesTheWithheldMembersAsExplicitNulls_AndTheReasonAsText()
    {
        var f = Create(ShiftStatus.Completed);

        var data = ToWire(ApiResponse<PortalShiftDetailDto>.Ok(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)))).GetProperty("data");

        AssertExplicitNulls(data, "the withheld shift detail", "handover", "emergencyContacts");
        AssertExplicitNull(data.GetProperty("atAGlance"), "address", "atAGlance");
        Assert.Equal(JsonValueKind.Array, data.GetProperty("handoverTrail").ValueKind);
        Assert.Equal(0, data.GetProperty("handoverTrail").GetArrayLength());
        Assert.Contains("This shift is completed", data.GetProperty("sensitiveInfoWithheldReason").GetString());
    }

    [Fact]
    public async Task AShiftThatShowsEverything_WritesTheReasonAsAnExplicitNull()
    {
        var f = Create(ShiftStatus.Published);

        var data = ToWire(ApiResponse<PortalShiftDetailDto>.Ok(Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)))).GetProperty("data");

        AssertExplicitNull(data, "sensitiveInfoWithheldReason", "the shift detail");
        Assert.Equal(JsonValueKind.Array, data.GetProperty("emergencyContacts").ValueKind);   // an empty list, NOT null: there simply are none
        Assert.Equal(JsonValueKind.Object, data.GetProperty("atAGlance").GetProperty("address").ValueKind);
    }

    [Fact]
    public async Task TheFinishBlocked422_CarriesTheSameExplicitNulls_InsideItsEnvelope()
    {
        var f = await BareShiftWithEverythingNotRecordedAsync();
        f.Db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftId = f.Shift.Id, AuthorUserId = f.Worker.Id, AuthorName = "Ben", Body = "ok" });
        f.Db.SaveChanges();

        var blocked = Failure(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default), 422);
        var json = ToWire(blocked);

        Assert.False(json.GetProperty("success").GetBoolean());
        Assert.Equal("SHIFT_FINISH_BLOCKED", json.GetProperty("code").GetString());
        var blocker = json.GetProperty("data").GetProperty("finishBlockers").EnumerateArray().Single(b => b.GetProperty("code").GetString() == "BREAK_RUNNING");
        AssertExplicitNulls(blocker, "data.finishBlockers[BREAK_RUNNING]", "medicationId", "medicationName", "scheduledAt");
        AssertExplicitNull(json.GetProperty("data"), "handover", "data");
    }

    // ── the guard: nobody can add a nullable member to a shift-package record and forget the contract ──

    private static readonly Type[] NewResponseRecords =
    [
        typeof(PortalAtAGlanceDto), typeof(PortalAllergiesDto), typeof(PortalDietDto), typeof(PortalCommunicationDto), typeof(PortalBehaviourDto),
        typeof(PortalHidpaDto), typeof(PortalAddressDto), typeof(PortalEmergencyContactDto), typeof(PortalDoseSlotDto), typeof(PortalDoseOutcomeDto),
        typeof(PortalDoseWitnessDto), typeof(PortalPrnDto), typeof(PortalShiftRoutineDto), typeof(PortalHandoverDto), typeof(PortalHandoverTrailEntryDto),
        typeof(PortalFinishBlockerDto), typeof(ShiftBreakDto), typeof(ShiftCompletionReviewDto), typeof(ReviewPrnDoseDto),
    ];

    /// <summary>Members added to records that existed before the shift package (whose other nullable members keep their old behaviour).</summary>
    private static readonly Dictionary<Type, string[]> NewMembersOfOlderRecords = new()
    {
        [typeof(PortalShiftDetailDto)] = ["Handover", "CanRecordDosesReason", "CanRecordDosesReasonCode", "EmergencyContacts", "SensitiveInfoWithheldReason"],
        [typeof(ShiftCompletionDto)] = ["HandoverText"],
    };

    private static bool IsNullable(PropertyInfo property) => new NullabilityInfoContext().Create(property).ReadState == NullabilityState.Nullable;

    private static bool WritesNullExplicitly(PropertyInfo property) =>
        property.GetCustomAttribute<JsonIgnoreAttribute>()?.Condition == JsonIgnoreCondition.Never;

    [Fact]
    public void EveryNullableMemberOfTheNewRecords_OptsOutOfTheGlobalWhenWritingNull()
    {
        var offenders = new List<string>();
        foreach (var type in NewResponseRecords)
        {
            foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (IsNullable(property) && !WritesNullExplicitly(property)) offenders.Add($"{type.Name}.{property.Name}");
            }
        }

        Assert.True(offenders.Count == 0,
            "These nullable members would be OMITTED from the JSON when null (the API ignores nulls globally). Mark them "
            + "[property: JsonIgnore(Condition = JsonIgnoreCondition.Never)]: " + string.Join(", ", offenders));
    }

    [Fact]
    public void TheNewMembersOfOlderRecords_AreNullableAndOptOutToo()
    {
        foreach (var (type, names) in NewMembersOfOlderRecords)
        {
            foreach (var name in names)
            {
                var property = type.GetProperty(name) ?? throw new InvalidOperationException($"{type.Name}.{name} does not exist.");
                Assert.True(IsNullable(property), $"{type.Name}.{name} is expected to be nullable.");
                Assert.True(WritesNullExplicitly(property), $"{type.Name}.{name} must opt out of WhenWritingNull so a null is written as an explicit null.");
            }
        }
    }

    [Fact]
    public void ThePolicyUnderTest_IsTheOneTheApiRegisters_WhenWritingNullWithStringEnums()
    {
        // If someone changes the API's JSON policy, this fails loudly and the assertions above are re-examined on purpose.
        Assert.Equal(JsonIgnoreCondition.WhenWritingNull, Wire.DefaultIgnoreCondition);
        Assert.Contains(Wire.Converters, c => c is JsonStringEnumConverter);
        Assert.Equal("\"InProgress\"", JsonSerializer.Serialize(ShiftStatus.InProgress, Wire));
    }
}
