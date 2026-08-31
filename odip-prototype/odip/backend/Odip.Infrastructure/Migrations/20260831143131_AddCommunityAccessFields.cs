using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCommunityAccessFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BocDeEscalationStrategies",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BocEarlyWarningSigns",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BocTriggers",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BocWhatNotToDo",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HidpaNotes",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SignsHappyAndSettled",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportsLookLikeAfternoonEvening",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportsLookLikeDay",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportsLookLikeMorning",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SupportsLookLikeOvernight",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WhatHelpsMeCalmDown",
                table: "Participants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HowToHelpNotes",
                table: "ParticipantAdlAssessments",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ParticipantChecklistItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemType = table.Column<int>(type: "integer", nullable: false),
                    Value = table.Column<int>(type: "integer", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantChecklistItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantChecklistItems_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantChecklistItems_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantChecklistItems_ParticipantId",
                table: "ParticipantChecklistItems",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantChecklistItems_ParticipantId_ItemType",
                table: "ParticipantChecklistItems",
                columns: new[] { "ParticipantId", "ItemType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantChecklistItems_TenantId",
                table: "ParticipantChecklistItems",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ParticipantChecklistItems");

            migrationBuilder.DropColumn(
                name: "BocDeEscalationStrategies",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BocEarlyWarningSigns",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BocTriggers",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "BocWhatNotToDo",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "HidpaNotes",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SignsHappyAndSettled",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SupportsLookLikeAfternoonEvening",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SupportsLookLikeDay",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SupportsLookLikeMorning",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "SupportsLookLikeOvernight",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "WhatHelpsMeCalmDown",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "HowToHelpNotes",
                table: "ParticipantAdlAssessments");
        }
    }
}
