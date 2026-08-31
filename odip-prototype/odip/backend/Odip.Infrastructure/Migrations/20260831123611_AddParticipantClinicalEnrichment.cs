using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantClinicalEnrichment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AllergiesDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AllergyManagementNotes",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AmbulantStatus",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BehaviourRiskRating",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BehavioursOfConcernCurrent",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BehavioursOfConcernFiveYearHistory",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BocChartProvided",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BowelCareDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BspPlanProvided",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommunicationAids",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContinenceSupportDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExpressiveSkills",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FallsRiskRating",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ImpairedJudgementReasoning",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ImpairedUnderstanding",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsAnaphylaxisRisk",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LevelOfPersonalCare",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Memory",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "MemoryAids",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MenstruationSupport",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Orthotics",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReadingAbility",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReceptiveSkills",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "RidsLogged",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SkinIntegrity",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "UnevenGroundFlag",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ParticipantHealthConditions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConditionType = table.Column<int>(type: "integer", nullable: false),
                    Has = table.Column<bool>(type: "boolean", nullable: true),
                    Severity = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PlanProvided = table.Column<bool>(type: "boolean", nullable: true),
                    TrainingRequired = table.Column<bool>(type: "boolean", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantHealthConditions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantHealthConditions_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantHealthConditions_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantHealthConditions_ParticipantId",
                table: "ParticipantHealthConditions",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantHealthConditions_ParticipantId_ConditionType",
                table: "ParticipantHealthConditions",
                columns: new[] { "ParticipantId", "ConditionType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantHealthConditions_TenantId",
                table: "ParticipantHealthConditions",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantHealthConditions");

            migrationBuilder.DropColumn(
                name: "AllergiesDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AllergyManagementNotes",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AmbulantStatus",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BehaviourRiskRating",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BehavioursOfConcernCurrent",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BehavioursOfConcernFiveYearHistory",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BocChartProvided",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BowelCareDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BspPlanProvided",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "CommunicationAids",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ContinenceSupportDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ExpressiveSkills",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "FallsRiskRating",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ImpairedJudgementReasoning",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ImpairedUnderstanding",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsAnaphylaxisRisk",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "LevelOfPersonalCare",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Memory",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MemoryAids",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MenstruationSupport",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Orthotics",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReadingAbility",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ReceptiveSkills",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "RidsLogged",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SkinIntegrity",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "UnevenGroundFlag",
                table: "Participants");
        }
    }
}
