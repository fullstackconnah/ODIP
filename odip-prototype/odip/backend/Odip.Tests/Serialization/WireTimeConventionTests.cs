using System.Text.Json;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Serialization;

/// <summary>
/// The time convention on the wire (see DESIGN.md, "Time on the wire"), asserted as exact JSON through the REAL API options:
///
///  - an INSTANT (something that happened: created, logged in, dose given) reaches the client as UTC with a trailing "Z";
///  - a provider-local WALL-CLOCK value (a dose slot, an incident time typed into the form) or a calendar date held in a DateTime
///    goes out with NO zone, and its digits are never shifted;
///  - DateOnly / TimeOnly / DateTimeOffset are untouched.
///
/// Why this matters: 136 of 138 timestamp columns are `timestamp without time zone` and the API runs Npgsql's legacy timestamp
/// switch, so a UTC instant read back from the database has Kind Unspecified and used to be written with no suffix. A browser
/// parses a zone-less ISO string as LOCAL time, so in Sydney every such instant read 10-11 hours wrong.
/// </summary>
public class WireTimeConventionTests
{
    private static readonly JsonSerializerOptions Api = WireTypeWalker.ApiOptions();

    /// <summary>What Npgsql returns for a `timestamp` column under the legacy switch: the stored digits, Kind Unspecified.</summary>
    private static DateTime FromPostgres(int y, int mo, int d, int h, int mi) => new(y, mo, d, h, mi, 0, DateTimeKind.Unspecified);

    private static WireTypeWalker.Field Field(Type owner, string property) =>
        WireTypeWalker.DateTimeFields().Single(f => f.Owner == owner && f.Property.Name == property);

    // ── Instants: always UTC with Z ──────────────────────────────────────

    [Theory]
    [InlineData(typeof(MarPrnDto), nameof(MarPrnDto.LastDoseAt))]                                  // L4-01 PRN "Last dose"
    [InlineData(typeof(AdminUserDto), nameof(AdminUserDto.LastLoginAt))]                          // L4-02 Last login
    [InlineData(typeof(FlaggedShiftNoteDto), nameof(FlaggedShiftNoteDto.CreatedAt))]              // L4-02 flagged-note Age
    [InlineData(typeof(ClaimBatchListDto), nameof(ClaimBatchListDto.CreatedAt))]                  // L4-02 claim-batch times
    [InlineData(typeof(ClaimBatchListDto), nameof(ClaimBatchListDto.SubmittedAt))]
    [InlineData(typeof(ShiftCompletionDto), nameof(ShiftCompletionDto.ActualStart))]              // L4-02 "started Xh ago"
    [InlineData(typeof(CompletionQueueItemDto), nameof(CompletionQueueItemDto.ActualStart))]
    [InlineData(typeof(IncidentShiftNoteContextDto), nameof(IncidentShiftNoteContextDto.CreatedAt))] // L4-07 date-only sites
    [InlineData(typeof(CaregiverSubmissionListItemDto), nameof(CaregiverSubmissionListItemDto.SubmittedAt))]
    [InlineData(typeof(CaregiverSubmissionListItemDto), nameof(CaregiverSubmissionListItemDto.ExpiresAt))]
    [InlineData(typeof(TripClaimListDto), nameof(TripClaimListDto.CreatedAt))]
    [InlineData(typeof(TenantDto), nameof(TenantDto.CreatedAt))]
    [InlineData(typeof(NotificationOutboxDto), nameof(NotificationOutboxDto.CreatedAt))]
    [InlineData(typeof(AdministrationDto), nameof(AdministrationDto.AdministeredAt))]
    [InlineData(typeof(PortalDoseOutcomeDto), nameof(PortalDoseOutcomeDto.AdministeredAt))]       // already marked UTC by the shift package
    public void AnInstantReadBackFromPostgres_IsWrittenAsUtcWithZ(Type owner, string property)
    {
        var written = WireTypeWalker.WriteAlone(Field(owner, property), FromPostgres(2026, 10, 3, 5, 0));

        Assert.Equal("2026-10-03T05:00:00Z", written);
    }

