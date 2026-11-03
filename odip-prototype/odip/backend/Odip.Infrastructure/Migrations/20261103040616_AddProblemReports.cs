using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProblemReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProblemReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReporterUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReporterName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ReporterRole = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    OrganisationName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    PagePath = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AppVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ApiVersion = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UserAgent = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    LastError = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CardId = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProblemReports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProblemReports_ReporterUserId_CreatedAt",
                table: "ProblemReports",
                columns: new[] { "ReporterUserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProblemReports_Status_NextAttemptAt",
                table: "ProblemReports",
                columns: new[] { "Status", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ProblemReports_TenantId",
                table: "ProblemReports",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProblemReports");
        }
    }
}
