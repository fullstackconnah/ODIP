using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Odip.Infrastructure.Retention;
using Xunit;

namespace Odip.Tests.DataExport;

/// <summary>"Download their data" before a purge: the ZIP holds the rows the purge would delete for that participant, and nobody else's.</summary>
public class ParticipantExportTests
{
    /// <summary>A participant with a user, a shift, a shift note and an intake snapshot whose PDF bytes name them.</summary>
    internal static Participant Plant(OdipDbContext db, Guid tenantId, string first, string last)
    {
        var user = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Hill", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com", Role = UserRole.SupportWorker };
        var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last, NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged, IsActive = false };
        var shift = new Shift { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, UserId = user.Id, ServiceDate = new DateOnly(2018, 2, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0) };
        db.AddRange(user, p, shift,
            new ShiftNote { Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shift.Id, AuthorUserId = user.Id, AuthorName = "Sam Hill", Body = $"Note about {last}" },
            new ParticipantIntakeSnapshot { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, Revision = 1, CompletedBy = "Sam Hill", RequestId = Guid.NewGuid().ToString(), SnapshotJson = "{}", ContentHash = "h", PdfContent = [1, 2, 3] });
        db.SaveChanges();
        return p;
    }

    private static async Task<System.IO.Compression.ZipArchive> ExportAsync(OdipDbContext db, Guid tenantId, Guid participantId)
    {
        var bytes = new MemoryStream();
        var tables = await ExportTables.ForParticipantAsync(db, tenantId, participantId, CancellationToken.None);
        await DataExportWriter.WriteAsync(bytes, db, tenantId, tables, DataExportTestKit.GeneratedAt, "test-build", CancellationToken.None, participantId);
        bytes.Position = 0;
        return new System.IO.Compression.ZipArchive(bytes, System.IO.Compression.ZipArchiveMode.Read);
    }

    [Fact]
    public async Task The_export_holds_only_that_participants_rows_and_only_their_intake_pdf()
    {
        var tenant = DataExportTestKit.Tenant(null, superAdmin: true);
        var db = DataExportTestKit.InMemory(Guid.NewGuid().ToString(), tenant);
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        db.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha", EmailDomain = "a.example.com" }, new Tenant { Id = b, Name = "Bravo", EmailDomain = "b.example.com" });
        db.SaveChanges();
        var x = Plant(db, a, "Ben", "Xavier");
        var y = Plant(db, a, "Yara", "Zebrowski");
        Plant(db, b, "Cat", "Quillfeather");

        using var zip = await ExportAsync(db, a, x.Id);

        var files = zip.Entries.Select(e => e.FullName).Where(n => n.EndsWith(".csv") && n != DataExportWriter.ManifestName).ToList();
        Assert.Contains("participants.csv", files);
        Assert.Contains("shifts.csv", files);
        Assert.Contains("shift-notes.csv", files);
        Assert.DoesNotContain("staff.csv", files);
        Assert.DoesNotContain("organisation.csv", files);
        Assert.All(files, f => Assert.Contains(f, ExportTables.All.Select(t => t.FileName)));
        Assert.All(files, f =>
        {
            var text = DataExportTestKit.Text(zip, f);
            Assert.DoesNotContain(y.Id.ToString(), text, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Zebrowski", text);
            Assert.DoesNotContain("Quillfeather", text);
        });
        Assert.Single(DataExportTestKit.Csv(zip, "participants.csv").Skip(1));
        Assert.Contains(x.Id.ToString(), DataExportTestKit.Text(zip, "participants.csv"), StringComparison.OrdinalIgnoreCase);
        // The manifest counts equal the CSV rows.
        foreach (var row in DataExportTestKit.Csv(zip, DataExportWriter.ManifestName).Skip(1).Where(r => r[0].EndsWith(".csv")))
            Assert.Equal(DataExportTestKit.Csv(zip, row[0]).Count - 1, int.Parse(row[1]));
        // documents/: X's PDF only.
        var pdf = Assert.Single(zip.Entries, e => e.FullName.StartsWith(ExportTables.DocumentsFolder) && e.Length > 0);
        Assert.Equal($"{ExportTables.DocumentsFolder}{x.Id:D}-intake-r1.pdf", pdf.FullName);
    }

    [Fact]
    public async Task Every_file_comes_from_a_table_the_purge_plan_covers()
    {
        var db = DataExportTestKit.InMemory(Guid.NewGuid().ToString(), DataExportTestKit.Tenant(null, superAdmin: true));
        var a = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = a, Name = "Alpha", EmailDomain = "a.example.com" });
        db.SaveChanges();
        var x = Plant(db, a, "Ben", "Xavier");

        var tables = await ExportTables.ForParticipantAsync(db, a, x.Id, CancellationToken.None);

        Assert.NotEmpty(tables);
        Assert.All(tables, t => Assert.Contains(PurgePlan.Steps, s => s.Entity == t.EntityType));
        Assert.DoesNotContain(tables, t => ExportTables.LeftOut.ContainsKey(t.EntityType));
    }
}
