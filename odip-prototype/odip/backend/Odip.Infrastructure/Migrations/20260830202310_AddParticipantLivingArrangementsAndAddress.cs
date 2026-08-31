using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantLivingArrangementsAndAddress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccommodationType",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressPostcode",
                table: "Participants",
                type: "character varying(4)",
                maxLength: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressState",
                table: "Participants",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressStreet",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AddressSuburb",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "LivesWithOthers",
                table: "Participants",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LivingArrangement",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LivingArrangementNotes",
                table: "Participants",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MainSupportPersonName",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MainSupportPersonRelationship",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OnSiteSupportHours",
                table: "Participants",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OthersLivingInAccommodation",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResidentialInfo",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SilProviderContactPhone",
                table: "Participants",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SilProviderName",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhoLivesWith",
                table: "Participants",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccommodationType",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AddressPostcode",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AddressState",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AddressStreet",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "AddressSuburb",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "LivesWithOthers",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "LivingArrangement",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "LivingArrangementNotes",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MainSupportPersonName",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MainSupportPersonRelationship",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OnSiteSupportHours",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OthersLivingInAccommodation",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ResidentialInfo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SilProviderContactPhone",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SilProviderName",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "WhoLivesWith",
                table: "Participants");
        }
    }
}
