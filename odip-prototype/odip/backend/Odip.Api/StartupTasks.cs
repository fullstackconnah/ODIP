using Microsoft.EntityFrameworkCore;
using Odip.Infrastructure.Data;

namespace Odip.Api;

public static class StartupTasks
{
    /// <summary>Migrates, repairs, heals and seeds the database at startup, retrying on a transient database failure.</summary>
    public static async Task RunAsync(WebApplication app)
    {
        const int maxRetries = 5;
        for (var attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                using var scope = app.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();

                // Verify connectivity before running migrations
                await db.Database.CanConnectAsync();

                // Bootstrap: create the EF migrations history table if it doesn't exist yet.
                await db.Database.ExecuteSqlRawAsync(
                    """
                    CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
                        "MigrationId" character varying(150) NOT NULL,
                        "ProductVersion" character varying(32) NOT NULL,
                        CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
                    );
                    """);

                // Pre-populate migration history for databases that were created before EF
                // migration tracking was introduced.
                await db.Database.ExecuteSqlRawAsync(
                    """
                    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
                    SELECT m."MigrationId", '8.0.11'
                    FROM (VALUES
                        ('20260320104626_AddIncidentReports'),
                        ('20260320133223_AddScheduledActivityTrackingFields'),
                        ('20260321093551_AddInsuranceTracking'),
                        ('20260327084507_AddPaymentStatusToBooking')
                    ) AS m("MigrationId")
                    WHERE EXISTS (
                        SELECT 1 FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = 'AccommodationProperties'
                    )
                    ON CONFLICT DO NOTHING;
                    """);

                // Repair: if AddNdisClaiming was falsely marked as applied by the
                // pre-population block but the tables don't actually exist, remove the
                // false history entry so MigrateAsync re-runs the migration properly.
                await db.Database.ExecuteSqlRawAsync(
                    """
                    DELETE FROM "__EFMigrationsHistory"
                    WHERE "MigrationId" = '20260327121732_AddNdisClaiming'
                    AND NOT EXISTS (
                        SELECT 1 FROM pg_catalog.pg_class c
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relname = 'SupportActivityGroups'
                    );
                    """);

                // Apply pending EF Core migrations
                await db.Database.MigrateAsync();

                // Rollback-window incidents and claims filed without a TenantId (see IncidentTenantHeal, ClaimTenantHeal).
                await db.Database.ExecuteSqlRawAsync(IncidentTenantHeal.Sql);
                await db.Database.ExecuteSqlRawAsync(ClaimTenantHeal.Sql);
                await DbSeeder.SeedAsync(db);
                await DbSeeder.SeedNdisDataAsync(db);
                await DbSeeder.SeedMedicationsAsync(db);
                await DbSeeder.SeedParticipantNotesAsync(db);
                await DbSeeder.SeedParticipantRoutinesAsync(db);
                await DbSeeder.SeedRestrictivePracticesAsync(db);
                // M16: one entry per chemical-restraint medicine, tenant by tenant; a failing tenant is logged and retried next start.
                await RestrictivePracticeBackfill.RunRestraintMedicinesForAllTenantsAsync(
                    scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>(), app.Logger);
                await DbSeeder.SeedParticipantRiskEntriesAsync(db);
                await DbSeeder.SeedParticipantConsentsAsync(db);
                await DbSeeder.SeedParticipantHealthConditionsAsync(db);
                await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db);
                await DbSeeder.SeedParticipantAdlAssessmentsAsync(db);
                await DbSeeder.SeedParticipantDailyLivingAsync(db);
                await DbSeeder.SeedCommunityAccessDailyLivingAsync(db);
                await DbSeeder.SeedShiftNotesAsync(db);
                await WhatsNewSeed.SeedWhatsNewAsync(db, DateTime.UtcNow);

                break; // Success — exit retry loop
            }
            catch (Exception ex) when (attempt < maxRetries &&
                (ex is Npgsql.NpgsqlException || ex is System.Net.Sockets.SocketException || ex is TimeoutException))
            {
                var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt)); // 2s, 4s, 8s, 16s
                Console.WriteLine($"[Startup] DB connection attempt {attempt}/{maxRetries} failed: {ex.Message}. Retrying in {delay.TotalSeconds}s...");
                await Task.Delay(delay);
            }
        }
    }
}
