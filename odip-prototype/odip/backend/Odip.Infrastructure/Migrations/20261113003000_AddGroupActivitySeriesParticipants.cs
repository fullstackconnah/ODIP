using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddGroupActivitySeriesParticipants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "GroupActivitySeriesParticipants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    SeriesId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Ratio = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupActivitySeriesParticipants", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupActivitySeriesParticipants_GroupActivitySeries_SeriesId",
                        column: x => x.SeriesId,
                        principalTable: "GroupActivitySeries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GroupActivitySeriesParticipants_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivitySeriesParticipants_ParticipantId",
                table: "GroupActivitySeriesParticipants",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivitySeriesParticipants_SeriesId_ParticipantId",
                table: "GroupActivitySeriesParticipants",
                columns: new[] { "SeriesId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupActivitySeriesParticipants_TenantId_ParticipantId",
                table: "GroupActivitySeriesParticipants",
                columns: new[] { "TenantId", "ParticipantId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GroupActivitySeriesParticipants");
        }
    }
}
