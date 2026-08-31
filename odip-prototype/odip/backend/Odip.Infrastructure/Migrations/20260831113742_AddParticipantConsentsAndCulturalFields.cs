using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantConsentsAndCulturalFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChoiceControlNotes",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAboriginalOrTorresStraitIslander",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsCald",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsFamilyCommunity",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsLgbtqi",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PersonalInterests",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceivedAdvocacyInfo",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceivedBeingSafeInfo",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceivedFeedbackInfo",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceivedPrivacyAndConfidentialityInfo",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReceivedRightsAndResponsibilitiesInfo",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ParticipantConsents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConsentType = table.Column<int>(type: "integer", nullable: false),
                    Granted = table.Column<bool>(type: "boolean", nullable: true),
                    RecordedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    SignedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SignedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantConsents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantConsents_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantConsents_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantConsents_ParticipantId",
                table: "ParticipantConsents",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantConsents_ParticipantId_ConsentType",
                table: "ParticipantConsents",
                columns: new[] { "ParticipantId", "ConsentType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantConsents_TenantId",
                table: "ParticipantConsents",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantConsents");

            migrationBuilder.DropColumn(
                name: "ChoiceControlNotes",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsAboriginalOrTorresStraitIslander",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsCald",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsFamilyCommunity",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsLgbtqi",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PersonalInterests",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceivedAdvocacyInfo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceivedBeingSafeInfo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceivedFeedbackInfo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceivedPrivacyAndConfidentialityInfo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceivedRightsAndResponsibilitiesInfo",
                table: "Participants");
        }
    }
}
