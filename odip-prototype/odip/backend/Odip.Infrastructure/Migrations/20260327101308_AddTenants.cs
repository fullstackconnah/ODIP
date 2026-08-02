using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddTenants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "Vehicles",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "Users",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "TripInstances",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "Staff",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "Participants",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "EventTemplates",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.AddColumn<Guid>(
                name: "TenantId",
                table: "AccommodationProperties",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "Tenants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    EmailDomain = table.Column<string>(type: "text", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Tenants", x => x.Id);
                });

            // Drop old AppSettings table if it exists (created by prior raw SQL seed)
            // The table previously had int Id (singleton pattern) — now replaced with Guid Id + TenantId
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"AppSettings\"");

            migrationBuilder.CreateTable(
                name: "AppSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    QualificationWarningDays = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AppSettings_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Vehicles_TenantId",
                table: "Vehicles",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_TenantId",
                table: "Users",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_TenantId",
                table: "TripInstances",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Staff_TenantId",
                table: "Staff",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_TenantId",
                table: "Participants",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_EventTemplates_TenantId",
                table: "EventTemplates",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationProperties_TenantId",
                table: "AccommodationProperties",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_AppSettings_TenantId",
                table: "AppSettings",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_Tenants_EmailDomain",
                table: "Tenants",
                column: "EmailDomain",
                unique: true);

            migrationBuilder.InsertData(
                table: "Tenants",
                columns: new[] { "Id", "Name", "EmailDomain", "IsActive", "CreatedAt" },
                values: new object[]
                {
                    new Guid("00000000-0000-0000-0000-000000000001"),
                    "Connah",
                    "connah.com.au",
                    true,
                    new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                });

            // Update existing rows to use the seed tenant (zero UUID is not a valid FK target)
            migrationBuilder.Sql("UPDATE \"AccommodationProperties\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"EventTemplates\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"Participants\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"Staff\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"TripInstances\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"Users\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");
            migrationBuilder.Sql("UPDATE \"Vehicles\" SET \"TenantId\" = '00000000-0000-0000-0000-000000000001' WHERE \"TenantId\" = '00000000-0000-0000-0000-000000000000'");

            migrationBuilder.AddForeignKey(
                name: "FK_AccommodationProperties_Tenants_TenantId",
                table: "AccommodationProperties",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_EventTemplates_Tenants_TenantId",
                table: "EventTemplates",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Participants_Tenants_TenantId",
                table: "Participants",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Staff_Tenants_TenantId",
                table: "Staff",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_TripInstances_Tenants_TenantId",
                table: "TripInstances",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Users_Tenants_TenantId",
                table: "Users",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Vehicles_Tenants_TenantId",
                table: "Vehicles",
                column: "TenantId",
                principalTable: "Tenants",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AccommodationProperties_Tenants_TenantId",
                table: "AccommodationProperties");

            migrationBuilder.DropForeignKey(
                name: "FK_EventTemplates_Tenants_TenantId",
                table: "EventTemplates");

            migrationBuilder.DropForeignKey(
                name: "FK_Participants_Tenants_TenantId",
                table: "Participants");

            migrationBuilder.DropForeignKey(
                name: "FK_Staff_Tenants_TenantId",
                table: "Staff");

            migrationBuilder.DropForeignKey(
                name: "FK_TripInstances_Tenants_TenantId",
                table: "TripInstances");

            migrationBuilder.DropForeignKey(
                name: "FK_Users_Tenants_TenantId",
                table: "Users");

            migrationBuilder.DropForeignKey(
                name: "FK_Vehicles_Tenants_TenantId",
                table: "Vehicles");

            migrationBuilder.DropTable(
                name: "AppSettings");

            migrationBuilder.DeleteData(
                table: "Tenants",
                keyColumn: "Id",
                keyValue: new Guid("00000000-0000-0000-0000-000000000001"));

            migrationBuilder.DropTable(
                name: "Tenants");

            migrationBuilder.DropIndex(
                name: "IX_Vehicles_TenantId",
                table: "Vehicles");

            migrationBuilder.DropIndex(
                name: "IX_Users_TenantId",
                table: "Users");

            migrationBuilder.DropIndex(
                name: "IX_TripInstances_TenantId",
                table: "TripInstances");

            migrationBuilder.DropIndex(
                name: "IX_Staff_TenantId",
                table: "Staff");

            migrationBuilder.DropIndex(
                name: "IX_Participants_TenantId",
                table: "Participants");

            migrationBuilder.DropIndex(
                name: "IX_EventTemplates_TenantId",
                table: "EventTemplates");

            migrationBuilder.DropIndex(
                name: "IX_AccommodationProperties_TenantId",
                table: "AccommodationProperties");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Vehicles");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "TripInstances");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "EventTemplates");

            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "AccommodationProperties");
        }
    }
}
