using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMedications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ParticipantMedications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Strength = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Form = table.Column<int>(type: "integer", nullable: false),
                    Route = table.Column<int>(type: "integer", nullable: false),
                    DoseDescription = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Directions = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    TimesOfDay = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PrnIndication = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PrnMaxDosesPer24h = table.Column<int>(type: "integer", nullable: true),
                    PrnMinIntervalMinutes = table.Column<int>(type: "integer", nullable: true),
                    Purpose = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsPsychotropic = table.Column<bool>(type: "boolean", nullable: false),
                    IsChemicalRestraint = table.Column<bool>(type: "boolean", nullable: false),
                    BspInPlace = table.Column<bool>(type: "boolean", nullable: false),
                    RestrictivePracticeAuthorisationRef = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsHighRisk = table.Column<bool>(type: "boolean", nullable: false),
                    IsHighIntensitySupport = table.Column<bool>(type: "boolean", nullable: false),
                    DrugSchedule = table.Column<int>(type: "integer", nullable: false),
                    SupportLevel = table.Column<int>(type: "integer", nullable: false),
                    PrescriberName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    PharmacyName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsDoseAidPacked = table.Column<bool>(type: "boolean", nullable: false),
                    StartDate = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    EndDate = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    NextReviewDue = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    ConsentObtained = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentGivenBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ConsentDate = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    StorageRequirements = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantMedications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantMedications_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ParticipantMedications_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MedicationAdministrations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantMedicationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: true),
                    ScheduledAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    AdministeredAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DoseGiven = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RecordedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    WitnessName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    PrnReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PrnOutcome = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    PrnOutcomeAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    LimitBreachAcknowledged = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MedicationAdministrations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MedicationAdministrations_ParticipantMedications_Participan~",
                        column: x => x.ParticipantMedicationId,
                        principalTable: "ParticipantMedications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MedicationAdministrations_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MedicationAdministrations_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MedicationAdministrations_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_ParticipantId",
                table: "MedicationAdministrations",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_ParticipantMedicationId_Administe~",
                table: "MedicationAdministrations",
                columns: new[] { "ParticipantMedicationId", "AdministeredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_TenantId",
                table: "MedicationAdministrations",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_MedicationAdministrations_TripInstanceId",
                table: "MedicationAdministrations",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantMedications_ParticipantId",
                table: "ParticipantMedications",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantMedications_Status",
                table: "ParticipantMedications",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantMedications_TenantId",
                table: "ParticipantMedications",
                column: "TenantId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MedicationAdministrations");

            migrationBuilder.DropTable(
                name: "ParticipantMedications");
        }
    }
}