    [Fact]
    public void AnInstantAlreadyMarkedUtc_KeepsItsSingleZ()
    {
        var written = WireTypeWalker.WriteAlone(Field(typeof(AdminUserDto), nameof(AdminUserDto.LastLoginAt)),
            new DateTime(2026, 10, 3, 5, 0, 0, DateTimeKind.Utc));

        Assert.Equal("2026-10-03T05:00:00Z", written);
    }

    [Fact]
    public void AnInstantHeldAsLocalTime_IsConvertedToItsUtcInstant_NotWrittenWithTheServersOffset()
    {
        var instant = new DateTime(2026, 10, 3, 5, 0, 0, DateTimeKind.Utc);

        var written = WireTypeWalker.WriteAlone(Field(typeof(AdminUserDto), nameof(AdminUserDto.LastLoginAt)), instant.ToLocalTime());

        Assert.Equal("2026-10-03T05:00:00Z", written);
    }

    [Fact]
    public void AWholeDto_WritesItsInstantWithZ_AndOmitsAnAbsentOne()
    {
        var json = JsonSerializer.Serialize(new AdminUserDto { LastLoginAt = FromPostgres(2026, 10, 3, 5, 0) }, Api);

        Assert.Contains("\"lastLoginAt\":\"2026-10-03T05:00:00Z\"", json);
        Assert.DoesNotContain("\"lastLoginAt\":null", JsonSerializer.Serialize(new AdminUserDto(), Api));
    }

    // ── Wall-clock values: no zone, digits never shifted ─────────────────

