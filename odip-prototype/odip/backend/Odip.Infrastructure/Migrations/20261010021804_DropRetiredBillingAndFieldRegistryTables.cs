using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <summary>
    /// Drops the tables of the retired billing pipeline (BillableEvents, ClaimBatches, ServiceBookings, ServiceBookingLines) and of the
    /// retired field registry (FieldDefinitions, FieldValues, FormTemplates). Live row counts when this was written (2026-10-10):
    /// BillableEvents 0, ClaimBatches 0, ServiceBookings 0, FieldValues 0, FormTemplates 0, and 861 FieldDefinitions that were only the
    /// data-dictionary seed rows, so no user data is lost. FundingSources stays (the plan editor's billing hint reads it). Down() recreates
    /// the empty tables.
    /// </summary>
    /// <inheritdoc />
    public partial class DropRetiredBillingAndFieldRegistryTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BillableEvents");

            migrationBuilder.DropTable(
                name: "FieldValues");

            migrationBuilder.DropTable(
                name: "FormTemplates");

            migrationBuilder.DropTable(
                name: "ServiceBookingLines");

            migrationBuilder.DropTable(
                name: "ClaimBatches");

            migrationBuilder.DropTable(
                name: "FieldDefinitions");

            migrationBuilder.DropTable(
                name: "ServiceBookings");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ClaimBatches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    FileName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClaimBatches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FieldDefinitions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AppearsInForms = table.Column<List<string>>(type: "text[]", nullable: false),
                    Comments = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DataType = table.Column<int>(type: "integer", nullable: false),
                    Domain = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    FieldId = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    IsSensitive = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PicklistOptionsRaw = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldDefinitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "FormTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Sections = table.Column<string>(type: "jsonb", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FormTemplates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ServiceBookings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FundingSourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClaimWindowDays = table.Column<int>(type: "integer", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ProdaBookingReference = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceBookings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceBookings_FundingSources_FundingSourceId",
                        column: x => x.FundingSourceId,
                        principalTable: "FundingSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FieldValues",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FieldDefinitionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Value = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldValues", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FieldValues_FieldDefinitions_FieldDefinitionId",
                        column: x => x.FieldDefinitionId,
                        principalTable: "FieldDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FieldValues_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BillableEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FundingSourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    CancellationReasonCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    ClaimBatchId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimReference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ClaimType = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    DayType = table.Column<int>(type: "integer", nullable: false),
                    GstCode = table.Column<int>(type: "integer", nullable: false),
                    Hours = table.Column<TimeSpan>(type: "interval", nullable: true),
                    ParticipantApproved = table.Column<bool>(type: "boolean", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    RejectionReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ServiceBookingId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceEntityId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceEntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Stream = table.Column<int>(type: "integer", nullable: false),
                    SupportItemNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    SupportsDeliveredFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    SupportsDeliveredTo = table.Column<DateOnly>(type: "date", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    TotalAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillableEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BillableEvents_ClaimBatches_ClaimBatchId",
                        column: x => x.ClaimBatchId,
                        principalTable: "ClaimBatches",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillableEvents_FundingSources_FundingSourceId",
                        column: x => x.FundingSourceId,
                        principalTable: "FundingSources",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillableEvents_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BillableEvents_ServiceBookings_ServiceBookingId",
                        column: x => x.ServiceBookingId,
                        principalTable: "ServiceBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ServiceBookingLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceBookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    AllocatedAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ClaimedAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SupportItemNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceBookingLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceBookingLines_ServiceBookings_ServiceBookingId",
                        column: x => x.ServiceBookingId,
                        principalTable: "ServiceBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_ClaimBatchId",
                table: "BillableEvents",
                column: "ClaimBatchId");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_ClaimReference",
                table: "BillableEvents",
                column: "ClaimReference");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_FundingSourceId",
                table: "BillableEvents",
                column: "FundingSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_ParticipantId",
                table: "BillableEvents",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_ServiceBookingId",
                table: "BillableEvents",
                column: "ServiceBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_Status",
                table: "BillableEvents",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_Stream",
                table: "BillableEvents",
                column: "Stream");

            migrationBuilder.CreateIndex(
                name: "IX_BillableEvents_TenantId",
                table: "BillableEvents",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimBatches_FileName",
                table: "ClaimBatches",
                column: "FileName");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimBatches_SubmittedAt",
                table: "ClaimBatches",
                column: "SubmittedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ClaimBatches_TenantId",
                table: "ClaimBatches",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_FieldDefinitions_Domain",
                table: "FieldDefinitions",
                column: "Domain");

            migrationBuilder.CreateIndex(
                name: "IX_FieldDefinitions_IsActive",
                table: "FieldDefinitions",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_FieldDefinitions_TenantId",
                table: "FieldDefinitions",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_FieldDefinitions_TenantId_FieldId",
                table: "FieldDefinitions",
                columns: new[] { "TenantId", "FieldId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FieldValues_FieldDefinitionId",
                table: "FieldValues",
                column: "FieldDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_FieldValues_ParticipantId",
                table: "FieldValues",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_FieldValues_TenantId",
                table: "FieldValues",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_FieldValues_TenantId_ParticipantId_FieldDefinitionId",
                table: "FieldValues",
                columns: new[] { "TenantId", "ParticipantId", "FieldDefinitionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FormTemplates_Name",
                table: "FormTemplates",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_FormTemplates_TenantId",
                table: "FormTemplates",
                column: "TenantId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceBookingLines_ServiceBookingId",
                table: "ServiceBookingLines",
                column: "ServiceBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceBookings_FundingSourceId",
                table: "ServiceBookings",
                column: "FundingSourceId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceBookings_ProdaBookingReference",
                table: "ServiceBookings",
                column: "ProdaBookingReference");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceBookings_TenantId",
                table: "ServiceBookings",
                column: "TenantId");
        }
    }
}
