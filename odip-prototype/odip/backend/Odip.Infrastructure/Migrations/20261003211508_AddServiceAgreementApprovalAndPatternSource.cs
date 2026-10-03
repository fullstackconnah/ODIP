using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddServiceAgreementApprovalAndPatternSource : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RequirementsJson",
                table: "Shifts",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "GeneratedThrough",
                table: "ShiftPatterns",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RequirementsJson",
                table: "ShiftPatterns",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceBlockKey",
                table: "ShiftPatterns",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceDraftId",
                table: "ShiftPatterns",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WorkerSlot",
                table: "ShiftPatterns",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ServiceAgreementDraftApprovals",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DraftId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DraftVersion = table.Column<int>(type: "integer", nullable: false),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    ApprovedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ApprovedByName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    PatternsCreated = table.Column<int>(type: "integer", nullable: false),
                    PatternsEnded = table.Column<int>(type: "integer", nullable: false),
                    ShiftsCreated = table.Column<int>(type: "integer", nullable: false),
                    FirstShiftDate = table.Column<DateOnly>(type: "date", nullable: true),
                    HorizonEnd = table.Column<DateOnly>(type: "date", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceAgreementDraftApprovals", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceAgreementDraftApprovals_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ServiceAgreementDraftApprovals_ServiceAgreementDrafts_Draft~",
                        column: x => x.DraftId,
                        principalTable: "ServiceAgreementDrafts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_SourceDraft_Block_Day_Slot",
                table: "ShiftPatterns",
                columns: new[] { "SourceDraftId", "SourceBlockKey", "DayOfWeek", "WorkerSlot" },
                unique: true,
                filter: "\"SourceDraftId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ShiftPatterns_SourceDraftId",
                table: "ShiftPatterns",
                column: "SourceDraftId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDraftApprovals_DraftId",
                table: "ServiceAgreementDraftApprovals",
                column: "DraftId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDraftApprovals_ParticipantId",
                table: "ServiceAgreementDraftApprovals",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceAgreementDraftApprovals_TenantId_ParticipantId",
                table: "ServiceAgreementDraftApprovals",
                columns: new[] { "TenantId", "ParticipantId" });

            migrationBuilder.AddForeignKey(
                name: "FK_ShiftPatterns_ServiceAgreementDrafts_SourceDraftId",
                table: "ShiftPatterns",
                column: "SourceDraftId",
                principalTable: "ServiceAgreementDrafts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ShiftPatterns_ServiceAgreementDrafts_SourceDraftId",
                table: "ShiftPatterns");

            migrationBuilder.DropTable(
                name: "ServiceAgreementDraftApprovals");

            migrationBuilder.DropIndex(
                name: "IX_ShiftPatterns_SourceDraft_Block_Day_Slot",
                table: "ShiftPatterns");

            migrationBuilder.DropIndex(
                name: "IX_ShiftPatterns_SourceDraftId",
                table: "ShiftPatterns");

            migrationBuilder.DropColumn(
                name: "RequirementsJson",
                table: "Shifts");

            migrationBuilder.DropColumn(
                name: "GeneratedThrough",
                table: "ShiftPatterns");

            migrationBuilder.DropColumn(
                name: "RequirementsJson",
                table: "ShiftPatterns");

            migrationBuilder.DropColumn(
                name: "SourceBlockKey",
                table: "ShiftPatterns");

            migrationBuilder.DropColumn(
                name: "SourceDraftId",
                table: "ShiftPatterns");

            migrationBuilder.DropColumn(
                name: "WorkerSlot",
                table: "ShiftPatterns");
        }
    }
}
