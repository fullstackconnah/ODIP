using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentServiceTypeParticipantGenderProviderManagerContact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ManagerName",
                table: "ProviderSettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ManagerPhone",
                table: "ProviderSettings",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Gender",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GenderSelfDescription",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "IncidentReports",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "OtherTypeSpecify",
                table: "IncidentReports",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ServiceType",
                table: "IncidentReports",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ManagerName",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "ManagerPhone",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "Gender",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "GenderSelfDescription",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OtherTypeSpecify",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "ServiceType",
                table: "IncidentReports");

            migrationBuilder.AlterColumn<Guid>(
                name: "TripInstanceId",
                table: "IncidentReports",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
