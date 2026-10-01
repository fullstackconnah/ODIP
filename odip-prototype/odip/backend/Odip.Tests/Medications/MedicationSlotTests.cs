using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>A settable clock so midnight / daylight-saving behaviour is testable without the wall clock.</summary>
internal sealed class FakeClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;
    public override DateTimeOffset GetUtcNow() => _now;
    public void Set(DateTimeOffset now) => _now = now;
    public static FakeClock AtUtc(int y, int mo, int d, int h, int mi) =>
        new(new DateTimeOffset(y, mo, d, h, mi, 0, TimeSpan.Zero));

    /// <summary>
    /// 12:00 UTC on today's UTC date: the UTC date and the provider's (Sydney 22:00 AEST / 23:00 AEDT) agree, so a test whose fixtures and expectations
    /// are built from the UTC date cannot flake in the 10-11 hours a day when the two dates differ.
    /// </summary>
    public static FakeClock AtUtcNoonToday()
    {
        var now = DateTimeOffset.UtcNow;
        return new(new DateTimeOffset(now.Year, now.Month, now.Day, 12, 0, 0, TimeSpan.Zero));
    }
}

/// <summary>
/// The shared dose-slot arithmetic: window enumeration (one day, overnight), and "overdue" decided in
/// the PROVIDER's local time zone rather than against UTC "now" — across midnight and across daylight
/// saving in both directions. Sydney is UTC+10 (AEST) / UTC+11 (AEDT); in 2026 daylight saving starts
/// Sunday 4 October (02:00 -> 03:00) and ends Sunday 5 April (03:00 -> 02:00).
/// </summary>
public class MedicationSlotCalculatorTests
{
    private static readonly TimeZoneInfo Sydney = ProviderLocalTime.ResolveZone("Australia/Sydney");

    private static ParticipantMedication Med(
        string times, MedicationFrequency frequency = MedicationFrequency.Daily, Weekdays? days = null,
        int? interval = null, DateOnly? anchor = null, DateTime? start = null, DateTime? end = null) => new()
    {
        Id = Guid.NewGuid(), Name = "Med", TimesOfDay = times, Type = MedicationType.Regular,
        Frequency = frequency, DaysOfWeek = days, IntervalDays = interval, AnchorDate = anchor,
        StartDate = start ?? new DateTime(2025, 1, 1), EndDate = end,
    };

    private static DateTime L(int y, int mo, int d, int h, int mi) => new(y, mo, d, h, mi, 0, DateTimeKind.Unspecified);

    // ── EnumerateSlots ────────────────────────────────────────────────

    [Fact]
    public void EnumerateSlots_OneCalendarDay_ReturnsEveryTimeInWrittenOrder()
    {
        var slots = MedicationSlotCalculator.EnumerateSlots(Med("20:00,08:00"), L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0));

