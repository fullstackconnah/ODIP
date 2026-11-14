using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Odip.Infrastructure.Data;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(OdipDbContext))]
    [Migration("20261108222808_AddComplaintIdempotencyKey")]
    public partial class AddComplaintIdempotencyKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdempotencyKey",
                table: "Complaints",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Complaints_TenantId_IdempotencyKey",
                table: "Complaints",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Complaints_TenantId_IdempotencyKey",
                table: "Complaints");

            migrationBuilder.DropColumn(
                name: "IdempotencyKey",
                table: "Complaints");
        }
    }
}
