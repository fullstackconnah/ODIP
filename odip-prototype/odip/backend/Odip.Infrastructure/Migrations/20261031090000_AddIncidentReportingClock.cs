using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentReportingClock : Migration
    {
        /// <summary>
        /// Keeps every open Required incident's overdue state: the old rule was CreatedAt + 24 h, which is exactly the NotifyDueAt it gets here.
        /// The reported rows get a due too, so a later Update never meets a null one. NotRequired and Pending stay class None. Safe to re-run.
        /// </summary>
        public const string BackfillSql = @"UPDATE ""IncidentReports""
SET ""ReportableClass"" = 1,
    ""NotifyDueAt"" = ""CreatedAt"" + INTERVAL '24 hours'
WHERE ""QscReportingStatus"" IN (1, 2, 3) AND ""ReportableClass"" = 0 AND ""NotifyDueAt"" IS NULL;";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AwareAt",
                table: "IncidentReports",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CommissionDetailedReportedAt",
                table: "IncidentReports",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "CommissionFinalReportRequested",
                table: "IncidentReports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "CommissionFinalReportedAt",
                table: "IncidentReports",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DetailedReportDueAt",
                table: "IncidentReports",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "DueCountedWithoutHolidays",
                table: "IncidentReports",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "NotifyDueAt",
                table: "IncidentReports",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ReportableClass",
                table: "IncidentReports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "ReportableClassReason",
                table: "IncidentReports",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.Sql(BackfillSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var column in new[]
            {
                "AwareAt", "CommissionDetailedReportedAt", "CommissionFinalReportRequested", "CommissionFinalReportedAt",
                "DetailedReportDueAt", "DueCountedWithoutHolidays", "NotifyDueAt", "ReportableClass", "ReportableClassReason",
            })
            {
                migrationBuilder.DropColumn(name: column, table: "IncidentReports");
            }
        }
    }
}
