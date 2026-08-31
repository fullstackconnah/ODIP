using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantDailyLivingDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ChokingRiskMealDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FavouriteBreakfast",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FavouriteDinner",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FavouriteLunch",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FoodsAlwaysEaten",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Goals",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LikesDislikes",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MealAssistanceDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MedicationTricks",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ModifiedDietDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PegRegimeMealDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpecialDietaryNeedsDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SpecialUtensilsDetail",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StrengthsFears",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportAreas",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ThingsToKnow",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhoIsImportant",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ParticipantAdlAssessments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    AdlType = table.Column<int>(type: "integer", nullable: false),
                    Level = table.Column<int>(type: "integer", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantAdlAssessments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantAdlAssessments_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantAdlAssessments_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantAdlAssessments_ParticipantId",
                table: "ParticipantAdlAssessments",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantAdlAssessments_ParticipantId_AdlType",
                table: "ParticipantAdlAssessments",
                columns: new[] { "ParticipantId", "AdlType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantAdlAssessments_TenantId",
                table: "ParticipantAdlAssessments",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantAdlAssessments");

            migrationBuilder.DropColumn(
                name: "ChokingRiskMealDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "FavouriteBreakfast",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "FavouriteDinner",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "FavouriteLunch",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "FoodsAlwaysEaten",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "Goals",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "LikesDislikes",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MealAssistanceDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "MedicationTricks",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ModifiedDietDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PegRegimeMealDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SpecialDietaryNeedsDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SpecialUtensilsDetail",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "StrengthsFears",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SupportAreas",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ThingsToKnow",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "WhoIsImportant",
                table: "Participants");
        }
    }
}