        Assert.Equal([L(2026, 7, 14, 20, 0), L(2026, 7, 14, 8, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_OvernightWindow_SpansTwoDates_AndDropsSlotsOutsideIt()
    {
        // A 22:00 -> 06:00 shift starting Tuesday 14 July. 21:00 is before the shift, 07:00 after it.
        var slots = MedicationSlotCalculator.EnumerateSlots(
            Med("21:00,23:00,02:00,07:00"), L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0));

        Assert.Equal([L(2026, 7, 14, 23, 0), L(2026, 7, 15, 2, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_OvernightWindow_AfterMidnightSlotUsesTheNextDaysSchedule()
    {
        // Due on Wednesdays only. A Tuesday-night shift crosses into Wednesday, so the 02:00 slot (a
        // WEDNESDAY slot) belongs to the shift even though the shift's service date is Tuesday — and a
        // Tuesday 23:00 slot does not exist because the medication is not due on Tuesdays.
        var med = Med("23:00,02:00", MedicationFrequency.SpecificDays, Weekdays.Wednesday);

        var slots = MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0));

        Assert.Equal([L(2026, 7, 15, 2, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_EveryNDays_IsEvaluatedPerCalendarDateInsideTheWindow()
    {
        // Every 2 days from 13 July: due 13, 15, 17 July. The 14th->15th overnight picks up only the 15th.
        var med = Med("01:00,23:00", MedicationFrequency.EveryNDays, interval: 2, anchor: new DateOnly(2026, 7, 13));

        var slots = MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0));

        Assert.Equal([L(2026, 7, 15, 1, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_WindowIsHalfOpen_StartIncluded_EndExcluded()
    {
        var slots = MedicationSlotCalculator.EnumerateSlots(Med("08:00,16:00"), L(2026, 7, 14, 8, 0), L(2026, 7, 14, 16, 0));

        Assert.Equal([L(2026, 7, 14, 8, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_WindowEndingExactlyAtMidnight_DoesNotPullInNextDaysMidnightSlot()
    {
        var slots = MedicationSlotCalculator.EnumerateSlots(Med("00:00,23:30"), L(2026, 7, 14, 16, 0), L(2026, 7, 15, 0, 0));

        Assert.Equal([L(2026, 7, 14, 23, 30)], slots);
    }

    [Theory]
    [InlineData("8am")]
    [InlineData("08:00,bad")]
    [InlineData("")]
    [InlineData(null)]
    public void EnumerateSlots_MalformedOrBlankTimes_YieldNoSlots(string? times)
    {
        Assert.Empty(MedicationSlotCalculator.EnumerateSlots(Med(times!), L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0)));
    }

    [Fact]
    public void EnumerateSlots_DuplicateTimes_AreNotCollapsed()
    {
        Assert.Equal(2, MedicationSlotCalculator.EnumerateSlots(Med("06:00,06:00"), L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0)).Count);
    }

    [Fact]
    public void EnumerateSlots_EmptyOrInvertedWindow_YieldsNothing()
    {
        Assert.Empty(MedicationSlotCalculator.EnumerateSlots(Med("08:00"), L(2026, 7, 14, 9, 0), L(2026, 7, 14, 9, 0)));
        Assert.Empty(MedicationSlotCalculator.EnumerateSlots(Med("08:00"), L(2026, 7, 14, 9, 0), L(2026, 7, 14, 7, 0)));
    }

    // ── the medication's course (StartDate / EndDate) is tested PER CALENDAR DATE ──

    [Fact]
    public void EnumerateSlots_OvernightWindow_CourseEndingOnTheFirstDate_HasNoSlotOnTheSecondDate()
    {
        // A 7-day antibiotic whose last day is Tuesday 14 July, on a 22:00 -> 06:00 shift starting that Tuesday.
        // Tuesday 22:00 is the last dose; Wednesday 02:00 is the night AFTER the course ended.
        var med = Med("02:00,22:00", end: new DateTime(2026, 7, 14));

        var slots = MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0));

        Assert.Equal([L(2026, 7, 14, 22, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_OvernightWindow_CourseStartingOnTheSecondDate_HasNoSlotOnTheFirstDate()
    {
        // Prescribed from Wednesday 15 July: tonight's 23:00 (Tuesday) is before the prescription, 02:00 Wednesday is the first dose.
        var med = Med("23:00,02:00", start: new DateTime(2026, 7, 15));

        var slots = MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0));

        Assert.Equal([L(2026, 7, 15, 2, 0)], slots);
    }

    [Fact]
    public void EnumerateSlots_TheCourseStartAndEndDates_AreInclusiveOfTheirWholeDay()
    {
        var med = Med("00:30,23:30", start: new DateTime(2026, 7, 14), end: new DateTime(2026, 7, 14));

        Assert.Equal([L(2026, 7, 14, 0, 30), L(2026, 7, 14, 23, 30)], MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0)));
        Assert.Empty(MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 13, 0, 0), L(2026, 7, 14, 0, 0)));
        Assert.Empty(MedicationSlotCalculator.EnumerateSlots(med, L(2026, 7, 15, 0, 0), L(2026, 7, 16, 0, 0)));
    }

    // ── IsOverdue: provider-local, not UTC ─────────────────────────────

    [Fact]
    public void IsOverdue_UsesTheProvidersZone_NotUtc_TheOriginalBug()
    {
        // 08:00 Sydney on 14 July is 22:00 UTC on the 13th. At 23:30 UTC it is 09:30 in Sydney: 90 minutes
        // late. The old implementation compared the zone-less slot with UTC "now" and said "not overdue".
        var slot = L(2026, 7, 14, 8, 0);
        var nowUtc = new DateTime(2026, 7, 13, 23, 30, 0, DateTimeKind.Utc);

        Assert.True(MedicationSlotCalculator.IsOverdue(slot, hasRecord: false, nowUtc, Sydney));
        Assert.False(slot.AddMinutes(60) < nowUtc, "sanity: the old UTC comparison would have said not overdue");
    }

    [Theory]
    [InlineData(9, 0, false)]   // exactly 60 minutes late: not yet overdue
    [InlineData(9, 1, true)]    // 61 minutes late
    [InlineData(8, 30, false)]  // inside the grace period
    public void IsOverdue_GraceBoundaryIsSixtyMinutes(int localHour, int localMinute, bool expected)
    {
        var slot = L(2026, 7, 14, 8, 0);
        var nowUtc = ProviderLocalTime.LocalToUtc(L(2026, 7, 14, localHour, localMinute), Sydney);

        Assert.Equal(expected, MedicationSlotCalculator.IsOverdue(slot, false, nowUtc, Sydney));
    }

    [Theory]
    [InlineData(14, 14, 25, false)] // 00:25 local on the 15th: 55 minutes after a 23:30 slot
    [InlineData(14, 15, 0, true)]   // 01:00 local on the 15th: 90 minutes
    public void IsOverdue_AcrossMidnight(int slotDay, int nowUtcHour, int nowUtcMinute, bool expected)
    {
        // 23:30 Sydney (AEST, UTC+10) on the 14th is 13:30 UTC. now = 14th at the given UTC time.
        var slot = L(2026, 7, slotDay, 23, 30);
        var nowUtc = new DateTime(2026, 7, 14, nowUtcHour, nowUtcMinute, 0, DateTimeKind.Utc);

        Assert.Equal(expected, MedicationSlotCalculator.IsOverdue(slot, false, nowUtc, Sydney));
    }

    [Theory]
    [InlineData(16, 20, false)] // 03:20 AEDT = only 50 real minutes after 01:30 AEST; wall-clock arithmetic would say 110
    [InlineData(16, 31, true)]  // 03:31 AEDT = 61 real minutes
    public void IsOverdue_SpringForward_CountsRealElapsedTime_NotWallClockDifference(int nowUtcHour, int nowUtcMinute, bool expected)
    {
        // Daylight saving starts Sunday 4 Oct 2026 (02:00 -> 03:00). 01:30 AEST on the 4th = 3 Oct 15:30 UTC.
        var slot = L(2026, 10, 4, 1, 30);
        var nowUtc = new DateTime(2026, 10, 3, nowUtcHour, nowUtcMinute, 0, DateTimeKind.Utc);

        Assert.Equal(expected, MedicationSlotCalculator.IsOverdue(slot, false, nowUtc, Sydney));
    }

    [Theory]
    [InlineData(17, 29, false)] // 03:29 AEST, 59 real minutes after the (standard-time) 02:30 slot
    [InlineData(17, 31, true)]  // 61 real minutes
    public void IsOverdue_FallBack_AmbiguousSlotResolvesToStandardTime(int nowUtcHour, int nowUtcMinute, bool expected)
    {
        // Daylight saving ends Sunday 5 Apr 2026 (03:00 AEDT -> 02:00 AEST), so 02:30 happens twice; .NET
        // resolves the ambiguous wall-clock time to STANDARD time: 02:30 AEST = 4 Apr 16:30 UTC.
        var slot = L(2026, 4, 5, 2, 30);
        var nowUtc = new DateTime(2026, 4, 4, nowUtcHour, nowUtcMinute, 0, DateTimeKind.Utc);

        Assert.Equal(expected, MedicationSlotCalculator.IsOverdue(slot, false, nowUtc, Sydney));
    }

    [Fact]
    public void IsOverdue_SlotInsideTheSpringForwardGap_IsSkewedAnHourLaterInsteadOfThrowing()
    {
        // 02:30 on 4 Oct 2026 does not exist in Sydney. It resolves to the first valid instant after the
        // skip: 03:30 AEDT = 3 Oct 16:30 UTC, so it is overdue after 17:30 UTC.
        var slot = L(2026, 10, 4, 2, 30);

        Assert.False(MedicationSlotCalculator.IsOverdue(slot, false, new DateTime(2026, 10, 3, 17, 29, 0, DateTimeKind.Utc), Sydney));
        Assert.True(MedicationSlotCalculator.IsOverdue(slot, false, new DateTime(2026, 10, 3, 17, 31, 0, DateTimeKind.Utc), Sydney));
    }

    [Fact]
    public void IsOverdue_ARecordedSlotIsNeverOverdue()
    {
        Assert.False(MedicationSlotCalculator.IsOverdue(L(2020, 1, 1, 8, 0), hasRecord: true, DateTime.UtcNow, Sydney));
    }

    // ── ProviderLocalTime ──────────────────────────────────────────────

    [Fact]
    public void ResolveZone_UnknownOrBlankId_FallsBackToSydney()
    {
        Assert.Equal("Australia/Sydney", ProviderLocalTime.ResolveZone("Not/AZone").Id);
        Assert.Equal("Australia/Sydney", ProviderLocalTime.ResolveZone(null).Id);
        Assert.Equal("Australia/Sydney", ProviderLocalTime.ResolveZone("  ").Id);
    }

    [Fact]
    public void UtcToLocal_AndLocalToUtc_RoundTripOutsideTheDaylightSavingHours()
    {
        var utc = new DateTime(2026, 7, 13, 22, 0, 0, DateTimeKind.Utc);

        var local = ProviderLocalTime.UtcToLocal(utc, Sydney);

        Assert.Equal(L(2026, 7, 14, 8, 0), local);
        Assert.Equal(DateTimeKind.Unspecified, local.Kind);
        Assert.Equal(utc, ProviderLocalTime.LocalToUtc(local, Sydney));
    }

    [Fact]
    public void RosteredWindowLocal_OvernightShiftEndsOnTheNextDate()
    {
        var shift = new Shift
        {
            ServiceDate = new DateOnly(2026, 7, 14), StartTime = new TimeOnly(22, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true,
        };

        var (start, end) = ProviderLocalTime.RosteredWindowLocal(shift);

        Assert.Equal(L(2026, 7, 14, 22, 0), start);
        Assert.Equal(L(2026, 7, 15, 6, 0), end);
    }
}

/// <summary>The window form of the slot service against an EF InMemory database with a controllable clock.</summary>
public class MedicationSlotServiceTests
{
    private static readonly TimeZoneInfo Sydney = ProviderLocalTime.ResolveZone("Australia/Sydney");

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static DateTime L(int y, int mo, int d, int h, int mi) => new(y, mo, d, h, mi, 0, DateTimeKind.Unspecified);

    private static async Task<(OdipDbContext Db, Participant P, ParticipantMedication Med)> SeedAsync(string times = "23:00,02:00")
    {
        var db = CreateDb();
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "Melatonin", Strength = "3mg", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = times, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.Participants.Add(p);
        db.ParticipantMedications.Add(med);
        await db.SaveChangesAsync();
        return (db, p, med);
    }

    [Fact]
    public async Task GetWindow_OvernightShift_ReturnsSlotsOnBothDates_WithLocalOverdueAndRecordedState()
    {
        var (db, p, med) = await SeedAsync("23:00,02:00,05:30");
        // Record the 23:00 slot only.
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = p.Id, ScheduledAt = L(2026, 7, 14, 23, 0),
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Jamie Lee", AdministeredAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        // 03:30 Sydney on the 15th (AEST) = 14 July 17:30 UTC: 02:00 is 90 min late, 05:30 is in the future.
        var service = new MedicationSlotService(db, FakeClock.AtUtc(2026, 7, 14, 17, 30));

        var result = await service.GetWindowAsync(L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0), p.Id, Sydney, includePrn: false, default);

        Assert.Collection(result.Slots.OrderBy(s => s.ScheduledAt),
            s => { Assert.Equal(L(2026, 7, 14, 23, 0), s.ScheduledAt); Assert.NotNull(s.Administration); Assert.False(s.IsOverdue); },
            s => { Assert.Equal(L(2026, 7, 15, 2, 0), s.ScheduledAt); Assert.Null(s.Administration); Assert.True(s.IsOverdue); },
            s => { Assert.Equal(L(2026, 7, 15, 5, 30), s.ScheduledAt); Assert.Null(s.Administration); Assert.False(s.IsOverdue); });
        Assert.Empty(result.Prn);
    }

    [Fact]
    public async Task GetWindow_ALaterRecordForTheSameSlotWins_ByCreatedAt()
    {
        var (db, p, med) = await SeedAsync("09:00");
        var slot = L(2026, 7, 14, 9, 0);
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = p.Id, ScheduledAt = slot,
                Status = MedicationAdministrationStatus.Refused, Reason = "no", RecordedByName = "A", CreatedAt = new DateTime(2026, 7, 13, 23, 0, 0, DateTimeKind.Utc),
            },
            new MedicationAdministration
            {
                Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = p.Id, ScheduledAt = slot,
                Status = MedicationAdministrationStatus.Administered, RecordedByName = "B", CreatedAt = new DateTime(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc),
            });
        await db.SaveChangesAsync();
        var service = new MedicationSlotService(db, FakeClock.AtUtc(2026, 7, 14, 12, 0));

        var result = await service.GetWindowAsync(L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0), null, Sydney, false, default);

        Assert.Equal(MedicationAdministrationStatus.Administered, Assert.Single(result.Slots).Administration!.Status);
    }

    [Fact]
    public async Task GetWindow_ExcludesInactiveEndedAndNotYetStartedMedications_AndOtherParticipants()
    {
        var (db, p, _) = await SeedAsync("08:00");
        var other = new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Chen", IsActive = true };
        db.Participants.Add(other);
        db.ParticipantMedications.AddRange(
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "OnHold", TimesOfDay = "08:00", Type = MedicationType.Regular, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.OnHold },
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "Ended", TimesOfDay = "08:00", Type = MedicationType.Regular, StartDate = new DateTime(2026, 1, 1), EndDate = new DateTime(2026, 7, 13), Status = MedicationStatus.Active },
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "NotStarted", TimesOfDay = "08:00", Type = MedicationType.Regular, StartDate = new DateTime(2026, 7, 15), Status = MedicationStatus.Active },
            new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = other.Id, Name = "Theirs", TimesOfDay = "08:00", Type = MedicationType.Regular, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active });
        await db.SaveChangesAsync();
        var service = new MedicationSlotService(db, FakeClock.AtUtc(2026, 7, 14, 0, 0));

        var result = await service.GetWindowAsync(L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0), p.Id, Sydney, false, default);

        Assert.Equal("Melatonin", Assert.Single(result.Slots).Medication.Name);
    }

