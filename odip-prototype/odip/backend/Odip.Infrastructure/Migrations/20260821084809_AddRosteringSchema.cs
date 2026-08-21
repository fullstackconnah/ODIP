using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRosteringSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "WorkerScreeningExpiryDate",
                table: "Staff",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WorkerScreeningNumber",
                table: "Staff",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ShiftPatterns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DefaultStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    DayOfWeek = table.Column<int>(type: "integer", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndsNextDay = table.Column<bool>(type: "boolean", nullable: false),
                    Ratio = table.Column<int>(type: "integer", nullable: false),
                    NightType = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    EffectiveTo = table.Column<DateOnly>(type: "date", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShiftPatterns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ShiftPatterns_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ShiftPatterns_Staff_DefaultStaffId",
                        column: x => x.DefaultStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Shifts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    ServiceDate = table.Column<DateOnly>(type: "date", nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    EndsNextDay = table.Column<bool>(type: "boolean", nullable: false),
                    Ratio = table.Column<int>(type: "integer", nullable: false),
                    NightType = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ShiftPatternId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    OverrideReason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    AcknowledgedFindingCodes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shifts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Shifts_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Shifts_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StaffParticipantCompatibilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Level = table.Column<int>(type: "integer", nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffParticipantCompatibilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StaffParticipantCompatibilities_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_StaffParticipantCompatibilities_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_DefaultStaffId",
                table: "ShiftPatterns",
                column: "DefaultStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_IsActive",
                table: "ShiftPatterns",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_ParticipantId",
                table: "ShiftPatterns",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_TenantId",
                table: "ShiftPatterns",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_TenantId_ParticipantId",
                table: "ShiftPatterns",
                columns: new[] { "TenantId", "ParticipantId" });

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_ParticipantId",
                table: "Shifts",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_ShiftPatternId_ServiceDate",
                table: "Shifts",
                columns: new[] { "ShiftPatternId", "ServiceDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_StaffId",
                table: "Shifts",
                column: "StaffId");

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_TenantId",
                table: "Shifts",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_TenantId_ServiceDate",
                table: "Shifts",
                columns: new[] { "TenantId", "ServiceDate" });

            migrationBuilder.CreateIndex(
                name: "IX_Shifts_TenantId_StaffId_ServiceDate",
                table: "Shifts",
                columns: new[] { "TenantId", "StaffId", "ServiceDate" });

            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_ParticipantId",
                table: "StaffParticipantCompatibilities",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_StaffId",
                table: "StaffParticipantCompatibilities",
                column: "StaffId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_TenantId",
                table: "StaffParticipantCompatibilities",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffParticipantCompatibilities_TenantId_StaffId_Participan~",
                table: "StaffParticipantCompatibilities",
                columns: new[] { "TenantId", "StaffId", "ParticipantId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShiftPatterns");

            migrationBuilder.DropTable(
                name: "Shifts");

            migrationBuilder.DropTable(
                name: "StaffParticipantCompatibilities");

            migrationBuilder.DropColumn(
                name: "WorkerScreeningExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "WorkerScreeningNumber",
                table: "Staff");
        }
    }
}
