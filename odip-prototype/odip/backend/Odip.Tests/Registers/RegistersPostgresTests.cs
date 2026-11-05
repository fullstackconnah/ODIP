using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.DataExport;
using Odip.Tests.DataExport;
using Xunit;
using PostgresFixture = Odip.Tests.Postgres.PostgresFixture;

namespace Odip.Tests.Registers;

/// <summary>
/// Each register against a real PostgreSQL: InMemory hides translation and ordering faults. Skipped, never failed, when POSTGRES_CONNECTION_STRING is unset.
/// </summary>
public class RegistersPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RegistersPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task Every_register_runs_on_postgres_and_returns_its_header_and_the_seeded_row_and_nothing_of_the_other_organisation()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var setup = PostgresFixture.NewContext(cs)) await setup.Database.MigrateAsync();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha Care", EmailDomain = $"{a:N}.example.com" }, new Tenant { Id = b, Name = "Bravo Care", EmailDomain = $"{b:N}.example.com" });
            admin.SaveChanges();
            foreach (var (tenant, mark) in new[] { (a, "ALPHA"), (b, "BRAVO") })
            {
                var user = new User { Id = Guid.NewGuid(), TenantId = tenant, FirstName = mark, LastName = "Staff", Email = $"{Guid.NewGuid():N}@x.test", IsActive = true };
                var p = new Participant { Id = Guid.NewGuid(), TenantId = tenant, FirstName = mark, LastName = "Participant", IsActive = true };
                admin.Users.Add(user);
                admin.Participants.Add(p);
                admin.SaveChanges();
                admin.IncidentReports.Add(new IncidentReport { Id = Guid.NewGuid(), TenantId = tenant, ReportedByUserId = user.Id, InvolvedParticipantId = p.Id, Title = mark + "-incident", IncidentDateTime = new DateTime(2026, 6, 1, 9, 0, 0), IsActive = true });
                admin.Complaints.Add(new Complaint { Id = Guid.NewGuid(), TenantId = tenant, ReceivedOn = new DateOnly(2026, 6, 1), Summary = mark + "-complaint", ParticipantId = p.Id, HandledByUserId = user.Id });
                admin.RestrictivePractices.Add(new RestrictivePractice { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, Description = mark + "-practice", AuthorisationDate = new DateOnly(2026, 5, 1) });
                admin.ParticipantRiskEntries.Add(new ParticipantRiskEntry { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, Description = mark + "-risk" });
                admin.ParticipantCommunityAccessRiskItems.Add(new ParticipantCommunityAccessRiskItem { Id = Guid.NewGuid(), TenantId = tenant, ParticipantId = p.Id, Rating = RiskRatingLevel.Low });
                admin.SaveChanges();
            }
        }

        foreach (var (register, marker) in new[] { ("incidents", "ALPHA-incident"), ("complaints", "ALPHA-complaint"), ("restrictive-practices", "ALPHA-practice"), ("risks", "ALPHA-risk"), ("staff-credentials", "ALPHA") })
        {
            await using var db = PostgresFixture.NewContext(cs, DataExportTestKit.Tenant(a));
            var c = new RegistersController(db, DataExportTestKit.Tenant(a));
            var from = new DateOnly(2026, 1, 1);
            var to = new DateOnly(2026, 12, 31);
            IActionResult result = register switch
            {
                "incidents" => await c.Incidents(from, to, default),
                "complaints" => await c.Complaints(from, to, default),
                "restrictive-practices" => await c.RestrictivePractices(from, to, default),
                "risks" => await c.Risks(default),
                _ => await c.StaffCredentials(default),
            };
            var text = System.Text.Encoding.UTF8.GetString(Assert.IsType<FileContentResult>(result).FileContents);
            Assert.Contains(marker, text);
            Assert.DoesNotContain("BRAVO", text);
            Assert.StartsWith("\uFEFF", text);
            Assert.Equal(register == "risks" ? 3 : 2, DataExportTestKit.ParseCsv(text.TrimStart('﻿')).Count); // header, the row (risks: a risk entry and a community access item)
        }
    }
}
