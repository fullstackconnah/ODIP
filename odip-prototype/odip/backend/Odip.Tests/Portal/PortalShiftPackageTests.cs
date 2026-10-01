using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The server-side routine matcher, with the OVERNIGHT gap fixed: the old frontend rule never stretched the routine, so a
/// 02:00 or 06:30 routine could not match a 22:00-06:00 shift and the weekday was the start day's only.
/// </summary>
public class RoutineWindowMatcherTests
{
    private static DateTime L(int day, int h, int m = 0) => new(2026, 7, day, h, m, 0, DateTimeKind.Unspecified);   // 14 July 2026 is a Tuesday

    private static ParticipantRoutine R(
        string title, string? start, string? end, ParticipantRoutineDays days = ParticipantRoutineDays.All,
        bool critical = false, bool active = true) => new()
    {
        Id = Guid.NewGuid(), Title = title, Days = days, IsCritical = critical, IsActive = active,
        StartTime = start is null ? null : TimeOnly.Parse(start), EndTime = end is null ? null : TimeOnly.Parse(end),
    };

    private static List<string> Titles(IEnumerable<ParticipantRoutine> routines, DateTime start, DateTime end) =>
        RoutineWindowMatcher.Match(routines, start, end).Select(o => o.Routine.Title).ToList();

    [Fact]
    public void ADayShift_MatchesRoutinesThatOverlapIt_AndNotOnesOutsideIt()
    {
        var routines = new[] { R("Breakfast", "07:30", "08:30"), R("Lunch", "12:00", "13:00"), R("Dinner", "18:00", "19:00") };

        Assert.Equal(["Breakfast", "Lunch"], Titles(routines, L(14, 8), L(14, 14)));
    }

    [Fact]
    public void AnOvernightShift_MatchesAnAfterMidnightRoutine_TheOldBug()
    {
        // 22:00 Tue -> 06:00 Wed. The 02:00 medication-check routine and the 05:30 wake-up must show up.
        var routines = new[] { R("Evening meds", "21:30", "22:30"), R("Night check", "02:00", "02:30"), R("Wake-up", "05:30", "06:30"), R("Lunch", "12:00", "13:00") };

        var matches = RoutineWindowMatcher.Match(routines, L(14, 22), L(15, 6));

        Assert.Equal(["Evening meds", "Night check", "Wake-up"], matches.Select(m => m.Routine.Title));
        Assert.Equal([false, true, true], matches.Select(m => m.AfterMidnight));
    }

    [Fact]
    public void TheWeekdayIsCheckedPerCalendarDate_TheAfterMidnightPartUsesTheNextDay()
    {
        // A Wednesday-only 02:00 routine belongs to a Tuesday-night shift (its early hours are Wednesday); a Tuesday-only
        // 02:00 routine does not (Tuesday's 02:00 was before the shift began).
        var wednesdayOnly = R("Wed 2am", "02:00", "02:30", ParticipantRoutineDays.Wednesday);
        var tuesdayOnly = R("Tue 2am", "02:00", "02:30", ParticipantRoutineDays.Tuesday);

        Assert.Equal(["Wed 2am"], Titles([wednesdayOnly, tuesdayOnly], L(14, 22), L(15, 6)));
    }

    [Fact]
    public void ARoutineThatItselfCrossesMidnight_IsMatched()
    {
        var routines = new[] { R("Overnight sleep support", "22:00", "06:00") };

        Assert.Equal(["Overnight sleep support"], Titles(routines, L(14, 23), L(15, 1)));
        Assert.Empty(Titles(routines, L(14, 8), L(14, 16)));
    }

