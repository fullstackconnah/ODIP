using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class ImportInvitesTests
{
    private sealed class ListLogger<T> : ILogger<T>
    {
        public List<(LogLevel Level, string Text)> Entries { get; } = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception)));
    }

    private static async Task<(OdipDbContext Db, ImportsController Controller, Mock<IFirebaseUserService> Firebase, Guid BatchId, Guid TenantId)> StaffImportedAsync(string? dbName = null)
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(dbName ?? Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.Staff, Csv("First name,Last name,Email", "Jo,Ng,jo@example.com", "Al,Wu,al@example.com", "Bo,Li,bo@example.com"),
            "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);
        (await db.Users.SingleAsync(u => u.Email == "bo@example.com")).LastLoginAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(SignInAccountResult.Created);
        firebase.Setup(f => f.EnsureSignInAccountAsync("al@example.com", It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("no Firebase app"));
        return (db, Controller(db, tenantId, firebase.Object), firebase, result.BatchId, tenantId);
    }

    private static ImportsController Controller(OdipDbContext db, Guid tenantId, IFirebaseUserService firebase, ILogger<ImportsController>? logger = null) =>
        new(Service(db, tenantId), firebase, null, logger)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = Admin() } },
        };

    [Fact]
    public async Task Invites_set_up_an_account_for_each_staff_member_who_never_signed_in_and_report_each_one()
    {
        var (db, controller, firebase, batchId, _) = await StaffImportedAsync();
        using var _ = db;

        var answer = Assert.IsType<OkObjectResult>((await controller.Invites(batchId, null, CancellationToken.None)).Result);
        var invites = Assert.IsType<ApiResponse<ImportInvitesDto>>(answer.Value).Data!.Invites.OrderBy(i => i.Email).ToList();

        Assert.Equal(new[] { "al@example.com", "jo@example.com" }, invites.Select(i => i.Email));
        Assert.Equal(((string?)null, "Unable to set up the staff member's sign-in account. If it keeps happening, ask whoever runs the Firebase project."), (invites[0].FirebaseAccount, invites[0].Error));
        Assert.Equal((FirebaseAccountStatus.Created, (string?)null), (invites[1].FirebaseAccount, invites[1].Error));
        firebase.Verify(f => f.EnsureSignInAccountAsync("bo@example.com", It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Invites_for_a_batch_that_is_not_a_staff_import_here_are_not_found()
    {
        var (db, controller, firebase, batchId, tenantId) = await StaffImportedAsync();
        using var _ = db;
        Assert.IsType<NotFoundObjectResult>((await controller.Invites(Guid.NewGuid(), null, CancellationToken.None)).Result);

        // A participant batch, and the staff batch once undone.
        var participants = await Service(db, tenantId).CommitAsync(ImportKind.Participants, Csv("First name,Last name", "Ava,Stone"), "people.csv", null,
            ImportLanding.Active, "key-2", Admin(), CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>((await controller.Invites(participants.BatchId, null, CancellationToken.None)).Result);
        (await db.Users.SingleAsync(u => u.Email == "bo@example.com")).LastLoginAt = null;
        await db.SaveChangesAsync();
        Assert.Empty((await Service(db, tenantId).UndoAsync(batchId, Admin(), CancellationToken.None)).Blockers);
        Assert.IsType<NotFoundObjectResult>((await controller.Invites(batchId, null, CancellationToken.None)).Result);

        firebase.Verify(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Another_organisations_staff_import_is_not_found_and_nobody_in_it_is_set_up()
    {
        var shared = Guid.NewGuid().ToString();
        var (db, _, firebase, batchId, _) = await StaffImportedAsync(shared);
        using var _ = db;
        var otherTenant = Guid.NewGuid();
        using var otherDb = TestDb.ForTenant(shared, otherTenant);

        Assert.IsType<NotFoundObjectResult>((await Controller(otherDb, otherTenant, firebase.Object).Invites(batchId, null, CancellationToken.None)).Result);
        firebase.Verify(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task A_dropped_request_stops_the_invites_quietly()
    {
        var (db, _, _, batchId, tenantId) = await StaffImportedAsync();
        using var _ = db;
        using var dropped = new CancellationTokenSource();
        var firebase = new Mock<IFirebaseUserService>();
        // The first Firebase call is where the request is dropped.
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(() => { dropped.Cancel(); return Task.FromException<SignInAccountResult>(new OperationCanceledException(dropped.Token)); });
        var logger = new ListLogger<ImportsController>();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Controller(db, tenantId, firebase.Object, logger).Invites(batchId, null, dropped.Token));

        firebase.Verify(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
        Assert.DoesNotContain(logger.Entries, e => e.Level >= LogLevel.Warning);
    }

    [Fact]
    public async Task A_Firebase_failure_is_logged_with_its_code_and_never_the_address()
    {
        var (db, _, _, batchId, tenantId) = await StaffImportedAsync();
        using var _ = db;
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(Odip.Tests.Controllers.FirebaseTestExceptions.WithCode(FirebaseAdmin.Auth.AuthErrorCode.EmailAlreadyExists));
        var logger = new ListLogger<ImportsController>();

        await Controller(db, tenantId, firebase.Object, logger).Invites(batchId, null, CancellationToken.None);

        var errors = logger.Entries.Where(e => e.Level == LogLevel.Error).Select(e => e.Text).ToList();
        Assert.Equal(2, errors.Count);
        Assert.All(errors, text => Assert.Contains("EmailAlreadyExists", text));
        Assert.All(errors, text => Assert.DoesNotContain("@example.com", text));
    }

    [Fact]
    public async Task One_request_invites_at_most_100_and_says_how_many_are_left()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var rows = Enumerable.Range(1, 150).Select(n => $"P{n:000},Staff,p{n:000}@example.com").Prepend("First name,Last name,Email").ToArray();
        var batch = await Service(db, tenantId).CommitAsync(ImportKind.Staff, Csv(rows), "staff.csv", null, null, "key-1", Admin(), CancellationToken.None);
        Assert.Equal(150, batch.CreatedCount);
        var firebase = new Mock<IFirebaseUserService>();
        firebase.Setup(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(SignInAccountResult.Created);
        var controller = Controller(db, tenantId, firebase.Object);
        async Task<ImportInvitesDto> Send(int? from) =>
            Assert.IsType<ApiResponse<ImportInvitesDto>>(Assert.IsType<OkObjectResult>((await controller.Invites(batch.BatchId, from, CancellationToken.None)).Result).Value).Data!;

        var first = await Send(null);
        var second = await Send(100);

        Assert.Equal((100, 50), (first.Invites.Count, first.Left));
        Assert.Equal((50, 0), (second.Invites.Count, second.Left));
        Assert.Equal(150, first.Invites.Concat(second.Invites).Select(i => i.Email).Distinct().Count());
        firebase.Verify(f => f.EnsureSignInAccountAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Exactly(150));
    }
}
