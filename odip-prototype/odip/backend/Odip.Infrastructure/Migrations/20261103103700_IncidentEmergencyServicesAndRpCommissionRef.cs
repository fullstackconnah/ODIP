using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class IncidentEmergencyServicesAndRpCommissionRef : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AmbulanceOfficerName",
                table: "IncidentReports",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AmbulanceReference",
                table: "IncidentReports",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EmergencyServices",
                table: "IncidentReports",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "FireOfficerName",
                table: "IncidentReports",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FireReference",
                table: "IncidentReports",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PoliceOfficerName",
                table: "IncidentReports",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PoliceReference",
                table: "IncidentReports",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommissionReference",
                table: "RestrictivePractices",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "AmbulanceOfficerName", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "AmbulanceReference", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "EmergencyServices", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "FireOfficerName", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "FireReference", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "PoliceOfficerName", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "PoliceReference", table: "IncidentReports");
            migrationBuilder.DropColumn(name: "CommissionReference", table: "RestrictivePractices");
        }
    }
}
