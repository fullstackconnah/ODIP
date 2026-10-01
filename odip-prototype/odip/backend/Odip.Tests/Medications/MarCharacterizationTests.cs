using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Medications;

/// <summary>
/// Characterization (golden-output) tests for <c>GET medications/mar</c>, written BEFORE the slot
/// computation was extracted into <c>MedicationSlotService</c> so the refactor is provably
/// behaviour-preserving: the golden JSON under <c>Golden/</c> was produced by the original
/// in-controller implementation, and the refactored endpoint must still serialise to exactly the
/// same bytes for the same data.
///
/// The fixtures deliberately cover every branch the old implementation had: Daily / SpecificDays /
/// EveryNDays recurrence, malformed TimesOfDay (silently skipped), duplicated times (NOT
/// de-duplicated), future-start / already-ended / OnHold medications (excluded), two records for one
/// slot (newest CreatedAt wins), a linked incident, a preferred-name participant, PRN rolling-24h
/// counts and a pending PRN outcome, and the participant filter.
///
/// Dates are far from "now" (past / future) so the only clock-dependent field, IsOverdue, is stable
/// in both the old UTC comparison and the new provider-local one. Set MAR_GOLDEN_WRITE=1 to
/// regenerate the golden files from the current implementation (only ever do this deliberately).
/// </summary>
public class MarCharacterizationTests
{
    private const string PrnLastDosePlaceholder = "{{PRN_LAST_DOSE}}";

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    private static Guid G(int n) => new($"00000000-0000-0000-0000-{n:D12}");

    private static readonly DateTime T0 = new(2026, 1, 3, 1, 0, 0, DateTimeKind.Utc);

