using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentWitnesses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IncidentWitnesses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentReportId = table.Column<Guid>(type: "uuid", nullable: false),
                    WitnessUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    WitnessName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    WitnessStatus = table.Column<int>(type: "integer", nullable: false),
                    WitnessRequestedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    WitnessRespondedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    StatementText = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentWitnesses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentWitnesses_IncidentReports_IncidentReportId",
                        column: x => x.IncidentReportId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_IncidentWitnesses_Users_WitnessUserId",
                        column: x => x.WitnessUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IncidentWitnesses_IncidentReportId",
                table: "IncidentWitnesses",
                column: "IncidentReportId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentWitnesses_WitnessUserId",
                table: "IncidentWitnesses",
                column: "WitnessUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IncidentWitnesses");
        }
    }
}
