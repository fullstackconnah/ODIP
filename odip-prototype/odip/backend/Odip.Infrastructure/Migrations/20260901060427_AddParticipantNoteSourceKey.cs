using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantNoteSourceKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HasSourceDrift",
                table: "ParticipantNotes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsManuallyEdited",
                table: "ParticipantNotes",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "SourceKey",
                table: "ParticipantNotes",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SourceValueSnapshot",
                table: "ParticipantNotes",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantNotes_ParticipantId_SourceKey",
                table: "ParticipantNotes",
                columns: new[] { "ParticipantId", "SourceKey" },
                unique: true,
                filter: "\"SourceKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ParticipantNotes_ParticipantId_SourceKey",
                table: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "HasSourceDrift",
                table: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "IsManuallyEdited",
                table: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "SourceKey",
                table: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "SourceValueSnapshot",
                table: "ParticipantNotes");
        }
    }
}
