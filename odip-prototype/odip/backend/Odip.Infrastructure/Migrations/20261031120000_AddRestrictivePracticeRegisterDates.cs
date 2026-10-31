using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRestrictivePracticeRegisterDates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "RestrictivePracticeUseVaried",
                table: "IncidentReports",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "AuthorisationEndDate",
                table: "RestrictivePractices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ComprehensiveBspDate",
                table: "RestrictivePractices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "FirstUsedOn",
                table: "RestrictivePractices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "InterimBspDate",
                table: "RestrictivePractices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ReportingFromMonth",
                table: "RestrictivePractices",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UseKind",
                table: "RestrictivePractices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Existing entries join the monthly report from the month this deploy runs (Sydney); new rows stay null, which reads as the creation month.
            migrationBuilder.Sql("UPDATE \"RestrictivePractices\" SET \"ReportingFromMonth\" = date_trunc('month', timezone('Australia/Sydney', now()))::date;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RestrictivePracticeUseVaried",
                table: "IncidentReports");

            migrationBuilder.DropColumn(
                name: "AuthorisationEndDate",
                table: "RestrictivePractices");

            migrationBuilder.DropColumn(
                name: "ComprehensiveBspDate",
                table: "RestrictivePractices");

            migrationBuilder.DropColumn(
                name: "FirstUsedOn",
                table: "RestrictivePractices");

            migrationBuilder.DropColumn(
                name: "InterimBspDate",
                table: "RestrictivePractices");

            migrationBuilder.DropColumn(
                name: "ReportingFromMonth",
                table: "RestrictivePractices");

            migrationBuilder.DropColumn(
                name: "UseKind",
                table: "RestrictivePractices");
        }
    }
}