    [Fact]
    public async Task GetWindow_OvernightShift_MedicationEndingOnTheServiceDate_ListsNoSlotOnTheNextDate()
    {
        // The window-level query keeps a medication whose EndDate (14 Jul) is on or after the window's first date. That alone must not
        // put the 15 Jul 02:00 dose - the night after the course ended - on the list.
        var (db, p, med) = await SeedAsync("02:00,22:00");
        med.EndDate = new DateTime(2026, 7, 14);
        await db.SaveChangesAsync();
        var service = new MedicationSlotService(db, FakeClock.AtUtc(2026, 7, 14, 10, 0));

        var result = await service.GetWindowAsync(L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0), p.Id, Sydney, false, default);

        Assert.Equal(L(2026, 7, 14, 22, 0), Assert.Single(result.Slots).ScheduledAt);
    }

    [Fact]
    public async Task GetWindow_OvernightShift_MedicationStartingTomorrow_ListsNoSlotTonight()
    {
        var (db, p, med) = await SeedAsync("23:00,02:00");
        med.StartDate = new DateTime(2026, 7, 15);
        await db.SaveChangesAsync();
        var service = new MedicationSlotService(db, FakeClock.AtUtc(2026, 7, 14, 10, 0));

        var result = await service.GetWindowAsync(L(2026, 7, 14, 22, 0), L(2026, 7, 15, 6, 0), p.Id, Sydney, false, default);

        Assert.Equal(L(2026, 7, 15, 2, 0), Assert.Single(result.Slots).ScheduledAt);
    }

    [Fact]
    public async Task GetWindow_IncludePrn_ReturnsPrnSeparatelyWithRollingDoseCount()
    {
        var (db, p, _) = await SeedAsync("08:00");
        var prn = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "Paracetamol", DoseDescription = "2 tablets", Type = MedicationType.Prn,
            PrnIndication = "Pain", PrnMaxDosesPer24h = 4, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.ParticipantMedications.Add(prn);
        var clock = FakeClock.AtUtc(2026, 7, 14, 12, 0);
        db.MedicationAdministrations.AddRange(
            new MedicationAdministration { Id = Guid.NewGuid(), ParticipantMedicationId = prn.Id, ParticipantId = p.Id, Status = MedicationAdministrationStatus.Administered, RecordedByName = "A", AdministeredAt = new DateTime(2026, 7, 14, 10, 0, 0, DateTimeKind.Utc) },
            new MedicationAdministration { Id = Guid.NewGuid(), ParticipantMedicationId = prn.Id, ParticipantId = p.Id, Status = MedicationAdministrationStatus.Administered, RecordedByName = "A", AdministeredAt = new DateTime(2026, 7, 13, 11, 0, 0, DateTimeKind.Utc), PrnOutcome = "ok" });
        await db.SaveChangesAsync();
        var service = new MedicationSlotService(db, clock);

        var result = await service.GetWindowAsync(L(2026, 7, 14, 0, 0), L(2026, 7, 15, 0, 0), p.Id, Sydney, includePrn: true, default);

        var status = Assert.Single(result.Prn);
        Assert.Equal("Paracetamol", status.Medication.Name);
        Assert.Equal(1, status.DosesInLast24h);   // the 13th 11:00 UTC dose is 25 hours old
        Assert.Equal(new DateTime(2026, 7, 14, 10, 0, 0, DateTimeKind.Utc), status.LastDoseAt);
        Assert.NotNull(status.OutcomePendingAdministration);
        Assert.DoesNotContain(result.Slots, s => s.Medication.Id == prn.Id);
    }
}

