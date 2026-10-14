using System.Globalization;
using System.Text;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Xunit;

namespace Odip.Tests.DataExport;

public class DataExportWriterTests
{
    private static async Task<(OdipDbContext Db, Guid TenantId)> NewOrganisationAsync()
    {
        var tenantId = Guid.NewGuid();
        var db = DataExportTestKit.InMemory(Guid.NewGuid().ToString(), DataExportTestKit.Tenant(tenantId));
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Sunrise Care", EmailDomain = "sunrise.example.com" });
        await db.SaveChangesAsync();
        return (db, tenantId);
    }

    private static string Cell(List<string[]> csv, string column, int row = 1) => csv[row][Array.IndexOf(csv[0], column)];

    [Fact]
    public async Task A_new_organisation_gets_every_file_with_only_its_header_and_zero_counts()
    {
        var (db, tenantId) = await NewOrganisationAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        Assert.Equal(DataExportWriter.ManifestName, zip.Entries[^1].FullName);
        var manifest = DataExportTestKit.Csv(zip, DataExportWriter.ManifestName);
        Assert.Equal(new[] { "file", "rows", "generated_at", "odip_build" }, manifest[0]);
        Assert.Equal(ExportTables.All.Select(t => t.FileName).Append(ExportTables.DocumentsFolder), manifest.Skip(1).Select(r => r[0]));
        Assert.All(manifest.Skip(1), r => Assert.Equal((r[0] == "organisation.csv" ? "1" : "0", "2026-10-14T04:04:00Z", "test-build"), (r[1], r[2], r[3])));
        Assert.All(ExportTables.All, t => Assert.Equal(ExportTables.Columns(db.Model, t).Select(c => c.Name), DataExportTestKit.Csv(zip, t.FileName)[0]));
        Assert.NotNull(zip.GetEntry(DataExportWriter.ReadmeName));
    }

    [Fact]
    public async Task The_manifest_counts_every_row_written_even_when_text_holds_line_breaks()
    {
        var (db, tenantId) = await NewOrganisationAsync();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sienna", LastName = "Patel", NdisNumber = "431000001" };
        db.Participants.Add(participant);
        for (var i = 0; i < 25; i++)
            db.ParticipantNotes.Add(new ParticipantNote { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Title = $"Note {i}", Description = $"Line one, \"quoted\"\r\nline two {i}", CreatedByName = "Jordan Lee" });
        await db.SaveChangesAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        var counts = DataExportTestKit.Csv(zip, DataExportWriter.ManifestName).Skip(1).ToDictionary(r => r[0], r => int.Parse(r[1], CultureInfo.InvariantCulture));
        Assert.Equal((25, 1), (counts["participant-notes.csv"], counts["participants.csv"]));
        Assert.All(ExportTables.All, t => Assert.Equal(counts[t.FileName], DataExportTestKit.Csv(zip, t.FileName).Count - 1));
    }

