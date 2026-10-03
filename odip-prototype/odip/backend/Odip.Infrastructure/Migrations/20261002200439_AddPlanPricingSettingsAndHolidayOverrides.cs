using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPlanPricingSettingsAndHolidayOverrides : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PlanPricingSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    RegistrationGroupsHeld = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false, defaultValue: "0107,0104,0125,0136,0115,0108"),
                    RegistrationGroupsConfirmed = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CrossingPolicy = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    ClaimProviderTravel = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    TravelKmRateStandard = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false, defaultValue: 0.99m),
                    TravelKmRateAccessible = table.Column<decimal>(type: "numeric(8,2)", precision: 8, scale: 2, nullable: false, defaultValue: 2.76m),
                    TravelRatesProvisional = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    GroupOutings = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    StaUsesHourlyAndAccommodation = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    ApproverRoles = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false, defaultValue: "Admin,Coordinator")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanPricingSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlanPricingSettings_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PublicHolidayOverrides",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    Source = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicHolidayOverrides", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "PublicHolidayOverrides",
                columns: new[] { "Id", "Date", "EndTime", "Name", "Source", "StartTime", "State" },
                values: new object[,]
                {
                    { new Guid("5eed0000-0000-4000-8000-000000000001"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "ACT" },
                    { new Guid("5eed0000-0000-4000-8000-000000000002"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "NSW" },
                    { new Guid("5eed0000-0000-4000-8000-000000000003"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "NT" },
                    { new Guid("5eed0000-0000-4000-8000-000000000004"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "QLD" },
                    { new Guid("5eed0000-0000-4000-8000-000000000005"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "VIC" },
                    { new Guid("5eed0000-0000-4000-8000-000000000006"), new DateOnly(2026, 12, 26), null, "Boxing Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "WA" },
                    { new Guid("5eed0000-0000-4000-8000-000000000007"), new DateOnly(2026, 12, 26), null, "Proclamation Day holiday", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "SA" },
                    { new Guid("5eed0000-0000-4000-8000-000000000008"), new DateOnly(2027, 4, 25), null, "Extra public holiday for Anzac Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "ACT" },
                    { new Guid("5eed0000-0000-4000-8000-000000000009"), new DateOnly(2027, 4, 25), null, "Anzac Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "NSW" },
                    { new Guid("5eed0000-0000-4000-8000-000000000010"), new DateOnly(2027, 4, 25), null, "Anzac Day", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", null, "WA" },
                    { new Guid("5eed0000-0000-4000-8000-000000000011"), new DateOnly(2026, 12, 24), null, "Christmas Eve", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", new TimeOnly(19, 0, 0), "NT" },
                    { new Guid("5eed0000-0000-4000-8000-000000000012"), new DateOnly(2026, 12, 31), null, "New Year's Eve", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", new TimeOnly(19, 0, 0), "NT" },
                    { new Guid("5eed0000-0000-4000-8000-000000000013"), new DateOnly(2026, 12, 24), null, "Christmas Eve", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", new TimeOnly(18, 0, 0), "QLD" },
                    { new Guid("5eed0000-0000-4000-8000-000000000014"), new DateOnly(2026, 12, 24), null, "Christmas Eve", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", new TimeOnly(19, 0, 0), "SA" },
                    { new Guid("5eed0000-0000-4000-8000-000000000015"), new DateOnly(2026, 12, 31), null, "New Year's Eve", "NDIS-CODES 5.3: Fair Work Ombudsman 2026-27 list; not returned by the Nager.Date feed on 2 October 2026", new TimeOnly(19, 0, 0), "SA" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlanPricingSettings_TenantId",
                table: "PlanPricingSettings",
                column: "TenantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PublicHolidayOverrides_Date_State",
                table: "PublicHolidayOverrides",
                columns: new[] { "Date", "State" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlanPricingSettings");

            migrationBuilder.DropTable(
                name: "PublicHolidayOverrides");
        }
    }
}
