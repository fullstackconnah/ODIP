using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddRestrictivePracticeMonthlyReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RestrictivePracticeMonthlyReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    RestrictivePracticeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Month = table.Column<DateOnly>(type: "date", nullable: false),
                    ReportType = table.Column<int>(type: "integer", nullable: false),
                    VariedKind = table.Column<int>(type: "integer", nullable: true),
                    VariedAlsoUnauthorised = table.Column<bool>(type: "boolean", nullable: true),
                    UseCount = table.Column<int>(type: "integer", nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    LodgedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    LodgedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    LodgedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PracticeType = table.Column<int>(type: "integer", nullable: false),
                    PracticeDescription = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RestrictivePracticeMonthlyReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RestrictivePracticeMonthlyReports_RestrictivePractices_Rest~",
                        column: x => x.RestrictivePracticeId,
                        principalTable: "RestrictivePractices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RestrictivePracticeMonthlyReports_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePracticeMonthlyReports_RestrictivePracticeId_Mon~",
                table: "RestrictivePracticeMonthlyReports",
                columns: new[] { "RestrictivePracticeId", "Month" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RestrictivePracticeMonthlyReports_TenantId",
                table: "RestrictivePracticeMonthlyReports",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RestrictivePracticeMonthlyReports");
        }
    }
}
