using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupActivitySeries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SeriesId",
                table: "GroupActivities",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GroupActivitySeries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Interval = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupActivitySeries", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivities_SeriesId",
                table: "GroupActivities",
                column: "SeriesId");

            migrationBuilder.AddForeignKey(
                name: "FK_GroupActivities_GroupActivitySeries_SeriesId",
                table: "GroupActivities",
                column: "SeriesId",
                principalTable: "GroupActivitySeries",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_GroupActivities_GroupActivitySeries_SeriesId",
                table: "GroupActivities");

            migrationBuilder.DropTable(
                name: "GroupActivitySeries");

            migrationBuilder.DropIndex(
                name: "IX_GroupActivities_SeriesId",
                table: "GroupActivities");

            migrationBuilder.DropColumn(
                name: "SeriesId",
                table: "GroupActivities");
        }
    }
}
