using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddObligationTasks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<DateTime>(
                name: "AutoCompletedAt",
                table: "BookingTasks",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "IncidentReportId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LeaveRequestId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LinkTo",
                table: "BookingTasks",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "MedicationAdministrationId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ShiftId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ShiftNoteId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceKey",
                table: "BookingTasks",
                type: "text",
                nullable: true);

            // Add TenantId as nullable first so existing rows (every one of which is trip-linked
            // pre-item-9) can be backfilled from their TripInstance's own TenantId — same idiom
            // as MakeProviderSettingsPerTenant.
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "BookingTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "BookingTasks" bt
                SET "TenantId" = ti."TenantId"
                FROM "TripInstances" ti
                WHERE ti."Id" = bt."TripInstanceId" AND bt."TenantId" IS NULL;
                """);

            // Now enforce NOT NULL — will fail loudly if any row couldn't be backfilled (a
            // BookingTask whose TripInstanceId doesn't resolve to a TripInstance, which should
            // not exist given the FK that has always been in place on that column).
            migrationBuilder.AlterColumn<Guid>(
                name: "TenantId",
                table: "BookingTasks",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_IncidentReportId",
                table: "BookingTasks",
                column: "IncidentReportId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_LeaveRequestId",
                table: "BookingTasks",
                column: "LeaveRequestId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_MedicationAdministrationId",
                table: "BookingTasks",
                column: "MedicationAdministrationId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_ShiftId",
                table: "BookingTasks",
                column: "ShiftId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_ShiftNoteId",
                table: "BookingTasks",
                column: "ShiftNoteId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_SourceKey",
                table: "BookingTasks",
                column: "SourceKey",
                unique: true,
                filter: "\"SourceKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_TenantId",
                table: "BookingTasks",
                column: "TenantId");

            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_IncidentReports_IncidentReportId",
                table: "BookingTasks",
                column: "IncidentReportId",
                principalTable: "IncidentReports",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_LeaveRequests_LeaveRequestId",
                table: "BookingTasks",
                column: "LeaveRequestId",
                principalTable: "LeaveRequests",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_MedicationAdministrations_MedicationAdministra~",
                table: "BookingTasks",
                column: "MedicationAdministrationId",
                principalTable: "MedicationAdministrations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_ShiftNotes_ShiftNoteId",
                table: "BookingTasks",
                column: "ShiftNoteId",
                principalTable: "ShiftNotes",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_BookingTasks_Shifts_ShiftId",
                table: "BookingTasks",
                column: "ShiftId",
                principalTable: "Shifts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_BookingTasks_IncidentReports_IncidentReportId",
                table: "BookingTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_BookingTasks_LeaveRequests_LeaveRequestId",
                table: "BookingTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_BookingTasks_MedicationAdministrations_MedicationAdministra~",
                table: "BookingTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_BookingTasks_ShiftNotes_ShiftNoteId",
                table: "BookingTasks");

            migrationBuilder.DropForeignKey(
                name: "FK_BookingTasks_Shifts_ShiftId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_IncidentReportId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_LeaveRequestId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_MedicationAdministrationId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_ShiftId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_ShiftNoteId",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_SourceKey",
                table: "BookingTasks");

            migrationBuilder.DropIndex(
                name: "IX_BookingTasks_TenantId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "AutoCompletedAt",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "IncidentReportId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "LeaveRequestId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "LinkTo",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "MedicationAdministrationId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "ShiftId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "ShiftNoteId",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "SourceKey",
                table: "BookingTasks");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "BookingTasks");

            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "BookingTasks",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
