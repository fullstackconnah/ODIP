using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>The preview's roster and budget warnings, on the ledger fixtures: clock 4 Oct 2026 (a Sunday), NSW weekdays at $60 an hour.</summary>
public class UpcomingShiftsPreviewTests : IDisposable
{
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private readonly LedgerKit _kit = LedgerKit.Create();

    public void Dispose() => _kit.Dispose();

    private Task<ImportPreviewDto> Preview(int weeks, params string[] lines) =>
        Service(_kit.Db, _kit.TenantId, _kit.Clock, _kit.Ledger).PreviewAsync(ImportKind.UpcomingShifts, Csv(["NDIS number,Weekday,Start time,End time,Staff email", .. lines]), "roster.csv", null,
            CancellationToken.None, Admin(), new ImportShiftOptions(ImportShiftShape.Pattern, Mon12Oct, weeks));

    [Fact]
    public async Task Preview_SameWorkerOverlapInFile_WarnsDoubleBooked()
    {
        _kit.SeedProvider("NSW");
        var mia = _kit.SeedParticipant(first: "Mia");
        var jo = _kit.SeedParticipant(first: "Jo");
        _kit.Db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, FirstName = "Sam", LastName = "Ng", Username = "sam", Email = "sam@example.com", Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        });
        await _kit.Db.SaveChangesAsync();

        var preview = await Preview(1, $"{mia.NdisNumber},Monday,9:00 am,3:00 pm,sam@example.com", $"{jo.NdisNumber},Monday,12:00 pm,6:00 pm,sam@example.com");

        Assert.All(preview.Rows, r => Assert.Equal(ImportRowStatus.Ready, r.Status));
        // The second row is judged against the first: without a final id on each candidate before Check, the rule would skip them all.
        Assert.Contains("Sam Ng already has a shift on", Assert.Single(preview.Rows[1].Warnings));
        Assert.Contains("overlaps this one", preview.Rows[1].Warnings[0]);
        Assert.Empty(preview.Rows[0].Warnings);
    }

    [Fact]
    public async Task Preview_OverBudget_WarnsAndStillImports()
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant(PlanType.PlanManaged);
        _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000m), LedgerKit.Q(3, 5000m)));

        // Three Mondays of 9 to 5 is $1,440 against $1,000: a warning, never a refusal.
        var preview = await Preview(3, $"{participant.NdisNumber},Monday,9:00 am,5:00 pm,");

        var row = Assert.Single(preview.Rows);
        Assert.Equal((ImportRowStatus.Ready, 3), (row.Status, preview.CreateCount));
        Assert.Contains(row.Warnings, w => w.Contains("budget over by"));
    }
}
