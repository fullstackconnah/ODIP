using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OnboardingComplaintsRights : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "ComplaintsExplainedOn",
                table: "ParticipantOnboardings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ExplainedRecordedAt",
                table: "ParticipantOnboardings",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExplainedRecordedBy",
                table: "ParticipantOnboardings",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "RightsExplainedOn",
                table: "ParticipantOnboardings",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ComplaintsExplainedOn",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "ExplainedRecordedAt",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "ExplainedRecordedBy",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "RightsExplainedOn",
                table: "ParticipantOnboardings");
        }
    }
}
