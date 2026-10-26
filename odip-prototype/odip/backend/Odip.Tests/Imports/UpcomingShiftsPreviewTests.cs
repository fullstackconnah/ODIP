using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
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

    private void SeedWorker(string email, string first, string last, DateOnly screeningExpiry)
    {
        _kit.Db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = _kit.TenantId, FirstName = first, LastName = last, Username = Guid.NewGuid().ToString(), Email = email, Role = UserRole.SupportWorker,
            Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = screeningExpiry,
        });
        _kit.Db.SaveChanges();
    }

    [Fact]
    public async Task Preview_WscExpired_RefusesThoseDatesOnly()
    {
        _kit.SeedProvider("NSW");
        var mia = _kit.SeedParticipant(first: "Mia");
        SeedWorker("sam@example.com", "Sam", "Ng", Mon12Oct.AddDays(7));

        // Screening runs out after Mon 19 Oct: the pattern row stays Ready with the third Monday refused, and a dated row on that Monday can't import at all.
        var pattern = await Preview(3, $"{mia.NdisNumber},Monday,9:00 am,3:00 pm,sam@example.com");
        var row = Assert.Single(pattern.Rows);
        Assert.Equal((ImportRowStatus.Ready, 2), (row.Status, pattern.CreateCount));
        Assert.Contains(row.Warnings, w => w.StartsWith("1 of 3 shifts can't be imported (Mon 26 Oct)"));

        var dated = await Service(_kit.Db, _kit.TenantId, _kit.Clock, _kit.Ledger).PreviewAsync(ImportKind.UpcomingShifts,
            Csv("NDIS number,Date,Start time,End time,Staff email", $"{mia.NdisNumber},2026-10-26,9:00 am,3:00 pm,sam@example.com"), "roster.csv", null,
            CancellationToken.None, Admin(), new ImportShiftOptions(ImportShiftShape.Dated, null, null));
        Assert.Equal((ImportRowStatus.Invalid, 0), (Assert.Single(dated.Rows).Status, dated.CreateCount));
    }

    [Fact]
    public async Task Preview_RefusedRow_DoesNotMakeALaterRowForTheSameSlotARepeat()
    {
        _kit.SeedProvider("NSW");
        var mia = _kit.SeedParticipant(first: "Mia");
        SeedWorker("old@example.com", "Old", "Screening", Mon12Oct.AddDays(-1));
        SeedWorker("new@example.com", "New", "Screening", new DateOnly(2035, 1, 1));

        var preview = await Preview(1, $"{mia.NdisNumber},Monday,9:00 am,3:00 pm,old@example.com", $"{mia.NdisNumber},Monday,9:00 am,3:00 pm,new@example.com");

        Assert.Equal((ImportRowStatus.Invalid, ImportRowStatus.Ready, 1), (preview.Rows[0].Status, preview.Rows[1].Status, preview.CreateCount));
    }

    [Fact]
    public async Task Preview_EnforceMode_NotReadyParticipantRowsInvalid()
    {
        var settings = _kit.SeedProvider("NSW");
        var mia = _kit.SeedParticipant(first: "Mia");
        var line = $"{mia.NdisNumber},Monday,9:00 am,3:00 pm,";

        var warn = await Preview(1, line);
        Assert.Equal((ImportRowStatus.Ready, false), (Assert.Single(warn.Rows).Status, warn.ReadinessEnforced));

        settings.ParticipantReadinessMode = ParticipantReadinessMode.Enforce;
        await _kit.Db.SaveChangesAsync();
        var enforce = await Preview(1, line);
        var row = Assert.Single(enforce.Rows);
        Assert.Equal((ImportRowStatus.Invalid, true, 0), (row.Status, enforce.ReadinessEnforced, enforce.CreateCount));
        Assert.Contains(ParticipantReadinessGate.NotReadyMessage, row.Reasons);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Commit_HardLimitOverBudget_ImportsWithReasonAndCode(bool hardLimit)
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant(PlanType.PlanManaged);
        _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000m), LedgerKit.Q(3, 5000m)));
        _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = _kit.TenantId, Mode = hardLimit ? BudgetLimitMode.HardLimit : BudgetLimitMode.Warn });
        await _kit.Db.SaveChangesAsync();

        await Service(_kit.Db, _kit.TenantId, _kit.Clock, _kit.Ledger).CommitAsync(ImportKind.UpcomingShifts, Csv("NDIS number,Weekday,Start time,End time", $"{participant.NdisNumber},Monday,9:00 am,5:00 pm"),
            "roster.csv", null, null, "over", Admin(), CancellationToken.None, new ImportShiftOptions(ImportShiftShape.Pattern, Mon12Oct, 3));

        var shifts = await _kit.Db.Shifts.ToListAsync();
        Assert.Equal(3, shifts.Count);
        if (hardLimit)
            Assert.All(shifts, s => Assert.Equal(("Imported from roster.csv", true), (s.OverrideReason, s.AcknowledgedFindingCodes!.Contains(BudgetFindingCodes.ForecastOver))));
        else
            Assert.All(shifts, s => Assert.Equal((null, false), (s.OverrideReason, s.AcknowledgedFindingCodes?.Contains(BudgetFindingCodes.ForecastOver) ?? false)));
    }
}