    [Fact]
    public async Task Values_are_written_by_their_kind_and_text_round_trips()
    {
        var (db, tenantId) = await NewOrganisationAsync();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sienna", LastName = "Patel", NdisNumber = "431000001", PlanType = PlanType.SelfManaged, OtherDiagnoses = ["Asthma", "Café allergy"] };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 };
        var medication = new ParticipantMedication { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Name = "Paracetamol", DoseDescription = "500 mg", StartDate = new DateTime(2026, 10, 3) };
        db.AddRange(participant, trip, medication,
            new MedicationAdministration { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantMedicationId = medication.Id, ParticipantId = participant.Id, ScheduledAt = new DateTime(2026, 10, 3, 8, 0, 0), AdministeredAt = new DateTime(2026, 10, 2, 22, 5, 0), RecordedByName = "Jordan Lee" },
            new Shift { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ServiceDate = new DateOnly(2026, 10, 3), StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(16, 30) },
            new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, ClaimReference = "TC-ADJUSTMENT", TotalAmount = -12.50m },
            new ParticipantNote { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Title = "Line one, \"quoted\"\r\nline two", Description = "=HYPERLINK(\"http://evil\",\"x\")", CreatedByName = "Jordan Lee" });
        await db.SaveChangesAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        var participants = DataExportTestKit.Csv(zip, "participants.csv");
        var notes = DataExportTestKit.Csv(zip, "participant-notes.csv");
        var doses = DataExportTestKit.Csv(zip, "medication-administrations.csv");
        var shifts = DataExportTestKit.Csv(zip, "shifts.csv");
        Assert.Equal(participant.Id.ToString("D"), Cell(participants, "Id"));
        Assert.Equal("SelfManaged", Cell(participants, "PlanType"));
        Assert.Equal("[\"Asthma\",\"Café allergy\"]", Cell(participants, "OtherDiagnoses"));
        Assert.Equal("'=HYPERLINK(\"http://evil\",\"x\")", Cell(notes, "Description"));
        Assert.Equal("Line one, \"quoted\"\r\nline two", Cell(notes, "Title"));
        Assert.Equal("2026-10-03T00:00:00", Cell(DataExportTestKit.Csv(zip, "medications.csv"), "StartDate"));
        Assert.Equal(("2026-10-03T08:00:00", "2026-10-02T22:05:00Z"), (Cell(doses, "ScheduledAt"), Cell(doses, "AdministeredAt")));
        Assert.Equal(("2026-10-03", "08:00:00", "16:30:00"), (Cell(shifts, "ServiceDate"), Cell(shifts, "StartTime"), Cell(shifts, "EndTime")));
        Assert.Equal("-12.50", Cell(DataExportTestKit.Csv(zip, "claims.csv"), "TotalAmount"));
        Assert.StartsWith("\uFEFF", Encoding.UTF8.GetString(ReadAll(zip, "participants.csv")));
    }

    private static byte[] ReadAll(System.IO.Compression.ZipArchive zip, string name)
    {
        using var bytes = new MemoryStream();
        using (var entry = zip.GetEntry(name)!.Open()) entry.CopyTo(bytes);
        return bytes.ToArray();
    }

    [Fact]
    public async Task Each_intake_revision_is_one_pdf_under_documents_and_the_csv_holds_no_bytes()
    {
        var (db, tenantId) = await NewOrganisationAsync();
        var participantId = Guid.NewGuid();
        db.Participants.Add(new Participant { Id = participantId, TenantId = tenantId, FirstName = "Sienna", LastName = "Patel", NdisNumber = "431000002" });
        foreach (var revision in new[] { 1, 2 })
            db.ParticipantIntakeSnapshots.Add(new ParticipantIntakeSnapshot
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, Revision = revision, CompletedAtUtc = DataExportTestKit.GeneratedAt, CompletedBy = "Jordan Lee",
                RequestId = $"request-{revision}", SnapshotJson = "{}", ContentHash = $"hash-{revision}", PdfContent = Encoding.ASCII.GetBytes($"%PDF-1.4 revision {revision}"),
            });
        await db.SaveChangesAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        foreach (var revision in new[] { 1, 2 })
            Assert.Equal($"%PDF-1.4 revision {revision}", Encoding.ASCII.GetString(ReadAll(zip, $"documents/{participantId:D}-intake-r{revision}.pdf")));
        var snapshots = DataExportTestKit.Csv(zip, "participant-intake-snapshots.csv");
        Assert.DoesNotContain("PdfContent", snapshots[0]);
        Assert.Equal(3, snapshots.Count);
        Assert.Equal("2", DataExportTestKit.Csv(zip, DataExportWriter.ManifestName).Single(r => r[0] == ExportTables.DocumentsFolder)[1]);
    }

    [Fact]
    public async Task The_readme_opens_by_saying_the_zip_holds_personal_and_health_information_and_how_to_keep_it()
    {
        var (db, tenantId) = await NewOrganisationAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        // The ZIP travels without the Settings tab, so its own first words carry the warning.
        Assert.StartsWith(
            "ODIP data export\r\n"
            + "This export holds personal and health information about participants and staff, for example in participants.csv, medications.csv, "
            + "participant-health-conditions.csv, restrictive-practices.csv, incidents.csv and staff.csv. "
            + "Store it securely and share it only with people who need it.\r\n",
            DataExportTestKit.Text(zip, DataExportWriter.ReadmeName));
        foreach (var file in new[] { "participants.csv", "medications.csv", "participant-health-conditions.csv", "restrictive-practices.csv", "incidents.csv", "staff.csv" })
            Assert.Contains(ExportTables.All, t => t.FileName == file); // every file it names is one the ZIP has
    }

    [Fact]
    public async Task The_readme_names_every_file_everything_left_out_and_the_local_time_columns()
    {
        var (db, tenantId) = await NewOrganisationAsync();

        using var zip = await DataExportTestKit.ExportAsync(db, tenantId);

        var readme = DataExportTestKit.Text(zip, DataExportWriter.ReadmeName);
        Assert.All(ExportTables.All, t => Assert.Contains($"{t.FileName}: {t.Description}", readme));
        Assert.All(ExportTables.LeftOut.Values, why => Assert.Contains(why, readme));
        Assert.Contains("caregiver-submissions.csv leaves out TokenHash", readme);
        Assert.Contains("  medication-administrations.csv: ScheduledAt", readme);
        Assert.Contains("  incidents.csv: IncidentDateTime", readme);
        Assert.DoesNotContain("  medication-administrations.csv: AdministeredAt", readme);
        Assert.Contains("Sign-in accounts", readme);
        Assert.Contains("test-build", readme);
    }

    [Fact]
    public async Task Every_table_is_scoped_by_its_own_predicate_so_no_other_organisation_leaks_even_with_the_filter_off()
    {
        var name = Guid.NewGuid().ToString();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        DataExportTestKit.Planted own, other;
        await using (var admin = DataExportTestKit.InMemory(name, DataExportTestKit.Tenant(null, superAdmin: true)))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha Care", EmailDomain = "alpha.example.com" }, new Tenant { Id = b, Name = "Bravo Care", EmailDomain = "bravo.example.com" });
            admin.SaveChanges();
            other = DataExportTestKit.Plant(admin, b, "43100000001");
            own = DataExportTestKit.Plant(admin, a, "43100000002");
        }

        // As the organisation (the filter on), and as a SuperAdmin with no organisation (every filter off): the result must be the same.
        foreach (var superAdmin in new[] { false, true })
        {
            await using var db = DataExportTestKit.InMemory(name, DataExportTestKit.Tenant(superAdmin ? null : a, superAdmin));
            using var zip = await DataExportTestKit.ExportAsync(db, a);
            DataExportTestKit.AssertHoldsOnly(zip, own, other);
        }
    }
}
