using System.IO.Compression;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Xunit;

namespace Odip.Tests.DataExport;

/// <summary>Seeding, exporting and reading back a data export. The writer, HTTP and Postgres tests share it.</summary>
internal static class DataExportTestKit
{
    public static readonly DateTime GeneratedAt = new(2026, 10, 14, 4, 4, 0, DateTimeKind.Utc);

    public static ICurrentTenant Tenant(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return tenant.Object;
    }

    public static OdipDbContext InMemory(string name, ICurrentTenant tenant) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options, tenant);

    /// <summary>Runs the whole export into memory, and opens it.</summary>
    public static async Task<ZipArchive> ExportAsync(OdipDbContext db, Guid tenantId)
    {
        var bytes = new MemoryStream();
        await DataExportWriter.WriteAsync(bytes, db, tenantId, ExportTables.All, GeneratedAt, "test-build", CancellationToken.None);
        bytes.Position = 0;
        return new ZipArchive(bytes, ZipArchiveMode.Read);
    }

    public static string Text(ZipArchive zip, string name)
    {
        using var reader = new StreamReader(zip.GetEntry(name)!.Open(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    public static List<string[]> Csv(ZipArchive zip, string name) => ParseCsv(Text(zip, name));

    /// <summary>RFC 4180 records. A quoted field may hold commas, doubled quotes and line breaks, so counting lines would be wrong.</summary>
    public static List<string[]> ParseCsv(string text)
    {
        var records = new List<string[]>();
        var record = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == ',') { record.Add(field.ToString()); field.Clear(); }
            else if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n')
            {
                record.Add(field.ToString()); field.Clear();
                records.Add(record.ToArray()); record.Clear();
                i++;
            }
            else field.Append(c);
        }
        if (field.Length > 0 || record.Count > 0) { record.Add(field.ToString()); records.Add(record.ToArray()); }
        return records;
    }

    /// <summary>What Plant put in for one organisation: its id, its NDIS number, and the id of every row.</summary>
    public sealed record Planted(Guid TenantId, string NdisNumber, IReadOnlyList<Guid> Ids);

    /// <summary>The files Plant puts at least one row in. A scan of an empty file finds no foreign id and proves nothing.</summary>
    public static readonly string[] PlantedFiles =
    [
        "organisation.csv", "staff.csv", "staff-availability.csv", "participants.csv", "participant-intake-snapshots.csv", "contacts.csv",
        "participant-contacts.csv", "support-profiles.csv", "participant-notes.csv", "service-agreements.csv", "service-agreement-lines.csv",
        "service-agreement-blocks.csv", "shifts.csv", "shift-notes.csv", "trips.csv", "trip-days.csv", "scheduled-activities.csv", "bookings.csv",
        "accommodation-properties.csv", "accommodation-reservations.csv", "vehicles.csv", "vehicle-assignments.csv", "staff-assignments.csv",
        "trip-documents.csv", "incidents.csv", "incident-injuries.csv", "incident-witnesses.csv", "claims.csv", "claim-lines.csv",
        "import-batches.csv", "import-batch-items.csv",
    ];

    /// <summary>
    /// One organisation's rows: a row in every table the export reaches through a parent, and in each parent, in the shape
    /// Security/CrossTenantPostgresTests.Plant already proved against PostgreSQL. The Tenant row itself is the caller's to add first.
    /// Both claim kinds are planted, so both sides of the claims rule (trip OR participant) are exercised, and both contact paths too
    /// (a ParticipantContact link, and the plan manager).
    /// </summary>
    public static Planted Plant(OdipDbContext admin, Guid tenantId, string ndis)
    {
        var linked = new Contact { Id = Guid.NewGuid(), FirstName = "Pat", LastName = "Linked" };
        var planManager = new Contact { Id = Guid.NewGuid(), FirstName = "Pam", LastName = "Manager" };
        var user = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker };
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = ndis, PlanType = PlanType.SelfManaged, PlanManagerContactId = planManager.Id };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 };
        var property = new AccommodationProperty { Id = Guid.NewGuid(), TenantId = tenantId, PropertyName = "Beach house" };
        var vehicle = new Vehicle { Id = Guid.NewGuid(), TenantId = tenantId, VehicleName = "Van", TotalSeats = 8 };
        var batch = new ImportBatch { Id = Guid.NewGuid(), TenantId = tenantId, Kind = ImportKind.Participants, FileName = "people.csv", IdempotencyKey = Guid.NewGuid().ToString(), CreatedByName = "Sam Hill" };
        admin.AddRange(linked, planManager, user, participant, trip, property, vehicle, batch);
        admin.SaveChanges();

        var booking = new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) };
        var tripClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 480m };
        var shiftClaim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = participant.Id, ClaimReference = $"SC-{Guid.NewGuid():N}"[..20], TotalAmount = 0m };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = tripClaim.Id, ParticipantBookingId = booking.Id, SupportItemCode = "01_002_0117_1_1", DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = new DateOnly(2026, 2, 1), SupportsDeliveredTo = new DateOnly(2026, 2, 1), Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
        };
        var vehicleAssignment = new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = vehicle.Id };
        var staffAssignment = new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = user.Id, AssignmentStart = new DateOnly(2026, 2, 1), AssignmentEnd = new DateOnly(2026, 2, 3) };
        var availability = new StaffAvailability { Id = Guid.NewGuid(), UserId = user.Id, StartDateTime = new DateTime(2026, 9, 1), EndDateTime = new DateTime(2026, 9, 2), AvailabilityType = AvailabilityType.Unavailable };
        var day = new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1, Date = trip.StartDate, DayTitle = "Day one" };
        var activity = new ScheduledActivity { Id = Guid.NewGuid(), TripDayId = day.Id, Title = "Beach walk" };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = user.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.Low, Title = "Fall", Description = "Slipped",
            IncidentDateTime = new DateTime(2026, 8, 30, 9, 0, 0, DateTimeKind.Utc),
        };
        var injury = new IncidentInjury { Id = Guid.NewGuid(), IncidentReportId = incident.Id, Description = "Graze" };
        var witness = new IncidentWitness { Id = Guid.NewGuid(), IncidentReportId = incident.Id, WitnessName = "Alex" };
        var profile = new SupportProfile { Id = Guid.NewGuid(), ParticipantId = participant.Id, BehaviourSupportNotes = "private" };
        var reservation = new AccommodationReservation { Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = property.Id, CheckInDate = new DateOnly(2026, 2, 1), CheckOutDate = new DateOnly(2026, 2, 3) };
        var document = new TripDocument { Id = Guid.NewGuid(), TripInstanceId = trip.Id, FileName = "itinerary.pdf" };
        var link = new ParticipantContact { ParticipantId = participant.Id, ContactId = linked.Id };
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = 1, State = "NSW", ParticipantNameSnapshot = "Ben Lee",
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30),
        };
        var draftLine = new ServiceAgreementDraftLine { Id = Guid.NewGuid(), DraftId = draft.Id, ServiceType = "CommunityAccess", Hours = 2m, ItemCode = "04_104_0125_6_1", CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1), UnitPrice = 70m };
        var draftBlock = new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, BlockKey = "b1" };
        var batchItem = new ImportBatchItem { Id = Guid.NewGuid(), BatchId = batch.Id, EntityType = "Participant", EntityId = participant.Id };
        var shift = new Shift { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = user.Id, ServiceDate = new DateOnly(2026, 2, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0) };
        var shiftNote = new ShiftNote { Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shift.Id, AuthorUserId = user.Id, AuthorName = "Sam Hill", Body = "Went well" };
        var note = new ParticipantNote { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Title = "Note", Description = "Private", CreatedByName = "Sam Hill" };
        var intake = new ParticipantIntakeSnapshot
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Revision = 1, CompletedAtUtc = DateTime.UtcNow, CompletedBy = "Sam Hill",
            RequestId = Guid.NewGuid().ToString(), SnapshotJson = "{}", ContentHash = "hash", PdfContent = Encoding.ASCII.GetBytes("%PDF-1.4 " + tenantId),
        };
        admin.AddRange(booking, tripClaim, shiftClaim, line, vehicleAssignment, staffAssignment, availability, day, activity, incident, injury, witness,
            profile, reservation, document, link, draft, draftLine, draftBlock, batchItem, shift, shiftNote, note, intake);
        admin.SaveChanges();

        return new Planted(tenantId, ndis,
        [
            tenantId, linked.Id, planManager.Id, user.Id, participant.Id, trip.Id, property.Id, vehicle.Id, batch.Id, booking.Id, tripClaim.Id, shiftClaim.Id,
            line.Id, vehicleAssignment.Id, staffAssignment.Id, availability.Id, day.Id, activity.Id, incident.Id, injury.Id, witness.Id, profile.Id,
            reservation.Id, document.Id, draft.Id, draftLine.Id, draftBlock.Id, batchItem.Id, shift.Id, shiftNote.Id, note.Id, intake.Id,
        ]);
    }

    /// <summary>
    /// The export of <paramref name="own"/> holds every one of its planted rows (each planted file has at least one, and every planted id appears),
    /// and not one id, or the NDIS number, of <paramref name="other"/> appears in any entry, file names included.
    /// </summary>
    public static void AssertHoldsOnly(ZipArchive zip, Planted own, Planted other)
    {
        var everything = new StringBuilder();
        foreach (var entry in zip.Entries)
        {
            using var reader = new StreamReader(entry.Open(), Encoding.UTF8);
            everything.Append(entry.FullName).Append('\n').Append(reader.ReadToEnd()).Append('\n');
        }
        var text = everything.ToString();

        var leaked = other.Ids.Select(id => id.ToString("D")).Append(other.NdisNumber).Where(text.Contains).ToList();
        Assert.True(leaked.Count == 0, "The export holds another organisation's rows: " + string.Join(", ", leaked));
        var missing = own.Ids.Select(id => id.ToString("D")).Where(id => !text.Contains(id)).ToList();
        Assert.True(missing.Count == 0, "The export is missing the organisation's own rows: " + string.Join(", ", missing));
        Assert.All(PlantedFiles, file => Assert.True(Csv(zip, file).Count > 1, $"{file} holds no rows, so it proves nothing"));
    }
}
