using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceOutboxDedupeIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NotificationOutbox_TenantId_EventType_EntityId_RecipientUse~",
                table: "NotificationOutbox");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationOutbox_EntityId_RecipientUserId_CreatedAt",
                table: "NotificationOutbox",
                columns: new[] { "EntityId", "RecipientUserId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_NotificationOutbox_EntityId_RecipientUserId_CreatedAt",
                table: "NotificationOutbox");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationOutbox_TenantId_EventType_EntityId_RecipientUse~",
                table: "NotificationOutbox",
                columns: new[] { "TenantId", "EventType", "EntityId", "RecipientUserId", "CreatedAt" });
        }
    }
}