    [Theory]
    [InlineData(typeof(MarEntryDto), nameof(MarEntryDto.ScheduledAt))]                            // the MAR slot
    [InlineData(typeof(AdministrationDto), nameof(AdministrationDto.ScheduledAt))]
    [InlineData(typeof(PortalDoseSlotDto), nameof(PortalDoseSlotDto.ScheduledAt))]
    [InlineData(typeof(PortalFinishBlockerDto), nameof(PortalFinishBlockerDto.ScheduledAt))]
    [InlineData(typeof(PortalShiftRoutineDto), nameof(PortalShiftRoutineDto.OccursAt))]
    [InlineData(typeof(IncidentListDto), nameof(IncidentListDto.IncidentDateTime))]               // typed into a datetime-local input
    [InlineData(typeof(IncidentSummaryDto), nameof(IncidentSummaryDto.IncidentDateTime))]
    [InlineData(typeof(PortalWitnessRequestDto), nameof(PortalWitnessRequestDto.IncidentDateTime))]
    [InlineData(typeof(IncidentDetailDto), nameof(IncidentDetailDto.QscReportedAt))]
    [InlineData(typeof(IncidentDetailDto), nameof(IncidentDetailDto.FamilyNotifiedAt))]
    [InlineData(typeof(IncidentDetailDto), nameof(IncidentDetailDto.SupportCoordinatorNotifiedAt))]
    [InlineData(typeof(MedicationListDto), nameof(MedicationListDto.StartDate))]                  // a calendar date held in a DateTime
    [InlineData(typeof(MedicationListDto), nameof(MedicationListDto.NextReviewDue))]
    [InlineData(typeof(StaffAvailabilityDto), nameof(StaffAvailabilityDto.StartDateTime))]
    public void AWallClockValue_IsWrittenWithNoZone_AndKeepsItsDigits(Type owner, string property)
    {
        var field = Field(owner, property);

        Assert.Equal("2026-10-03T08:00:00", WireTypeWalker.WriteAlone(field, FromPostgres(2026, 10, 3, 8, 0)));
        // Even a value somebody marked Utc or Local must not grow a zone or an offset: the digits ARE the answer.
        Assert.Equal("2026-10-03T08:00:00", WireTypeWalker.WriteAlone(field, new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Utc)));
        Assert.Equal("2026-10-03T08:00:00", WireTypeWalker.WriteAlone(field, new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Local)));
    }

    [Fact]
    public void AMarSlotAt1846_GoesOutAs1846_NotShiftedAndNotMarkedUtc()
    {
        // The L4-09 sample: an 18:46 provider-local slot. A blanket "treat as UTC" converter would send 18:46Z, which a Sydney
        // browser shows as 04:46 the next day.
        var json = JsonSerializer.Serialize(new MarEntryDto { ScheduledTime = "18:46", ScheduledAt = FromPostgres(2026, 10, 1, 18, 46) }, Api);

        Assert.Contains("\"scheduledAt\":\"2026-10-01T18:46:00\"", json);
        Assert.Contains("\"scheduledTime\":\"18:46\"", json);
    }

    // ── Reading what the browser sends ───────────────────────────────────

    [Fact]
    public void AnIncidentTimeTypedIntoTheForm_RoundTripsUnchanged()
    {
        // IncidentCreatePage posts the raw datetime-local string ("2026-10-03T08:00") and the edit form slices it back out.
        var dto = JsonSerializer.Deserialize<CreateIncidentDto>("{\"incidentDateTime\":\"2026-10-03T08:00\"}", Api)!;

        Assert.Equal(new DateTime(2026, 10, 3, 8, 0, 0), dto.IncidentDateTime);
        Assert.Equal(DateTimeKind.Unspecified, dto.IncidentDateTime.Kind);
        Assert.Contains("\"incidentDateTime\":\"2026-10-03T08:00:00\"", JsonSerializer.Serialize(dto, Api));
    }

    [Theory]
    [InlineData("2026-10-03T08:00:00Z")]
    [InlineData("2026-10-03T08:00:00+10:00")]
    [InlineData("2026-10-03T08:00:00")]
    public void AWallClockField_KeepsTheDigitsItWasGiven_WhateverZoneTheyCameWith(string sent)
    {
        var dto = JsonSerializer.Deserialize<CreateIncidentDto>($"{{\"incidentDateTime\":\"{sent}\"}}", Api)!;

        Assert.Equal(new DateTime(2026, 10, 3, 8, 0, 0), dto.IncidentDateTime);
        Assert.Equal(DateTimeKind.Unspecified, dto.IncidentDateTime.Kind);
    }

    [Theory]
    [InlineData("2026-10-03", 0, 0)]            // what an <input type="date"> posts: the medication form sends startDate / nextReviewDue / consentDate like this
    [InlineData("2026-10-03T00:00:00", 0, 0)]   // what the availability form posts for the first day
    [InlineData("2026-10-03T23:59:59", 23, 59)] // ... and for the last day
    public void ACalendarDateHeldInADateTime_IsReadAsTheDayThatWasPosted(string sent, int hour, int minute)
    {
        var dto = JsonSerializer.Deserialize<CreateMedicationDto>($"{{\"startDate\":\"{sent}\",\"nextReviewDue\":\"{sent}\"}}", Api)!;

        Assert.Equal(new DateTime(2026, 10, 3, hour, minute, hour == 23 ? 59 : 0), dto.StartDate);
        Assert.Equal(DateTimeKind.Unspecified, dto.StartDate.Kind);
        Assert.Equal(dto.StartDate, dto.NextReviewDue);
    }

    [Theory]
    [InlineData("2026-10-03T08:00:00Z")]
    [InlineData("2026-10-03T18:00:00+10:00")]
    [InlineData("2026-10-03T08:00:00")]
    public void AnInstantTheClientSends_IsReadAsUtc(string sent)
    {
        var dto = JsonSerializer.Deserialize<EditShiftBreakDto>($"{{\"startedAt\":\"{sent}\"}}", Api)!;

        Assert.Equal(new DateTime(2026, 10, 3, 8, 0, 0, DateTimeKind.Utc), dto.StartedAt);
        Assert.Equal(DateTimeKind.Utc, dto.StartedAt.Kind);
    }

    // ── Everything that is not a DateTime is untouched ───────────────────

    [Fact]
    public void DateOnly_TimeOnly_AndDateTimeOffset_AreWrittenAsTheyAlwaysWere()
    {
        var json = JsonSerializer.Serialize(new
        {
            tripStart = new DateOnly(2026, 10, 5),
            shiftStart = new TimeOnly(8, 0),
            stamped = new DateTimeOffset(2026, 10, 3, 5, 0, 0, TimeSpan.Zero),
        }, Api);

        Assert.Contains("\"tripStart\":\"2026-10-05\"", json);
        Assert.Contains("\"shiftStart\":\"08:00:00\"", json);
        Assert.Contains("\"stamped\":\"2026-10-03T05:00:00+00:00\"", json);
    }
}
