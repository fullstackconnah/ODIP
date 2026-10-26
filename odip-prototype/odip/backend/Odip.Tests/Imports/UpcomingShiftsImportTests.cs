using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class UpcomingShiftsImportTests
{
    private const string Header = "NDIS number,Weekday,Start time,End time,Staff email";
    private const string Ndis = "430000001";

    private sealed record World(OdipDbContext Db, Guid TenantId, Guid ParticipantId, Guid StaffId, string StaffEmail, DateOnly Today);

    private static async Task<World> Seed()
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" });
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Mia", LastName = "Test", NdisNumber = Ndis, IsActive = true }).Entity;
        var email = $"{Guid.NewGuid():N}@example.com";
        var staff = db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Ng", Username = Guid.NewGuid().ToString(), Email = email,
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        }).Entity;
        await db.SaveChangesAsync();
        return new World(db, tenantId, participant.Id, staff.Id, email, await ProviderTimeZoneResolver.TodayAsync(db, TimeProvider.System, CancellationToken.None));
    }

    private static ImportShiftOptions Pattern(World w, int weeks) => new(ImportShiftShape.Pattern, w.Today, weeks);

    private static string TodayName(World w) => w.Today.DayOfWeek.ToString();

    private static Task<ImportPreviewDto> Preview(World w, ImportShiftOptions? options, params string[] lines) =>
        Service(w.Db, w.TenantId).PreviewAsync(ImportKind.UpcomingShifts, Csv([Header, .. lines]), "shifts.csv", null, CancellationToken.None, Admin(), options);

    private static Task<ImportResultDto> Commit(World w, ImportShiftOptions? options, string key, params string[] lines) =>
        Service(w.Db, w.TenantId).CommitAsync(ImportKind.UpcomingShifts, Csv([Header, .. lines]), "shifts.csv", null, null, key, Admin(), CancellationToken.None, options);

    [Fact]
    public async Task Preview_expands_a_weekly_pattern_and_writes_nothing()
    {
        var w = await Seed();
        using var _ = w.Db;
        var preview = await Preview(w, Pattern(w, 3), $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,{w.StaffEmail}");

        Assert.Equal((3, 1, 3, 0), (preview.CreateCount, preview.ReadyCount, preview.WeekCount, preview.UnfilledCount));
        Assert.Equal(w.Today, preview.FirstDate);
        Assert.Equal(w.Today.AddDays(14), preview.LastDate);
        Assert.Contains("3 shifts", preview.Rows.Single().Detail);
        Assert.Contains("with Sam Ng", preview.Rows.Single().Detail);
        Assert.Equal(0, await w.Db.Shifts.CountAsync());
        Assert.Equal(0, await w.Db.ImportBatches.CountAsync());
    }

    [Fact]
    public async Task A_missing_shape_or_pattern_start_is_refused_in_words()
    {
        var w = await Seed();
        using var _ = w.Db;
        var line = $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,";
        Assert.Equal(ImportShiftShape.Pattern, Pattern(w, 1).Shape);
        Assert.Equal(OnboardingImportService.ChooseShape, (await Assert.ThrowsAsync<ImportException>(() => Preview(w, null, line))).Message);
        Assert.Equal(OnboardingImportService.ChoosePatternStart,
            (await Assert.ThrowsAsync<ImportException>(() => Preview(w, new ImportShiftOptions(ImportShiftShape.Pattern, null, 4), line))).Message);
        Assert.StartsWith("The pattern can start from today up to",
            (await Assert.ThrowsAsync<ImportException>(() => Preview(w, new ImportShiftOptions(ImportShiftShape.Pattern, w.Today.AddDays(29), 4), line))).Message);
        Assert.StartsWith("The pattern can start from today up to",
            (await Assert.ThrowsAsync<ImportException>(() => Preview(w, new ImportShiftOptions(ImportShiftShape.Pattern, w.Today, 13), line))).Message);
    }

    [Fact]
    public async Task More_than_5000_shifts_is_refused_before_anything_is_written()
    {
        var w = await Seed();
        using var _ = w.Db;
        // 450 rows of a 12 week pattern is 5,400 shifts.
        var lines = Enumerable.Repeat($"{Ndis},{TodayName(w)},9:00 am,3:00 pm,", 450).ToArray();
        var ex = await Assert.ThrowsAsync<ImportException>(() => Commit(w, Pattern(w, 12), "cap", lines));
        Assert.Equal("This makes 5,400 shifts, more than 5,000 at once. Import fewer weeks, or split the file.", ex.Message);
        Assert.Equal(0, await w.Db.ImportBatches.CountAsync());
    }

    [Fact]
    public async Task An_unknown_ndis_number_and_an_unknown_staff_email_are_said_in_words()
    {
        var w = await Seed();
        using var _ = w.Db;
        var preview = await Preview(w, Pattern(w, 1),
            $"430000099,{TodayName(w)},9:00 am,3:00 pm,",
            $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,nobody@example.com");

        Assert.Equal("No participant with NDIS number 430 000 099. Import participants first, or check the number.", Assert.Single(preview.Rows[0].Reasons));
        Assert.Equal(ImportRowStatus.Ready, preview.Rows[1].Status);
        Assert.Contains("No staff member with the email nobody@example.com, so the shift imports unfilled.", preview.Rows[1].Warnings);
        Assert.Equal(1, preview.UnfilledCount);
    }

    [Fact]
    public async Task Commit_saves_drafts_starts_the_week_and_records_the_batch()
    {
        var w = await Seed();
        using var _ = w.Db;
        var result = await Commit(w, Pattern(w, 2), "k1", $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,{w.StaffEmail}");

        Assert.Equal((2, false), (result.CreatedCount, result.Replayed));
        var shifts = await w.Db.Shifts.OrderBy(s => s.ServiceDate).ToListAsync();
        Assert.Equal([w.Today, w.Today.AddDays(7)], shifts.Select(s => s.ServiceDate));
        Assert.All(shifts, s =>
        {
            Assert.Equal((ShiftStatus.Draft, w.ParticipantId, w.StaffId, w.TenantId), (s.Status, s.ParticipantId, s.UserId, s.TenantId));
            Assert.Equal(s.CreatedAt, s.UpdatedAt);
        });
        var firstMonday = w.Today.AddDays(-(((int)w.Today.DayOfWeek + 6) % 7));
        Assert.Equal(firstMonday, result.FirstWeekStart);
        Assert.Contains(await w.Db.RosterWeeks.Select(r => r.WeekStart).ToListAsync(), d => d == firstMonday);
        var batch = await w.Db.ImportBatches.Include(b => b.Items).SingleAsync();
        Assert.Equal(shifts.Select(s => s.Id).Order(), batch.Items.Select(i => i.EntityId).Order());
        Assert.All(batch.Items, i => Assert.Equal(nameof(Shift), i.EntityType));
    }

    [Fact]
    public async Task Importing_the_same_rows_again_skips_what_is_on_the_roster()
    {
        var w = await Seed();
        using var _ = w.Db;
        var line = $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,{w.StaffEmail}";
        await Commit(w, Pattern(w, 2), "k1", line);

        var again = await Preview(w, Pattern(w, 2), line);
        Assert.Equal((0, 1), (again.CreateCount, again.SkippedCount));
        Assert.Equal("Already on the roster.", again.Rows.Single().SkipReason);
        Assert.Equal(2, await w.Db.Shifts.CountAsync());
    }

    [Fact]
    public async Task A_row_repeated_in_the_file_says_which_row_it_repeats()
    {
        var w = await Seed();
        using var _ = w.Db;
        var line = $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,";
        var preview = await Preview(w, Pattern(w, 1), line, line);
        Assert.Equal(ImportRowStatus.Ready, preview.Rows[0].Status);
        Assert.Equal(("Repeats row 2.", 1), (preview.Rows[1].SkipReason, preview.CreateCount));
    }

    [Fact]
    public async Task Commit_with_the_same_key_replays_without_a_second_set_of_shifts()
    {
        var w = await Seed();
        using var _ = w.Db;
        var line = $"{Ndis},{TodayName(w)},9:00 am,3:00 pm,";
        var first = await Commit(w, Pattern(w, 1), "same", line);
        var replay = await Commit(w, Pattern(w, 1), "same", line);
        Assert.Equal((first.BatchId, true), (replay.BatchId, replay.Replayed));
        Assert.NotNull(replay.FirstWeekStart);
        Assert.Equal(1, await w.Db.Shifts.CountAsync());
    }
}