    private static (OdipDbContext Db, ICurrentTenant Tenant) CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return (new OdipDbContext(options, tenant.Object), tenant.Object);
    }

    private static ParticipantMedication Med(
        int id, Guid participantId, string name, string? times, MedicationType type = MedicationType.Regular,
        MedicationFrequency frequency = MedicationFrequency.Daily, Weekdays? days = null, int? interval = null,
        DateOnly? anchor = null, DateTime? start = null, DateTime? end = null,
        MedicationStatus status = MedicationStatus.Active, bool highRisk = false) => new()
    {
        Id = G(id), ParticipantId = participantId, Name = name, Strength = "500mg",
        Form = MedicationForm.Tablet, Route = MedicationRoute.Oral, DoseDescription = "1 tablet (500mg)",
        Directions = "With water", Type = type, TimesOfDay = times, Frequency = frequency, DaysOfWeek = days,
        IntervalDays = interval, AnchorDate = anchor, StartDate = start ?? new DateTime(2025, 12, 1),
        EndDate = end, Status = status, IsHighRisk = highRisk, SupportLevel = MedicationSupportLevel.Administer,
        PharmacyName = "Central Pharmacy", PharmacyPhone = "03 5555 0100", ConsentObtained = true,
        PrnIndication = type == MedicationType.Prn ? "Mild pain" : null,
        PrnMaxDosesPer24h = type == MedicationType.Prn ? 4 : null,
        PrnMinIntervalMinutes = type == MedicationType.Prn ? 240 : null,
        CreatedAt = T0, UpdatedAt = T0,
    };

    private static MedicationAdministration Admin(
        int id, Guid medId, Guid participantId, DateTime? scheduledAt, MedicationAdministrationStatus status,
        DateTime createdAt, DateTime? administeredAt = null, string? reason = null, string? doseGiven = null,
        string? prnOutcome = null) => new()
    {
        Id = G(id), ParticipantMedicationId = medId, ParticipantId = participantId, ScheduledAt = scheduledAt,
        AdministeredAt = administeredAt, AdministeredAtTimeZone = administeredAt is null ? null : "Australia/Sydney",
        Status = status, DoseGiven = doseGiven, RecordedByName = "Jamie Lee", Reason = reason,
        PrnOutcome = prnOutcome, PrnReason = status == MedicationAdministrationStatus.Administered && scheduledAt is null ? "Headache" : null,
        CreatedAt = createdAt, UpdatedAt = createdAt,
    };

    /// <summary>Returns the serialised MAR plus the (second-truncated) newest PRN dose instant so the
    /// clock-relative PRN timestamp can be normalised out of the golden comparison.</summary>
    private static async Task<(Func<DateOnly, Guid?, Task<string>> Get, DateTime PrnNewest)> BuildAsync()
    {
        var (db, tenant) = CreateDb();
        var p1 = new Participant { Id = G(1), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        var p2 = new Participant { Id = G(2), FirstName = "Mia", LastName = "Chen", PreferredName = "Mimi", IsActive = true };
        db.Participants.AddRange(p1, p2);

        db.ParticipantMedications.AddRange(
            Med(11, p1.Id, "Levetiracetam", "08:00,20:00"),
            Med(12, p1.Id, "Warfarin", "12:30", frequency: MedicationFrequency.SpecificDays, days: Weekdays.Monday | Weekdays.Wednesday, highRisk: true),
            Med(13, p1.Id, "Vitamin D", "09:00", frequency: MedicationFrequency.SpecificDays, days: Weekdays.Tuesday),
            Med(14, p2.Id, "Iron", "07:30,19:45", frequency: MedicationFrequency.EveryNDays, interval: 2, anchor: new DateOnly(2026, 1, 3)),
            Med(15, p2.Id, "Malformed", "8am"),
            Med(16, p1.Id, "FutureStart", "10:00", start: new DateTime(2026, 1, 6)),
            Med(17, p1.Id, "AlreadyEnded", "10:00", end: new DateTime(2026, 1, 4)),
            Med(18, p1.Id, "OnHold", "10:00", status: MedicationStatus.OnHold),
            Med(19, p2.Id, "DuplicateTimes", "06:00,06:00"),
            Med(20, p1.Id, "Paracetamol", null, type: MedicationType.Prn),
            Med(21, p2.Id, "Ibuprofen", null, type: MedicationType.Prn));
        await db.SaveChangesAsync();

        var now = DateTime.UtcNow;
        var prnNewest = new DateTime(now.Ticks - now.Ticks % TimeSpan.TicksPerSecond, DateTimeKind.Utc).AddHours(-2);
        var prnOlder = prnNewest.AddHours(-3);

        db.MedicationAdministrations.AddRange(
            Admin(101, G(11), p1.Id, new DateTime(2026, 1, 5, 8, 0, 0), MedicationAdministrationStatus.Administered,
                T0, administeredAt: new DateTime(2026, 1, 4, 21, 5, 0, DateTimeKind.Utc), doseGiven: "1 tablet"),
            Admin(102, G(12), p1.Id, new DateTime(2026, 1, 5, 12, 30, 0), MedicationAdministrationStatus.Refused,
                T0, reason: "Participant declined"),
            Admin(103, G(12), p1.Id, new DateTime(2026, 1, 5, 12, 30, 0), MedicationAdministrationStatus.Administered,
                T0.AddMinutes(30), administeredAt: new DateTime(2026, 1, 5, 2, 40, 0, DateTimeKind.Utc), doseGiven: "1 tablet"),
            Admin(104, G(14), p2.Id, new DateTime(2026, 1, 5, 7, 30, 0), MedicationAdministrationStatus.Missed,
                T0, reason: "Asleep"),
            Admin(105, G(11), p1.Id, new DateTime(2026, 1, 6, 8, 0, 0), MedicationAdministrationStatus.Administered,
                T0, administeredAt: new DateTime(2026, 1, 5, 21, 0, 0, DateTimeKind.Utc), doseGiven: "next day, out of window"),
            // PRN: two recent administered doses (one awaiting an outcome), one old record awaiting an outcome,
            // and one recent dose that already has an outcome.
            Admin(201, G(20), p1.Id, null, MedicationAdministrationStatus.Administered, prnNewest, administeredAt: prnNewest, doseGiven: "2 tablets"),
            Admin(202, G(20), p1.Id, null, MedicationAdministrationStatus.Administered, prnOlder, administeredAt: prnOlder, doseGiven: "2 tablets", prnOutcome: "Effective"),
            Admin(203, G(20), p1.Id, null, MedicationAdministrationStatus.Administered, prnOlder.AddDays(-3), administeredAt: prnOlder.AddDays(-3), doseGiven: "2 tablets"));
        db.IncidentReports.Add(new IncidentReport
        {
            Id = G(301), MedicationAdministrationId = G(104), ReportedByUserId = G(900), Title = "Missed dose",
            Description = "Auto-generated for test.", IncidentDateTime = T0, Severity = IncidentSeverity.Low,
            Status = IncidentStatus.Draft, IsActive = true, CreatedAt = T0,
        });
        await db.SaveChangesAsync();

        var controller = new MedicationsController(db, tenant);
        async Task<string> Get(DateOnly date, Guid? participantId)
        {
            var result = await controller.GetMar(date, participantId, CancellationToken.None);
            var ok = Assert.IsType<OkObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<MarDayDto>>(ok.Value);
            return JsonSerializer.Serialize(body.Data, Json).Replace(
                prnNewest.ToString("yyyy-MM-ddTHH:mm:ssZ"), PrnLastDosePlaceholder);
        }
        return (Get, prnNewest);
    }

    private static string GoldenPath(string name) => Path.Combine(AppContext.BaseDirectory, "Medications", "Golden", name);

    private static void AssertGolden(string name, string actual)
    {
        if (Environment.GetEnvironmentVariable("MAR_GOLDEN_WRITE") == "1")
        {
            // Regeneration writes into the SOURCE tree (walk up from bin/ to Odip.Tests).
            var dir = AppContext.BaseDirectory;
            while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.Tests.csproj"))) dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            Assert.NotNull(dir);
            Directory.CreateDirectory(Path.Combine(dir!, "Medications", "Golden"));
            File.WriteAllText(Path.Combine(dir!, "Medications", "Golden", name), actual.Replace("\r\n", "\n"));
            return;
        }
        var expected = File.ReadAllText(GoldenPath(name)).Replace("\r\n", "\n");
        Assert.Equal(expected, actual.Replace("\r\n", "\n"));
    }

    [Fact]
    public async Task GetMar_PastDate_AllParticipants_MatchesGolden()
    {
        var (get, _) = await BuildAsync();
        AssertGolden("mar-2026-01-05-all.json", await get(new DateOnly(2026, 1, 5), null));
    }

    [Fact]
    public async Task GetMar_PastDate_ParticipantFilter_MatchesGolden()
    {
        var (get, _) = await BuildAsync();
        AssertGolden("mar-2026-01-05-p2.json", await get(new DateOnly(2026, 1, 5), G(2)));
    }

    [Fact]
    public async Task GetMar_FarFutureDate_NothingIsOverdue_MatchesGolden()
    {
        var (get, _) = await BuildAsync();
        AssertGolden("mar-2036-01-07-all.json", await get(new DateOnly(2036, 1, 7), null));
    }

    [Fact]
    public async Task GetMar_PastDate_EveryUnrecordedSlotIsOverdue_AndRecordedOnesAreNot()
    {
        var (db, tenant) = CreateDb();
        var p = new Participant { Id = G(1), FirstName = "Sophie", LastName = "Brown", IsActive = true };
        db.Participants.Add(p);
        db.ParticipantMedications.Add(Med(11, p.Id, "Levetiracetam", "08:00,20:00"));
        await db.SaveChangesAsync();
        db.MedicationAdministrations.Add(Admin(101, G(11), p.Id, new DateTime(2026, 1, 5, 8, 0, 0),
            MedicationAdministrationStatus.Administered, T0, administeredAt: T0, doseGiven: "1 tablet"));
        await db.SaveChangesAsync();
        var controller = new MedicationsController(db, tenant);

        var result = await controller.GetMar(new DateOnly(2026, 1, 5), null, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Collection(body.Data!.Entries,
            e => { Assert.Equal("08:00", e.ScheduledTime); Assert.False(e.IsOverdue); },
            e => { Assert.Equal("20:00", e.ScheduledTime); Assert.True(e.IsOverdue); });
    }
}
