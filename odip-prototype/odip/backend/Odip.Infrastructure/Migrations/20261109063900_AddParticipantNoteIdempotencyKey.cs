using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261109063900_AddParticipantNoteIdempotencyKey")]
    public partial class AddParticipantNoteIdempotencyKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "ParticipantNotes",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantNotes_TenantId_ParticipantId_IdempotencyKey",
                table: "ParticipantNotes",
                columns: new[] { "TenantId", "ParticipantId", "IdempotencyKey" },
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ParticipantNotes_TenantId_ParticipantId_IdempotencyKey",
                table: "ParticipantNotes");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "ParticipantNotes");
        }
    }
}
