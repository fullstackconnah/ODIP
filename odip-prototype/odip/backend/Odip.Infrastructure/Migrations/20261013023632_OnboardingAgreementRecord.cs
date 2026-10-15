using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class OnboardingAgreementRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AgreementRecordedAt",
                table: "ParticipantOnboardings",
                type: "timestamp without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AgreementRecordedBy",
                table: "ParticipantOnboardings",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "AgreementSignedOn",
                table: "ParticipantOnboardings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NoAgreementReason",
                table: "ParticipantOnboardings",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AgreementRecordedAt",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "AgreementRecordedBy",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "AgreementSignedOn",
                table: "ParticipantOnboardings");

            migrationBuilder.DropColumn(
                name: "NoAgreementReason",
                table: "ParticipantOnboardings");
        }
    }
}
