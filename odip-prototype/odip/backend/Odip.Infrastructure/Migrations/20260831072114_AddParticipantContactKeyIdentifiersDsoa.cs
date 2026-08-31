using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantContactKeyIdentifiersDsoa : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "CompanionCardExpiry",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompanionCardNumber",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Country",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Email",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EyeColour",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HairColour",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "HeightCm",
                table: "Participants",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDsoa",
                table: "Participants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "MedicareExpiry",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MedicareNumber",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MiddleName",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PensionCardExpiry",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PensionCardNumber",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Participants",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlaceOfBirth",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrivateHealthFund",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PrivateHealthMembershipNumber",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TaxiCardNumber",
                table: "Participants",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "WeightKg",
                table: "Participants",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompanionCardExpiry",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "CompanionCardNumber",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Country",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Email",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "EyeColour",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "HairColour",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "HeightCm",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "IsDsoa",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MedicareExpiry",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MedicareNumber",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MiddleName",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PensionCardExpiry",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PensionCardNumber",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PlaceOfBirth",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PrivateHealthFund",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PrivateHealthMembershipNumber",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "TaxiCardNumber",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "WeightKg",
                table: "Participants");
        }
    }
}
