using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20260831033036_AddParticipantDiagnosesAndHidpa")]
    public partial class AddParticipantDiagnosesAndHidpa : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "HidpaSupportCategories",
                table: "Participants",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<List<string>>(
                name: "OtherDiagnoses",
                table: "Participants",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'");

            migrationBuilder.AddColumn<string>(
                name: "PrimaryDiagnosis",
                table: "Participants",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HidpaSupportCategories",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "OtherDiagnoses",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PrimaryDiagnosis",
                table: "Participants");
        }
    }
}
