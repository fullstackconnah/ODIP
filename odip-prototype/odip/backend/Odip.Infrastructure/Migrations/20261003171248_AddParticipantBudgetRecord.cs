using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddParticipantBudgetRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BudgetSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Mode = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    ApproachingPercent = table.Column<int>(type: "integer", nullable: false, defaultValue: 80)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BudgetSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BudgetSettings_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FundingPlans",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    PlanStart = table.Column<DateOnly>(type: "date", nullable: false),
                    PlanEnd = table.Column<DateOnly>(type: "date", nullable: false),
                    ReassessmentDate = table.Column<DateOnly>(type: "date", nullable: true),
                    PeriodLengthMonths = table.Column<int>(type: "integer", nullable: true),
                    Evidence = table.Column<int>(type: "integer", nullable: false),
                    ConfirmedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    ConfirmedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FundingPlans", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FundingPlans_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FundingPools",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    FundingPlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    PaceCategory = table.Column<int>(type: "integer", nullable: false),
                    ManagementType = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FundingPools", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FundingPools_FundingPlans_FundingPlanId",
                        column: x => x.FundingPlanId,
                        principalTable: "FundingPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FundingPeriods",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    FundingPoolId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    PeriodStart = table.Column<DateOnly>(type: "date", nullable: false),
                    PeriodEnd = table.Column<DateOnly>(type: "date", nullable: false),
                    PlanAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SetAside = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FundingPeriods", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FundingPeriods_FundingPools_FundingPoolId",
                        column: x => x.FundingPoolId,
                        principalTable: "FundingPools",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BudgetSettings_TenantId",
                table: "BudgetSettings",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FundingPeriods_FundingPoolId_PeriodStart",
                table: "FundingPeriods",
                columns: new[] { "FundingPoolId", "PeriodStart" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FundingPlans_ParticipantId",
                table: "FundingPlans",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_FundingPlans_TenantId_ParticipantId_PlanStart",
                table: "FundingPlans",
                columns: new[] { "TenantId", "ParticipantId", "PlanStart" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FundingPools_FundingPlanId_PaceCategory_ManagementType",
                table: "FundingPools",
                columns: new[] { "FundingPlanId", "PaceCategory", "ManagementType" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BudgetSettings");

            migrationBuilder.DropTable(
                name: "FundingPeriods");

            migrationBuilder.DropTable(
                name: "FundingPools");

            migrationBuilder.DropTable(
                name: "FundingPlans");
        }
    }
}