    [Fact]
    public void ACrossMidnightRoutineThatStartedTheDayBeforeTheWindow_IsStillMatched()
    {
        // 14 July 2026 is a Tuesday, so a Monday 00:00-08:00 window is 13 July. A Sunday-only 22:00-06:00 routine began on Sunday
        // evening and is still running until 06:00 Monday: it belongs to that shift, clipped to the window start.
        var sundayNight = R("Sunday night support", "22:00", "06:00", ParticipantRoutineDays.Sunday);
        var mondayNight = R("Monday night support", "22:00", "06:00", ParticipantRoutineDays.Monday);

        var matches = RoutineWindowMatcher.Match([sundayNight, mondayNight], L(13, 0), L(13, 8));

        var match = Assert.Single(matches);
        Assert.Equal("Sunday night support", match.Routine.Title);
        Assert.Equal(L(13, 0), match.OccursAtLocal);
        Assert.False(match.AfterMidnight);
    }

    [Fact]
    public void ADayBeforeRoutine_ThatHasAlreadyEnded_IsNotMatched()
    {
        // Sunday 20:00-22:00 ended before Monday began: it does not leak into Monday 00:00-08:00.
        Assert.Empty(Titles([R("Sunday evening", "20:00", "22:00", ParticipantRoutineDays.Sunday)], L(13, 0), L(13, 8)));
    }

    [Fact]
    public void ARoutineAlreadyUnderwayAtTheStart_IsClippedToTheShiftStart()
    {
        var match = RoutineWindowMatcher.Match([R("Morning routine", "06:00", "10:00")], L(14, 8), L(14, 16)).Single();

        Assert.Equal(L(14, 8), match.OccursAtLocal);
        Assert.False(match.AfterMidnight);
    }

    [Fact]
    public void Untimed_OnlyCriticalOnesAreSurfaced_OnAnyDateOfTheWindowTheyApplyOn()
    {
        var critical = R("Allergy: no nuts", null, null, critical: true);
        var notCritical = R("Likes music", null, null);
        var wednesdayCritical = R("Wed only", null, null, ParticipantRoutineDays.Wednesday, critical: true);

        var matches = RoutineWindowMatcher.Match([critical, notCritical, wednesdayCritical], L(14, 22), L(15, 6));

        Assert.Equal(["Allergy: no nuts", "Wed only"], matches.Select(m => m.Routine.Title).Order());
        Assert.All(matches, m => Assert.Null(m.OccursAtLocal));
    }

    [Fact]
    public void InactiveRoutines_AndRoutinesForOtherDays_NeverMatch()
    {
        var routines = new[]
        {
            R("Retired", "09:00", "10:00", active: false),
            R("Fridays", "09:00", "10:00", ParticipantRoutineDays.Friday),
            R("Today", "09:00", "10:00", ParticipantRoutineDays.Tuesday),
        };

        Assert.Equal(["Today"], Titles(routines, L(14, 8), L(14, 16)));
    }

    [Fact]
    public void Ordering_IsCriticalFirst_ThenChronologicalInsideTheWindow_UntimedLast()
    {
        var routines = new[]
        {
            R("02:00 plain", "02:00", "02:30"), R("23:00 plain", "23:00", "23:30"), R("05:00 critical", "05:00", "05:30", critical: true),
            R("Untimed plain-critical", null, null, critical: true), R("22:30 critical", "22:30", "23:00", critical: true),
        };

        var titles = Titles(routines, L(14, 22), L(15, 6));

        // Critical first (22:30, 05:00 chronologically, then the untimed one), then the plain ones 23:00 before 02:00.
        Assert.Equal(["22:30 critical", "05:00 critical", "Untimed plain-critical", "23:00 plain", "02:00 plain"], titles);
    }

    [Fact]
    public void AnEmptyWindow_MatchesNothing() => Assert.Empty(RoutineWindowMatcher.Match([R("x", "09:00", "10:00")], L(14, 9), L(14, 9)));
}

