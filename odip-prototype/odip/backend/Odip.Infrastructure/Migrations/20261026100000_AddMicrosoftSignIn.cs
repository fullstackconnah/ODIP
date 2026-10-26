using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMicrosoftSignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "MicrosoftObjectId",
                table: "Users",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "MicrosoftTenantId",
                table: "Users",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MicrosoftTenantLinks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    MicrosoftTenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    DefaultRole = table.Column<int>(type: "integer", nullable: false),
                    LinkedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MicrosoftTenantLinks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MicrosoftTenantLinks_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Users_MicrosoftTenantId_MicrosoftObjectId",
                table: "Users",
                columns: new[] { "MicrosoftTenantId", "MicrosoftObjectId" },
                unique: true,
                filter: "\"MicrosoftObjectId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MicrosoftTenantLinks_MicrosoftTenantId",
                table: "MicrosoftTenantLinks",
                column: "MicrosoftTenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MicrosoftTenantLinks_TenantId",
                table: "MicrosoftTenantLinks",
                column: "TenantId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MicrosoftTenantLinks");

            migrationBuilder.DropIndex(
                name: "IX_Users_MicrosoftTenantId_MicrosoftObjectId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "MicrosoftObjectId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "MicrosoftTenantId",
                table: "Users");
        }
    }
}