/// <summary>
/// <c>GET medications/mar</c> decides "today" and "overdue" in the PROVIDER's local time zone
/// (ProviderSettings.State -> IANA zone), not UTC — the original bug: for an Australian provider the
/// chip lagged by the UTC offset (10-11 hours).
/// </summary>
public class MarProviderLocalTimeTests
{
    private static async Task<(MedicationsController Controller, Guid ParticipantId)> SeedAsync(string state, FakeClock clock)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var db = new OdipDbContext(
            new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var p = new Participant { Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(p);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), State = state });
        db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = p.Id, Name = "Levetiracetam", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "08:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        });
        await db.SaveChangesAsync();
        return (new MedicationsController(db, tenant.Object, slots: new MedicationSlotService(db, clock)), p.Id);
    }

    private static MarDayDto Body(ActionResult<ApiResponse<MarDayDto>> result) =>
        Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task Overdue_FollowsTheProvidersState_SydneyVersusPerth()
    {
        // 00:30 UTC on 14 July: 10:30 in Sydney (90 min after an 08:00 slot), 08:30 in Perth (30 min).
        var clock = FakeClock.AtUtc(2026, 7, 14, 0, 30);

        var (nsw, _) = await SeedAsync("NSW", clock);
        var (wa, _) = await SeedAsync("WA", clock);

        Assert.True(Body(await nsw.GetMar(new DateOnly(2026, 7, 14), null, default)).Entries.Single().IsOverdue);
        Assert.False(Body(await wa.GetMar(new DateOnly(2026, 7, 14), null, default)).Entries.Single().IsOverdue);
    }

    [Fact]
    public async Task Overdue_UtcStillOnThePreviousDay_ButProviderLocalAlreadyLate_IsOverdue()
    {
        // The original bug exactly: 23:30 UTC on the 13th is 09:30 on the 14th in Sydney.
        var (controller, _) = await SeedAsync("VIC", FakeClock.AtUtc(2026, 7, 13, 23, 30));

        Assert.True(Body(await controller.GetMar(new DateOnly(2026, 7, 14), null, default)).Entries.Single().IsOverdue);
    }

    [Fact]
    public async Task NoDateSupplied_DefaultsToTheProvidersLocalToday_NotTheUtcDate()
    {
        // 23:30 UTC on 13 July is already 14 July in Sydney.
        var (controller, _) = await SeedAsync("NSW", FakeClock.AtUtc(2026, 7, 13, 23, 30));

        var day = Body(await controller.GetMar(null, null, default));

        Assert.Equal(new DateOnly(2026, 7, 14), day.Date);
    }

    [Fact]
    public async Task FutureSlot_IsNotOverdue_AndASlotExactlyAnHourOldIsNot_YetOverdue()
    {
        var (early, _) = await SeedAsync("NSW", FakeClock.AtUtc(2026, 7, 13, 22, 0));   // 08:00 local, exactly on the slot
        var (boundary, _) = await SeedAsync("NSW", FakeClock.AtUtc(2026, 7, 13, 23, 0)); // 09:00 local = exactly 60 min

        Assert.False(Body(await early.GetMar(new DateOnly(2026, 7, 14), null, default)).Entries.Single().IsOverdue);
        Assert.False(Body(await boundary.GetMar(new DateOnly(2026, 7, 14), null, default)).Entries.Single().IsOverdue);
    }
}
