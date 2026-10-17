using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInquiryParticipantDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "LastName",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AddColumn<string>(
                name: "AddressPostcode",
                table: "ParticipantInquiries",
                type: "character varying(4)",
                maxLength: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressState",
                table: "ParticipantInquiries",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressStreet",
                table: "ParticipantInquiries",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressSuburb",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactFirstName",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ContactIsParticipant",
                table: "ParticipantInquiries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ContactLastName",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactRelationship",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ContactRole",
                table: "ParticipantInquiries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "DateOfBirth",
                table: "ParticipantInquiries",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NdisNumber",
                table: "ParticipantInquiries",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanEndDate",
                table: "ParticipantInquiries",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanStartDate",
                table: "ParticipantInquiries",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PlanType",
                table: "ParticipantInquiries",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AddressPostcode",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "AddressState",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "AddressStreet",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "AddressSuburb",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ContactFirstName",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ContactIsParticipant",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ContactLastName",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ContactRelationship",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "ContactRole",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "DateOfBirth",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "NdisNumber",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "PlanEndDate",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "PlanStartDate",
                table: "ParticipantInquiries");

            migrationBuilder.DropColumn(
                name: "PlanType",
                table: "ParticipantInquiries");

            // A first-name-only enquiry has a null LastName: NOT NULL would refuse it.
            migrationBuilder.Sql("UPDATE \"ParticipantInquiries\" SET \"LastName\" = '' WHERE \"LastName\" IS NULL;");

            migrationBuilder.AlterColumn<string>(
                name: "LastName",
                table: "ParticipantInquiries",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);
        }
    }
}
