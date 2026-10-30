using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddClaimBatches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClaimBatches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileName = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UploadedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UploadedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    ResultsImportedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DiscardedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DiscardedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    LineCount = table.Column<int>(type: "integer", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClaimBatches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ClaimBatchLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    BatchId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClaimLineItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    Attempt = table.Column<int>(type: "integer", nullable: false),
                    RowReference = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Outcome = table.Column<int>(type: "integer", nullable: false),
                    RejectCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    RejectMessage = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ResultAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    NdisNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SupportNumber = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SupportsDeliveredFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    SupportsDeliveredTo = table.Column<DateOnly>(type: "date", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DismissedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    DismissedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClaimBatchLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClaimBatchLines_ClaimBatches_BatchId",
                        column: x => x.BatchId,
                        principalTable: "ClaimBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ClaimBatchLines_ClaimLineItems_ClaimLineItemId",
                        column: x => x.ClaimLineItemId,
                        principalTable: "ClaimLineItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClaimBatches_TenantId_Status_CreatedAt",
                table: "ClaimBatches",
                columns: new[] { "TenantId", "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "UX_ClaimBatches_TenantId_FileName",
                table: "ClaimBatches",
                columns: new[] { "TenantId", "FileName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClaimBatchLines_BatchId_RowReference",
                table: "ClaimBatchLines",
                columns: new[] { "BatchId", "RowReference" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_ClaimBatchLines_OnePendingPerLine",
                table: "ClaimBatchLines",
                column: "ClaimLineItemId",
                unique: true,
                filter: "\"Outcome\" = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ClaimBatchLines");

            migrationBuilder.DropTable(
                name: "ClaimBatches");
        }
    }
}
