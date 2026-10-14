using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DataExport;
using Xunit;

namespace Odip.Tests.DataExport;

public class ExportTablesTests
{
    private static readonly IModel Model = BuildModel();

    // The Npgsql model, as production builds it (provider-only properties included); building it opens no connection, as in ParticipantQueriesSqlTests.
    private static IModel BuildModel()
    {
        using var db = NpgsqlContext();
        return db.Model;
    }

    private static OdipDbContext NpgsqlContext() => new(new DbContextOptionsBuilder<OdipDbContext>()
        .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres").Options, new Mock<ICurrentTenant>().Object);

    private static ExportTable Table<T>() => ExportTables.All.Single(t => t.EntityType == typeof(T));

    [Fact]
    public void A_csv_query_never_reads_a_byte_array_column_but_still_reads_every_column_it_writes()
    {
        // The intake PDFs are read once, for documents/; the CSV pass reading them too doubled the bytes through the database.
        using var db = NpgsqlContext();
        var withBytes = ExportTables.All.Where(t => Model.FindEntityType(t.EntityType)!.GetProperties().Any(p => p.ClrType == typeof(byte[]))).ToList();
        Assert.Contains(withBytes, t => t.EntityType == typeof(ParticipantIntakeSnapshot));
        foreach (var table in withBytes)
        {
            var entity = Model.FindEntityType(table.EntityType)!;
            var sql = table.Rows(db, Guid.NewGuid()).ToQueryString(); // translation only: no connection is opened
            foreach (var p in entity.GetProperties().Where(p => p.ClrType == typeof(byte[])))
                Assert.DoesNotContain($"\"{p.GetColumnName()}\"", sql);
            foreach (var column in ExportTables.Columns(Model, table))
                Assert.Contains($"\"{entity.FindProperty(column.Name)!.GetColumnName()}\"", sql);
        }
    }

    [Fact]
    public void Every_entity_in_the_model_is_exported_or_deliberately_left_out()
    {
        var model = Model.GetEntityTypes().Select(e => e.ClrType).ToHashSet();
        var exported = ExportTables.All.Select(t => t.EntityType).ToList();
        var leftOut = ExportTables.LeftOut.Keys.ToList();

        var neither = model.Except(exported).Except(leftOut).Select(t => t.Name).OrderBy(n => n, StringComparer.Ordinal).ToList();
        Assert.True(neither.Count == 0,
            "Neither exported nor left out. Add each to ExportTables.All with its tenant scope (through a tenant-owned parent when it has no TenantId), "
            + "or to ExportTables.LeftOut with the reason the README gives: " + string.Join(", ", neither));
        Assert.Empty(exported.Intersect(leftOut));
        Assert.Empty(exported.Concat(leftOut).Except(model));
        Assert.Equal(exported.Count, exported.Distinct().Count());
        Assert.Equal((69, 8), (exported.Count, leftOut.Count)); // adding the Employment Hero secret store to LeftOut makes this (69, 9)
    }

    [Fact]
    public void File_names_are_unique_csv_names_and_every_table_and_every_omission_says_why()
    {
        Assert.Equal(ExportTables.All.Count, ExportTables.All.Select(t => t.FileName).Distinct().Count());
        Assert.All(ExportTables.All, t =>
        {
            Assert.Matches("^[a-z0-9-]+[.]csv$", t.FileName);
            Assert.False(string.IsNullOrWhiteSpace(t.Description));
            Assert.All(t.Omit.Values, why => Assert.False(string.IsNullOrWhiteSpace(why)));
        });
        Assert.All(ExportTables.LeftOut.Values, why => Assert.False(string.IsNullOrWhiteSpace(why)));
    }

    private static readonly HashSet<Type> Writable = new()
    {
        typeof(string), typeof(Guid), typeof(bool), typeof(short), typeof(int), typeof(long), typeof(decimal), typeof(double), typeof(float),
        typeof(DateTime), typeof(DateTimeOffset), typeof(DateOnly), typeof(TimeOnly), typeof(List<string>), typeof(byte[]),
    };

    [Fact]
    public void Every_column_of_every_exported_table_can_be_read_from_an_untracked_row_and_written()
    {
        var problems = new List<string>();
        foreach (var table in ExportTables.All)
        {
            var entity = Model.FindEntityType(table.EntityType)!;
            foreach (var p in entity.GetProperties())
            {
                var type = Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType;
                if (p.IsShadowProperty()) problems.Add($"{entity.ClrType.Name}.{p.Name} is a shadow property: an untracked row has no value for it");
                else if (!type.IsEnum && !Writable.Contains(type)) problems.Add($"{entity.ClrType.Name}.{p.Name} is a {type.Name}: give ExportValue a format for it");
            }
            foreach (var omitted in table.Omit.Keys)
                if (entity.FindProperty(omitted) is null) problems.Add($"{table.FileName} omits {omitted}, which is not one of its columns");
        }
        Assert.True(problems.Count == 0, string.Join("\n", problems));
    }

    [Fact]
    public void The_local_time_columns_are_these_twelve_and_every_other_DateTime_is_an_instant()
    {
        var wallClock = ExportTables.All
            .SelectMany(t => Model.FindEntityType(t.EntityType)!.GetProperties().Where(ExportTables.IsWallClock).Select(p => $"{t.EntityType.Name}.{p.Name}"))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(new[]
        {
            "IncidentReport.FamilyNotifiedAt", "IncidentReport.IncidentDateTime", "IncidentReport.QscReportedAt", "IncidentReport.SupportCoordinatorNotifiedAt",
            "MedicationAdministration.ScheduledAt",
            "ParticipantMedication.ConsentDate", "ParticipantMedication.EndDate", "ParticipantMedication.NextReviewDue", "ParticipantMedication.StartDate",
            "ShiftRoutineCheck.ScheduledAt",
            "StaffAvailability.EndDateTime", "StaffAvailability.StartDateTime",
        }, wallClock);
    }

    [Fact]
    public void The_family_link_secret_and_the_pdf_bytes_are_not_columns_but_screening_numbers_are()
    {
        Assert.DoesNotContain(ExportTables.Columns(Model, Table<CaregiverProfileSubmission>()), c => c.Name == nameof(CaregiverProfileSubmission.TokenHash));
        Assert.DoesNotContain(ExportTables.Columns(Model, Table<ParticipantIntakeSnapshot>()), c => c.Name == nameof(ParticipantIntakeSnapshot.PdfContent));
        Assert.DoesNotContain(ExportTables.Columns(Model, Table<TripDocument>()), c => c.Name == nameof(TripDocument.FilePath)); // a server-side path
        Assert.Contains(ExportTables.Columns(Model, Table<User>()), c => c.Name == nameof(User.WorkerScreeningNumber)); // the provider's own data (spec)
        Assert.Equal("Id", ExportTables.Columns(Model, Table<Participant>())[0].Name);
    }

    /// <summary>
    /// Exported columns whose names look like a secret, each with why it isn't one. A new token, hash, password, cipher or key column fails the
    /// next test until it is left out (ExportTable.Omit, with the reason the README gives) or listed here.
    /// </summary>
    private static readonly Dictionary<string, string> NotSecrets = new()
    {
        ["ElectronicSigningSnapshot.DocumentHash"] = "the hash of the agreement as sent for signing: integrity evidence",
        ["ElectronicSigningEvidence.EvidenceHash"] = "the signing evidence chain: integrity evidence",
        ["ElectronicSigningEvidence.PreviousEvidenceHash"] = "the signing evidence chain: integrity evidence",
        ["ElectronicSigningEvidence.IdempotencyKey"] = "the signing page's retry key, part of the evidence it hashes; it grants nothing",
        ["ParticipantIntakeSnapshot.ContentHash"] = "the hash of a completed intake: integrity evidence",
        ["ImportBatch.IdempotencyKey"] = "a browser's retry key for one Import click; it grants nothing",
        ["MedicationAdministration.IdempotencyKey"] = "a browser's retry key for one dose record; it grants nothing",
        ["BookingTask.SourceKey"] = "names the rule that made the task, such as leave-coverage:<shift>:<leave>",
        ["ParticipantNote.SourceKey"] = "names the field group a system note came from, such as safety:allergies",
        ["ServiceAgreementDraftBlock.BlockKey"] = "a block's name inside its agreement",
        ["ServiceAgreementDraftLine.BlockKey"] = "a block's name inside its agreement",
        ["ShiftPattern.SourceBlockKey"] = "a block's name inside its agreement",
    };

    [Fact]
    public void No_exported_column_looks_like_a_secret_unless_it_is_listed_with_why_it_is_not_one()
    {
        var looksSecret = new Regex("hash|token|secret|password|passphrase|cipher|encrypt|credential|salt|nonce|otp|jwt|apikey|key$", RegexOptions.IgnoreCase);
        var flagged = ExportTables.All
            .SelectMany(t => ExportTables.Columns(Model, t).Where(c => looksSecret.IsMatch(c.Name)).Select(c => $"{t.EntityType.Name}.{c.Name}"))
            .ToList();

        var unexplained = flagged.Where(name => !NotSecrets.ContainsKey(name)).ToList();
        Assert.True(unexplained.Count == 0,
            "These columns look like secrets. Leave each out (ExportTable.Omit, with the reason the README gives) or add it to NotSecrets with why it isn't one: "
            + string.Join(", ", unexplained));
        Assert.Empty(NotSecrets.Keys.Except(flagged)); // an entry for a column that is gone, or already left out, is stale
        Assert.All(NotSecrets.Values, why => Assert.False(string.IsNullOrWhiteSpace(why)));
    }

    [Fact]
    public void A_table_of_secrets_or_credentials_is_never_exported()
    {
        // Employment Hero PR 1 adds an encrypted per-tenant integration secret store: it belongs in ExportTables.LeftOut, never in All.
        var looksSecret = new Regex("secret|credential|token|password|apikey", RegexOptions.IgnoreCase);
        Assert.Empty(ExportTables.All.Where(t => looksSecret.IsMatch(t.EntityType.Name)).Select(t => t.EntityType.Name));
    }
}
