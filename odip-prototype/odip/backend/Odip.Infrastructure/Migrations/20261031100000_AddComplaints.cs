using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddComplaints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Complaints",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReceivedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Channel = table.Column<int>(type: "integer", nullable: false),
                    ComplainantKind = table.Column<int>(type: "integer", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: true),
                    ComplainantName = table.Column<string>(type: "character varying(200)", nullable: true),
                    Summary = table.Column<string>(type: "character varying(4000)", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    AcknowledgedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ActionsTaken = table.Column<string>(type: "character varying(4000)", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(4000)", nullable: true),
                    OutcomeCommunicatedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ToldAboutCommission = table.Column<bool>(type: "boolean", nullable: false),
                    ToldAboutCommissionOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ClosedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    HandledByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    IncidentReportId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Complaints", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Complaints_Users_HandledByUserId",
                        column: x => x.HandledByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Complaints_IncidentReports_IncidentReportId",
                        column: x => x.IncidentReportId,
                        principalTable: "IncidentReports",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Complaints_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Complaints_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_HandledByUserId",
                table: "Complaints",
                column: "HandledByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_IncidentReportId",
                table: "Complaints",
                column: "IncidentReportId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_ParticipantId",
                table: "Complaints",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_TenantId",
                table: "Complaints",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_TenantId_IsActive_Status_ReceivedOn",
                table: "Complaints",
                columns: new[] { "TenantId", "IsActive", "Status", "ReceivedOn" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Complaints");
        }
    }
}