/// <summary>The shift package read model: at a glance, emergency contacts, doses, routines, Medication Competency flag.</summary>
public class PortalShiftPackageTests
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() },
    };

    private static PortalShiftDetailDto Get(ShiftPackageFixture f) =>
        Detail(f.Controller.GetShiftDetail(f.Shift.Id, default).GetAwaiter().GetResult());

    // ══════════════ At a glance (need-to-know) ══════════════

    [Fact]
    public void AtAGlance_CarriesTheCriticalFacts_InFixedGroups()
    {
        var f = Create(ShiftStatus.Published);
        var p = f.Participant;
        p.AllergiesDetail = "Peanuts, shellfish";
        p.IsAnaphylaxisRisk = true;
        p.AllergyManagementNotes = "EpiPen in the red bag.";
        p.ChokingRiskMealDetail = "Cut food into 1cm pieces.";
        p.PegRegimeMealDetail = "Feed at 7am and 7pm.";
        p.ModifiedDietDetail = "Soft and bite-sized.";
        p.MealAssistanceDetail = "Needs set-up and supervision.";
        p.MedicationTricks = "Crush into apple puree.";
        p.ExpressiveSkills = "Uses short phrases.";
        p.ReceptiveSkills = "Understands simple instructions.";
        p.ReadingAbility = "Reads picture cards.";
        p.CommunicationAids = "PECS book.";
        p.BocTriggers = "Loud noises.";
        p.BocEarlyWarningSigns = "Humming, pacing.";
        p.BocDeEscalationStrategies = "Quiet space, headphones.";
        p.BocWhatNotToDo = "Do not touch without asking.";
        p.WhatHelpsMeCalmDown = "Weighted blanket.";
        p.HidpaSupportCategories = HidpaSupportCategory.EpilepsyManagement | HidpaSupportCategory.DysphagiaManagement;
        p.AddressStreet = "12 Wattle St";
        p.AddressSuburb = "Richmond";
        p.AddressState = "VIC";
        p.AddressPostcode = "3121";
        f.Db.SaveChanges();

        var g = Get(f).AtAGlance;

        Assert.Equal("Peanuts, shellfish", g.Allergies.Detail);
        Assert.True(g.Allergies.IsAnaphylaxisRisk);
        Assert.Equal("EpiPen in the red bag.", g.Allergies.ManagementNotes);
        Assert.Equal("Cut food into 1cm pieces.", g.Diet.ChokingRiskDetail);
        Assert.Equal("Feed at 7am and 7pm.", g.Diet.PegRegimeDetail);
        Assert.Equal("Soft and bite-sized.", g.Diet.ModifiedDietDetail);
        Assert.Equal("Needs set-up and supervision.", g.Diet.MealAssistanceDetail);
        Assert.Equal("Crush into apple puree.", g.Diet.MedicationTricks);
        Assert.Equal("Uses short phrases.", g.Communication.ExpressiveSkills);
        Assert.Equal("Understands simple instructions.", g.Communication.ReceptiveSkills);
        Assert.Equal("Reads picture cards.", g.Communication.ReadingAbility);
        Assert.Equal("PECS book.", g.Communication.Aids);
        Assert.Equal("Loud noises.", g.Behaviour.Triggers);
        Assert.Equal("Humming, pacing.", g.Behaviour.EarlyWarningSigns);
        Assert.Equal("Quiet space, headphones.", g.Behaviour.DeEscalationStrategies);
        Assert.Equal("Do not touch without asking.", g.Behaviour.WhatNotToDo);
        Assert.Equal("Weighted blanket.", g.Behaviour.WhatHelpsMeCalmDown);
        Assert.True(g.Hidpa.Epilepsy);
        Assert.False(g.Hidpa.EnteralFeeding);
        Assert.True(g.Hidpa.Dysphagia);
        Assert.Equal(new PortalAddressDto("12 Wattle St", "Richmond", "VIC", "3121"), g.Address);
    }

    [Fact]
    public void NotRecordedIsExplicitNull_BlankTextIsNotAnEmptyString_AndTheAnaphylaxisFlagStaysTriState()
    {
        var f = Create(ShiftStatus.Published);
        f.Participant.AllergiesDetail = "   ";           // whitespace = not recorded
        f.Participant.ChokingRiskMealDetail = "";
        f.Participant.IsAnaphylaxisRisk = null;
        f.Db.SaveChanges();

        var g = Get(f).AtAGlance;

        Assert.Null(g.Allergies.Detail);
        Assert.Null(g.Allergies.IsAnaphylaxisRisk);       // never coerced to false: null means "not recorded"
        Assert.Null(g.Diet.ChokingRiskDetail);
        Assert.Null(g.Communication.Aids);
        Assert.Null(g.Behaviour.WhatNotToDo);
        Assert.Equal(new PortalAddressDto(null, null, null, null), g.Address);
        Assert.False(g.Hidpa.Epilepsy);
    }

    [Fact]
    public void AnaphylaxisRecordedAsNo_IsFalse_NotNull()
    {
        var f = Create(ShiftStatus.Published);
        f.Participant.IsAnaphylaxisRisk = false;
        f.Db.SaveChanges();

        Assert.False(Get(f).AtAGlance.Allergies.IsAnaphylaxisRisk);
    }

    [Fact]
    public void TheNeedToKnowRule_NdisNumberPlanFundingAndFullDiagnosesNeverLeaveTheServer()
    {
        var f = Create(ShiftStatus.Published);
        var p = f.Participant;
        p.NdisNumber = "431234567";
        p.PlanType = PlanType.PlanManaged;
        p.PlanStartDate = new DateOnly(2026, 1, 1);
        p.PlanEndDate = new DateOnly(2026, 12, 31);
        p.FundingSource = ParticipantFundingSource.Other;
        p.FundingOrganisation = "Acme Funding Body";
        p.PrimaryDiagnosis = "Cerebral palsy";
        p.OtherDiagnoses = ["Epilepsy (focal)", "Scoliosis"];
        p.AllergiesDetail = "Latex";   // present so the at-a-glance group is non-trivial
        f.Db.SaveChanges();

        var json = JsonSerializer.Serialize(Get(f), Json);

        foreach (var secret in new[] { "431234567", "Acme Funding Body", "Cerebral palsy", "Epilepsy (focal)", "Scoliosis" })
            Assert.DoesNotContain(secret, json);
        foreach (var propertyFragment in new[] { "\"ndis", "\"planType", "\"planStart", "\"planEnd", "\"funding", "\"primaryDiagnosis", "\"otherDiagnoses", "\"diagnos" })
            Assert.DoesNotContain(propertyFragment, json, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Latex", json);
    }

    // ══════════════ Emergency contacts ══════════════

    private static Person AddContact(
        ShiftPackageFixture f, string first, string last, ContactRoleType role = ContactRoleType.EmergencyContact, int? priority = null,
        bool primary = false, string? relationship = "Mother", string? phone = "03 5555 0101", string? mobile = "0400 000 111",
        ContactRoleStatus status = ContactRoleStatus.Active, DateOnly? endDate = null, Guid? participantId = null)
    {
        var person = new Person { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = first, LastName = last, Phone = phone, Mobile = mobile };
        f.Db.People.Add(person);
        f.Db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = participantId ?? f.Participant.Id, PersonId = person.Id, RoleType = role,
            RelationshipToParticipant = relationship, PriorityOrder = priority, IsPrimary = primary, Status = status, EndDate = endDate,
        });
        f.Db.SaveChanges();
        return person;
    }

    [Fact]
    public void EmergencyContacts_AreOrderedByPriority_ThenPrimary_ThenName_WithUnrankedLast()
    {
        var f = Create(ShiftStatus.Published);
        AddContact(f, "Zed", "Unranked");
        AddContact(f, "Second", "Call", priority: 2);
        AddContact(f, "Yan", "PrimaryUnranked", primary: true);
        AddContact(f, "First", "Call", priority: 1);

        var contacts = Get(f).EmergencyContacts;

        Assert.Equal(["First Call", "Second Call", "Yan PrimaryUnranked", "Zed Unranked"], contacts.Select(c => c.Name));
        Assert.Equal([1, 2, null, null], contacts.Select(c => c.PriorityOrder));
        Assert.Equal("03 5555 0101", contacts[0].Phone);
        Assert.Equal("0400 000 111", contacts[0].Mobile);
        Assert.Equal("Mother", contacts[0].Relationship);
        Assert.True(contacts[2].IsPrimary);
    }

    [Fact]
    public void EmergencyContacts_OnlyActiveUnendedEmergencyRolesOfThisParticipant()
    {
        var f = Create(ShiftStatus.Published);
        AddContact(f, "Keep", "Me", priority: 1);
        AddContact(f, "Next", "OfKin", role: ContactRoleType.NextOfKin);                                   // a different role
        AddContact(f, "Expired", "Role", status: ContactRoleStatus.Expired);
        AddContact(f, "Ended", "Yesterday", endDate: new DateOnly(2026, 7, 13));                            // provider-local today is 14 July
        AddContact(f, "EndsToday", "Still", endDate: new DateOnly(2026, 7, 14), priority: 2);               // last day still counts
        var other = new Participant { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, FirstName = "Mia", LastName = "Chen", IsActive = true };
        f.Db.Participants.Add(other);
        f.Db.SaveChanges();
        AddContact(f, "Someone", "Else", participantId: other.Id);                                          // another participant

        Assert.Equal(["Keep Me", "EndsToday Still"], Get(f).EmergencyContacts.Select(c => c.Name));
    }

    [Fact]
    public void EmergencyContacts_BlankPhoneAndRelationshipAreNull_NotEmptyStrings()
    {
        var f = Create(ShiftStatus.Published);
        AddContact(f, "No", "Numbers", relationship: " ", phone: "", mobile: null);

        var c = Assert.Single(Get(f).EmergencyContacts);

        Assert.Null(c.Relationship);
        Assert.Null(c.Phone);
        Assert.Null(c.Mobile);
    }

    [Fact]
    public void EmergencyContacts_OfAnotherTenant_AreNeverReturned_ToANonSuperAdminCaller()
    {
        // Seam test: a contact role owned by another tenant, even one pointing at this participant, must not surface.
        var tenantA = Guid.NewGuid();
        var f = Create(ShiftStatus.Published, tenantId: tenantA);
        AddContact(f, "Mine", "Contact", priority: 1);
        var foreign = new Person { Id = Guid.NewGuid(), TenantId = Guid.NewGuid(), FirstName = "Tenant", LastName = "B", Phone = "1" };
        f.Db.People.Add(foreign);
        f.Db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), TenantId = foreign.TenantId, ParticipantId = f.Participant.Id, PersonId = foreign.Id,
            RoleType = ContactRoleType.EmergencyContact, Status = ContactRoleStatus.Active,
        });
        f.Db.SaveChanges();

        Assert.Equal(["Mine Contact"], Get(f).EmergencyContacts.Select(c => c.Name));
    }

    // ══════════════ Doses due in the window ══════════════

    private static ParticipantMedication AddMed(
        ShiftPackageFixture f, string name, string? times, MedicationType type = MedicationType.Regular, string? strength = "500mg",
        bool highRisk = false, MedicationStatus status = MedicationStatus.Active, string? directions = null)
    {
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = name, Strength = strength, DoseDescription = "1 tablet",
            Directions = directions, Form = MedicationForm.Tablet, Route = MedicationRoute.Oral, Type = type, TimesOfDay = times, IsHighRisk = highRisk,
            StartDate = new DateTime(2026, 1, 1), Status = status, SupportLevel = MedicationSupportLevel.Administer,
            PrnIndication = type == MedicationType.Prn ? "Pain" : null, PrnMaxDosesPer24h = type == MedicationType.Prn ? 2 : null,
            PrnMinIntervalMinutes = type == MedicationType.Prn ? 240 : null,
        };
        f.Db.ParticipantMedications.Add(med);
        f.Db.SaveChanges();
        return med;
    }

    [Fact]
    public void MedicationsDue_ListsTheWindowsSlots_InTimeOrder_WithLocalOverdueState()
    {
        // Clock = 11:00 local. 09:00 -> 120 min late (overdue), 10:30 -> 30 min late (due, in grace), 12:30 future (due).
        var f = Create();
        AddMed(f, "Levetiracetam", "12:30,09:00,10:30", directions: "With food");

        var slots = Get(f).MedicationsDue;

        Assert.Equal(["09:00", "10:30", "12:30"], slots.Select(s => s.ScheduledTime));
        Assert.Equal([PortalDoseState.Overdue, PortalDoseState.Due, PortalDoseState.Due], slots.Select(s => s.State));
        Assert.Equal([true, false, false], slots.Select(s => s.IsOverdue));
        var first = slots[0];
        Assert.Equal("Levetiracetam", first.MedicationName);
        Assert.Equal("500mg", first.Strength);
        Assert.Equal("1 tablet", first.DoseDescription);
        Assert.Equal(MedicationRoute.Oral, first.Route);
        Assert.Equal("With food", first.Directions);
        Assert.Equal(new DateTime(2026, 7, 14, 9, 0, 0), first.ScheduledAt);
        Assert.Equal(DateTimeKind.Unspecified, first.ScheduledAt.Kind);   // provider-local wall clock: no zone suffix on the wire
        Assert.Null(first.Outcome);
        Assert.False(first.Witness.Required);
        Assert.Null(first.Witness.Status);
    }

    [Fact]
    public void ARecordedSlot_ShowsItsOutcomeAndWitnessState_AndIsNeverOverdue()
    {
        var f = Create();
        var med = AddMed(f, "Insulin", "09:00", highRisk: true);
        var witness = f.AddWorker("Rachel", "Witness");
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
            ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0), Status = MedicationAdministrationStatus.Administered, DoseGiven = "18 units",
            RecordedByName = "Ben Turner", AdministeredAt = new DateTime(2026, 7, 13, 23, 10, 0, DateTimeKind.Utc), AdministeredAtTimeZone = "Australia/Sydney",
            WitnessUserId = witness.Id, WitnessName = "Rachel Witness", WitnessStatus = WitnessStatus.Pending, WitnessRequestedAt = DefaultNow.UtcDateTime,
        });
        f.Db.SaveChanges();

        var slot = Assert.Single(Get(f).MedicationsDue);

        Assert.Equal(PortalDoseState.Recorded, slot.State);
        Assert.False(slot.IsOverdue);
        Assert.Equal(MedicationAdministrationStatus.Administered, slot.Outcome!.Status);
        Assert.Equal("18 units", slot.Outcome.DoseGiven);
        Assert.Equal("Ben Turner", slot.Outcome.RecordedByName);
        Assert.Equal("Australia/Sydney", slot.Outcome.AdministeredAtTimeZone);
        Assert.True(slot.Witness.Required);
        Assert.Equal(WitnessStatus.Pending, slot.Witness.Status);
        Assert.Equal("Rachel Witness", slot.Witness.WitnessName);
    }

    [Fact]
    public void AnOvernightShift_ListsSlotsOnBothDates()
    {
        var f = Create(endsNextDay: true, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0));
        AddMed(f, "Melatonin", "21:00,23:00,02:00,07:00");

        var slots = Get(f).MedicationsDue;

        Assert.Equal([new DateTime(2026, 7, 14, 23, 0, 0), new DateTime(2026, 7, 15, 2, 0, 0)], slots.Select(s => s.ScheduledAt));
    }

    [Fact]
    public void InactiveMedications_AreNotListed_AndPrnHasNoSlots()
    {
        var f = Create();
        AddMed(f, "OnHold", "09:00", status: MedicationStatus.OnHold);
        AddMed(f, "Ceased", "09:00", status: MedicationStatus.Ceased);
        AddMed(f, "Paracetamol", null, type: MedicationType.Prn);

        var detail = Get(f);

        Assert.Empty(detail.MedicationsDue);
        Assert.Equal("Paracetamol", Assert.Single(detail.Prn).MedicationName);
    }

    [Fact]
    public void Prn_CarriesIndicationLimitsAndTheRollingPicture()
    {
        var f = Create();
        var prn = AddMed(f, "Paracetamol", null, type: MedicationType.Prn);
        // Two doses inside 24h (max 2 reached); the last 90 minutes ago, minimum interval 240 minutes.
        foreach (var minutesAgo in new[] { 90, 400 })
            f.Db.MedicationAdministrations.Add(new MedicationAdministration
            {
                Id = Guid.NewGuid(), TenantId = prn.TenantId, ParticipantMedicationId = prn.Id, ParticipantId = prn.ParticipantId,
                Status = MedicationAdministrationStatus.Administered, RecordedByName = "x", PrnReason = "Headache",
                AdministeredAt = DefaultNow.UtcDateTime.AddMinutes(-minutesAgo), PrnOutcome = minutesAgo == 400 ? "Effective" : null,
            });
        f.Db.SaveChanges();

        var dto = Assert.Single(Get(f).Prn);

        Assert.Equal("Pain", dto.Indication);
        Assert.Equal(2, dto.MaxDosesPer24h);
        Assert.Equal(240, dto.MinIntervalMinutes);
        Assert.Equal(2, dto.DosesInLast24h);
        Assert.True(dto.MaxDosesReached);
        Assert.Equal(DefaultNow.UtcDateTime.AddMinutes(-90), dto.LastDoseAt);
        Assert.Equal(DefaultNow.UtcDateTime.AddMinutes(150), dto.NextAvailableAt);   // 90 minutes ago + 240
        Assert.NotNull(dto.OutcomePendingAdministrationId);
    }

    [Fact]
    public void Prn_WithNoDosesAndNoInterval_IsAvailableNow()
    {
        var f = Create();
        AddMed(f, "Paracetamol", null, type: MedicationType.Prn);

        var dto = Assert.Single(Get(f).Prn);

        Assert.False(dto.MaxDosesReached);
        Assert.Null(dto.NextAvailableAt);
        Assert.Null(dto.LastDoseAt);
    }

    [Fact]
    public void TheDetailCarriesTheProvidersTimeZone()
    {
        Assert.Equal("Australia/Sydney", Get(Create(ShiftStatus.Published)).TimeZoneId);
    }

    // ══════════════ Timestamps on the wire ══════════════

    [Fact]
    public void Instants_AlwaysCarryAZone_WhileProviderLocalWallClockTimesNeverDo()
    {
        // Values read back from Postgres have Kind Unspecified (the legacy timestamp behaviour persists Kind verbatim), which
        // would serialise with NO zone suffix - indistinguishable from a provider-local wall-clock time. The package DTOs mark
        // every instant as UTC; the wall-clock fields (dose scheduledAt) stay suffix-free.
        static DateTime Unspecified(DateTime utc) => DateTime.SpecifyKind(utc, DateTimeKind.Unspecified);
        var f = Create();
        var med = AddMed(f, "Levetiracetam", "09:00");
        f.Db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ParticipantMedicationId = med.Id, ParticipantId = med.ParticipantId,
            ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0), Status = MedicationAdministrationStatus.Administered, RecordedByName = "Ben",
            AdministeredAt = Unspecified(new DateTime(2026, 7, 13, 23, 10, 0, DateTimeKind.Utc)), CreatedAt = Unspecified(new DateTime(2026, 7, 13, 23, 11, 0, DateTimeKind.Utc)),
        });
        f.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), TenantId = med.TenantId, ShiftCompletionId = f.Completion!.Id, CreatedByUserId = f.Worker.Id,
            StartedAt = Unspecified(new DateTime(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc)), EndedAt = Unspecified(new DateTime(2026, 7, 14, 0, 20, 0, DateTimeKind.Utc)),
        });
        f.Db.SaveChanges();

        var json = JsonSerializer.Serialize(Get(f), Json);

        Assert.Matches("\"startedAt\":\"2026-07-14T00:00:00Z\"", json);
        Assert.Matches("\"endedAt\":\"2026-07-14T00:20:00Z\"", json);
        Assert.Matches("\"administeredAt\":\"2026-07-13T23:10:00Z\"", json);
        Assert.Matches("\"recordedAt\":\"2026-07-13T23:11:00Z\"", json);
        Assert.Matches("\"scheduledAt\":\"2026-07-14T09:00:00\"", json);   // wall clock: no suffix
    }

    // ══════════════ Routines ══════════════

    [Fact]
    public void ShiftRoutines_AreMatchedOnTheServer_OvernightSafe_WhileRoutinesStillCarriesEveryActiveRoutine()
    {
        var f = Create(endsNextDay: true, start: new TimeOnly(22, 0), end: new TimeOnly(6, 0));
        f.Db.ParticipantRoutines.AddRange(
            new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Title = "Night check", StartTime = new TimeOnly(2, 0), EndTime = new TimeOnly(2, 30), Days = ParticipantRoutineDays.All, IsActive = true },
            new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Title = "Lunch", StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(13, 0), Days = ParticipantRoutineDays.All, IsActive = true },
            new ParticipantRoutine { Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Title = "Retired", StartTime = new TimeOnly(2, 0), EndTime = new TimeOnly(3, 0), Days = ParticipantRoutineDays.All, IsActive = false });
        f.Db.SaveChanges();

        var detail = Get(f);

        var night = Assert.Single(detail.ShiftRoutines);
        Assert.Equal("Night check", night.Title);
        Assert.True(night.AfterMidnight);
        Assert.Equal(new DateTime(2026, 7, 15, 2, 0, 0), night.OccursAt);
        Assert.Equal(2, detail.Routines.Count);   // "Night check" and "Lunch": every ACTIVE routine, unfiltered, as before
    }

    // ══════════════ Medication Competency flag ══════════════

    [Fact]
    public void CanRecordDoses_IsTrue_WithACurrentCredential()
    {
        var detail = Get(Create(ShiftStatus.Published));

        Assert.True(detail.CanRecordDoses);
        Assert.Null(detail.CanRecordDosesReason);
        Assert.Null(detail.CanRecordDosesReasonCode);
    }

    [Fact]
    public void Enforce_CanRecordDoses_IsFalse_WithAReasonAndCode_WhenTheCredentialIsMissing()
    {
        var detail = Get(Create(ShiftStatus.Published, workerCompetent: false, competencyMode: MedicationCompetencyMode.Enforce));

        Assert.False(detail.CanRecordDoses);
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", detail.CanRecordDosesReasonCode);
        Assert.Contains("Medication Competency", detail.CanRecordDosesReason);
    }

    [Fact]
    public void Enforce_CanRecordDoses_IsFalse_WhenTheCredentialHasExpired()
    {
        var f = Create(ShiftStatus.Published, competencyMode: MedicationCompetencyMode.Enforce);
        f.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 13);   // provider-local today is 14 July
        f.Db.SaveChanges();

        var detail = Get(f);

        Assert.False(detail.CanRecordDoses);
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", detail.CanRecordDosesReasonCode);
        Assert.Contains("13 Jul 2026", detail.CanRecordDosesReason);
    }

    [Fact]
    public void Warn_CanRecordDoses_IsTrue_WithTheWarning_AndTheSpecificCode_WhenTheCredentialIsMissing()
    {
        var detail = Get(Create(ShiftStatus.Published, workerCompetent: false));   // Warn is the default mode

        Assert.True(detail.CanRecordDoses);
        Assert.Equal("Medication Competency not current — this record will be flagged", detail.CanRecordDosesReason);
        Assert.Equal("MEDICATION_COMPETENCY_MISSING", detail.CanRecordDosesReasonCode);
    }

    [Fact]
    public void Warn_CanRecordDoses_IsTrue_WithTheWarning_AndTheExpiredCode_WhenTheCredentialHasExpired()
    {
        var f = Create(ShiftStatus.Published);
        f.Worker.MedicationCompetencyExpiryDate = new DateOnly(2026, 7, 13);
        f.Db.SaveChanges();

        var detail = Get(f);

        Assert.True(detail.CanRecordDoses);
        Assert.Equal(MedicationCompetencyGate.WarningMessage, detail.CanRecordDosesReason);
        Assert.Equal("MEDICATION_COMPETENCY_EXPIRED", detail.CanRecordDosesReasonCode);
    }
}
