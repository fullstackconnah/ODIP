using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreditNotePrefix",
                table: "ProviderSettings",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "CN-");

            migrationBuilder.AddColumn<string>(
                name: "InvoiceNumberPrefix",
                table: "ProviderSettings",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "INV-");

            migrationBuilder.AddColumn<int>(
                name: "InvoiceStartNumber",
                table: "ProviderSettings",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<int>(
                name: "PaymentTermsDays",
                table: "ProviderSettings",
                type: "integer",
                nullable: false,
                defaultValue: 14);

            migrationBuilder.CreateTable(
                name: "InvoiceNumberCounters",
                columns: table => new
                {
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    NextNumber = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceNumberCounters", x => new { x.TenantId, x.Kind });
                });

            migrationBuilder.CreateTable(
                name: "Invoices",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<int>(type: "integer", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    DisplayNumber = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    TripClaimId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimReference = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ParticipantBookingId = table.Column<Guid>(type: "uuid", nullable: true),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantName = table.Column<string>(type: "text", nullable: false),
                    NdisNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ServiceReference = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    IssueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    PayerKind = table.Column<int>(type: "integer", nullable: false),
                    BillToName = table.Column<string>(type: "text", nullable: false),
                    BillToAddress = table.Column<string>(type: "text", nullable: false),
                    BillToEmail = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SellerOrganisationName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SellerAbn = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SellerRegistrationNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SellerAddress = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SellerState = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    GstRegistered = table.Column<bool>(type: "boolean", nullable: false),
                    BankAccountName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Bsb = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    AccountNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    FooterNotes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PaymentTermsDays = table.Column<int>(type: "integer", nullable: false),
                    Subtotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Gst = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreditsInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreditsDisplayNumber = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: true),
                    VoidedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    VoidedById = table.Column<Guid>(type: "uuid", nullable: true),
                    VoidReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invoices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Invoices_Invoices_CreditsInvoiceId",
                        column: x => x.CreditsInvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_TripClaims_TripClaimId",
                        column: x => x.TripClaimId,
                        principalTable: "TripClaims",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceLines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClaimLineItemId = table.Column<Guid>(type: "uuid", nullable: true),
                    SupportItemCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ServiceFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    ServiceTo = table.Column<DateOnly>(type: "date", nullable: false),
                    Hours = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    LineTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GSTCode = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InvoiceLines_ClaimLineItems_ClaimLineItemId",
                        column: x => x.ClaimLineItemId,
                        principalTable: "ClaimLineItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_InvoiceLines_Invoices_InvoiceId",
                        column: x => x.InvoiceId,
                        principalTable: "Invoices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_ClaimLineItemId",
                table: "InvoiceLines",
                column: "ClaimLineItemId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceLines_InvoiceId",
                table: "InvoiceLines",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CreditsInvoiceId",
                table: "Invoices",
                column: "CreditsInvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_ParticipantBookingId",
                table: "Invoices",
                column: "ParticipantBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_ParticipantId",
                table: "Invoices",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TenantId_Kind_Number",
                table: "Invoices",
                columns: new[] { "TenantId", "Kind", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TripClaimId",
                table: "Invoices",
                column: "TripClaimId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InvoiceLines");

            migrationBuilder.DropTable(
                name: "InvoiceNumberCounters");

            migrationBuilder.DropTable(
                name: "Invoices");

            migrationBuilder.DropColumn(
                name: "CreditNotePrefix",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "InvoiceNumberPrefix",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "InvoiceStartNumber",
                table: "ProviderSettings");

            migrationBuilder.DropColumn(
                name: "PaymentTermsDays",
                table: "ProviderSettings");
        }
    }
}
