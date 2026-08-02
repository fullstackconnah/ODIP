using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNdisClaiming : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            migrationBuilder.Sql("""ALTER TABLE "ParticipantBookings" DROP COLUMN IF EXISTS "OopPaymentStatus";""");

            migrationBuilder.AddColumn<decimal>(
                name: "ActiveHoursPerDay",
                table: "TripInstances",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "DefaultActivityGroupId",
                table: "TripInstances",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsPublicHoliday",
                table: "TripDays",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<decimal>(
                name: "OvernightHours",
                table: "TripDays",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "OvernightType",
                table: "TripDays",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // These columns were already added by Program.cs raw SQL on pre-migration databases
            // (via AddPaymentStatusToBooking which was pre-populated as applied but never ran).
            // Use IF NOT EXISTS to handle both old DBs (columns exist) and fresh DBs (need to add them).
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "DriverLicenceExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "FirstAidExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "ManualHandlingExpiryDate" date;""");
            migrationBuilder.Sql("""ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "MedicationCompetencyExpiryDate" date;""");

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanEndDate",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PlanManagerContactId",
                table: "Participants",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "PlanStartDate",
                table: "Participants",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CancellationNoticeDate",
                table: "ParticipantBookings",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ClaimStatus",
                table: "ParticipantBookings",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // PaymentStatus was already added by AddPaymentStatusToBooking which ran directly on the DB
            migrationBuilder.Sql("""ALTER TABLE "ParticipantBookings" ADD COLUMN IF NOT EXISTS "PaymentStatus" integer NOT NULL DEFAULT 0;""");

            migrationBuilder.AddColumn<int>(
                name: "ContactType",
                table: "Contacts",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "AppSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    QualificationWarningDays = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ProviderSettings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RegistrationNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ABN = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OrganisationName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    GSTRegistered = table.Column<bool>(type: "boolean", nullable: false),
                    IsPaceProvider = table.Column<bool>(type: "boolean", nullable: false),
                    BankAccountName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    BSB = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    AccountNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    InvoiceFooterNotes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProviderSettings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PublicHolidays",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PublicHolidays", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SupportActivityGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SupportCategory = table.Column<int>(type: "integer", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupportActivityGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TripClaims",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ClaimReference = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalApprovedAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    SubmittedDate = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    PaidDate = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    AuthorisedByStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripClaims", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TripClaims_Staff_AuthorisedByStaffId",
                        column: x => x.AuthorisedByStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_TripClaims_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SupportCatalogueItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityGroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    ItemNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Unit = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    DayType = table.Column<int>(type: "integer", nullable: false),
                    PriceLimit_Standard = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_1to2 = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_1to3 = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_1to4 = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_1to5 = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_Remote = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PriceLimit_VeryRemote = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CatalogueVersion = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EffectiveFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    EffectiveTo = table.Column<DateOnly>(type: "date", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupportCatalogueItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SupportCatalogueItems_SupportActivityGroups_ActivityGroupId",
                        column: x => x.ActivityGroupId,
                        principalTable: "SupportActivityGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ClaimLineItems",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripClaimId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantBookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    SupportItemCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    DayType = table.Column<int>(type: "integer", nullable: false),
                    SupportsDeliveredFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    SupportsDeliveredTo = table.Column<DateOnly>(type: "date", nullable: false),
                    Hours = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GSTCode = table.Column<int>(type: "integer", nullable: false),
                    ClaimType = table.Column<int>(type: "integer", nullable: false),
                    ParticipantApproved = table.Column<bool>(type: "boolean", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    RejectionReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    PaidAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClaimLineItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ClaimLineItems_ParticipantBookings_ParticipantBookingId",
                        column: x => x.ParticipantBookingId,
                        principalTable: "ParticipantBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClaimLineItems_TripClaims_TripClaimId",
                        column: x => x.TripClaimId,
                        principalTable: "TripClaims",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_DefaultActivityGroupId",
                table: "TripInstances",
                column: "DefaultActivityGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_PlanManagerContactId",
                table: "Participants",
                column: "PlanManagerContactId");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_ParticipantBookingId",
                table: "ClaimLineItems",
                column: "ParticipantBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_Status",
                table: "ClaimLineItems",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimLineItems_TripClaimId",
                table: "ClaimLineItems",
                column: "TripClaimId");

            migrationBuilder.CreateIndex(
                name: "IX_PublicHolidays_Date",
                table: "PublicHolidays",
                column: "Date");

            migrationBuilder.CreateIndex(
                name: "IX_PublicHolidays_Date_State",
                table: "PublicHolidays",
                columns: new[] { "Date", "State" });

            migrationBuilder.CreateIndex(
                name: "IX_SupportActivityGroups_GroupCode",
                table: "SupportActivityGroups",
                column: "GroupCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SupportActivityGroups_IsActive",
                table: "SupportActivityGroups",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_SupportCatalogueItems_ActivityGroupId",
                table: "SupportCatalogueItems",
                column: "ActivityGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_SupportCatalogueItems_DayType",
                table: "SupportCatalogueItems",
                column: "DayType");

            migrationBuilder.CreateIndex(
                name: "IX_SupportCatalogueItems_IsActive",
                table: "SupportCatalogueItems",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_SupportCatalogueItems_ItemNumber_CatalogueVersion",
                table: "SupportCatalogueItems",
                columns: new[] { "ItemNumber", "CatalogueVersion" });

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_AuthorisedByStaffId",
                table: "TripClaims",
                column: "AuthorisedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_ClaimReference",
                table: "TripClaims",
                column: "ClaimReference",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_Status",
                table: "TripClaims",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TripClaims_TripInstanceId",
                table: "TripClaims",
                column: "TripInstanceId");

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Participants_Contacts_PlanManagerContactId",
                table: "Participants",
                column: "PlanManagerContactId",
                principalTable: "Contacts",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_TripInstances_SupportActivityGroups_DefaultActivityGroupId",
                table: "TripInstances",
                column: "DefaultActivityGroupId",
                principalTable: "SupportActivityGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports");

            migrationBuilder.DropForeignKey(
                name: "FK_Participants_Contacts_PlanManagerContactId",
                table: "Participants");

            migrationBuilder.DropForeignKey(
                name: "FK_TripInstances_SupportActivityGroups_DefaultActivityGroupId",
                table: "TripInstances");

            migrationBuilder.DropTable(
                name: "AppSettings");

            migrationBuilder.DropTable(
                name: "ClaimLineItems");

            migrationBuilder.DropTable(
                name: "ProviderSettings");

            migrationBuilder.DropTable(
                name: "PublicHolidays");

            migrationBuilder.DropTable(
                name: "SupportCatalogueItems");

            migrationBuilder.DropTable(
                name: "TripClaims");

            migrationBuilder.DropTable(
                name: "SupportActivityGroups");

            migrationBuilder.DropIndex(
                name: "IX_TripInstances_DefaultActivityGroupId",
                table: "TripInstances");

            migrationBuilder.DropIndex(
                name: "IX_Participants_PlanManagerContactId",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "ActiveHoursPerDay",
                table: "TripInstances");

            migrationBuilder.DropColumn(
                name: "DefaultActivityGroupId",
                table: "TripInstances");

            migrationBuilder.DropColumn(
                name: "IsPublicHoliday",
                table: "TripDays");

            migrationBuilder.DropColumn(
                name: "OvernightHours",
                table: "TripDays");

            migrationBuilder.DropColumn(
                name: "OvernightType",
                table: "TripDays");

            migrationBuilder.DropColumn(
                name: "DriverLicenceExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "FirstAidExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "ManualHandlingExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "MedicationCompetencyExpiryDate",
                table: "Staff");

            migrationBuilder.DropColumn(
                name: "PlanEndDate",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PlanManagerContactId",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "PlanStartDate",
                table: "Participants");

            migrationBuilder.DropColumn(
                name: "CancellationNoticeDate",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "ClaimStatus",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "PaymentStatus",
                table: "ParticipantBookings");

            migrationBuilder.DropColumn(
                name: "ContactType",
                table: "Contacts");

            migrationBuilder.AddColumn<string>(
                name: "OopPaymentStatus",
                table: "ParticipantBookings",
                type: "text",
                nullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_IncidentReports_TripInstances_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId",
                principalTable: "TripInstances",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
