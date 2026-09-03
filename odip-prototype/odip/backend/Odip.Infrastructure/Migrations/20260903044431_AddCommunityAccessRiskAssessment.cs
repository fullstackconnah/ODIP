using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunityAccessRiskAssessment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "OverallCommunityAccessRiskRating",
                table: "Participants",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ParticipantCommunityAccessRiskItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemType = table.Column<int>(type: "integer", nullable: false),
                    Rating = table.Column<int>(type: "integer", nullable: true),
                    StrategyNotes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantCommunityAccessRiskItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantCommunityAccessRiskItems_Participants_Participan~",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantCommunityAccessRiskItems_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantCommunityAccessRiskItems_ParticipantId",
                table: "ParticipantCommunityAccessRiskItems",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantCommunityAccessRiskItems_ParticipantId_ItemType",
                table: "ParticipantCommunityAccessRiskItems",
                columns: new[] { "ParticipantId", "ItemType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantCommunityAccessRiskItems_TenantId",
                table: "ParticipantCommunityAccessRiskItems",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantCommunityAccessRiskItems");

            migrationBuilder.DropColumn(
                name: "OverallCommunityAccessRiskRating",
                table: "Participants");
        }
    }
}
