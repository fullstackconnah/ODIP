using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AccommodationProperties",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProviderOwner = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Address = table.Column<string>(type: "text", nullable: true),
                    Suburb = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Postcode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    ContactPerson = table.Column<string>(type: "text", nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Mobile = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Website = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    IsFullyModified = table.Column<bool>(type: "boolean", nullable: false),
                    IsSemiModified = table.Column<bool>(type: "boolean", nullable: false),
                    IsWheelchairAccessible = table.Column<bool>(type: "boolean", nullable: false),
                    AccessibilityNotes = table.Column<string>(type: "text", nullable: true),
                    BedroomCount = table.Column<int>(type: "integer", nullable: true),
                    BedCount = table.Column<int>(type: "integer", nullable: true),
                    MaxCapacity = table.Column<int>(type: "integer", nullable: true),
                    BeddingConfiguration = table.Column<string>(type: "text", nullable: true),
                    HoistBathroomNotes = table.Column<string>(type: "text", nullable: true),
                    GeneralNotes = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccommodationProperties", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Contacts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    RoleRelationship = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Organisation = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Mobile = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Address = table.Column<string>(type: "text", nullable: true),
                    Suburb = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Postcode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    PreferredContactMethod = table.Column<int>(type: "integer", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Contacts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EventTemplates",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EventName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DefaultDestination = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DefaultRegion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    PreferredTimeOfYear = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    StandardDurationDays = table.Column<int>(type: "integer", nullable: true),
                    AccessibilityNotes = table.Column<string>(type: "text", nullable: true),
                    FullyModifiedAccommodationNotes = table.Column<string>(type: "text", nullable: true),
                    SemiModifiedAccommodationNotes = table.Column<string>(type: "text", nullable: true),
                    WheelchairAccessNotes = table.Column<string>(type: "text", nullable: true),
                    TypicalActivities = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventTemplates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Participants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PreferredName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DateOfBirth = table.Column<DateOnly>(type: "date", nullable: true),
                    NdisNumber = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    PlanType = table.Column<int>(type: "integer", nullable: false),
                    Region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    FundingOrganisation = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    IsRepeatClient = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    WheelchairRequired = table.Column<bool>(type: "boolean", nullable: false),
                    IsHighSupport = table.Column<bool>(type: "boolean", nullable: false),
                    RequiresOvernightSupport = table.Column<bool>(type: "boolean", nullable: false),
                    HasRestrictivePracticeFlag = table.Column<bool>(type: "boolean", nullable: false),
                    SupportRatio = table.Column<int>(type: "integer", nullable: false),
                    MobilityNotes = table.Column<string>(type: "text", nullable: true),
                    EquipmentRequirements = table.Column<string>(type: "text", nullable: true),
                    TransportRequirements = table.Column<string>(type: "text", nullable: true),
                    MedicalSummary = table.Column<string>(type: "text", nullable: true),
                    BehaviourRiskSummary = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Participants", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Staff",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Mobile = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    Region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsDriverEligible = table.Column<bool>(type: "boolean", nullable: false),
                    IsFirstAidQualified = table.Column<bool>(type: "boolean", nullable: false),
                    IsMedicationCompetent = table.Column<bool>(type: "boolean", nullable: false),
                    IsManualHandlingCompetent = table.Column<bool>(type: "boolean", nullable: false),
                    IsOvernightEligible = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Staff", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Vehicles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Registration = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    VehicleType = table.Column<int>(type: "integer", nullable: false),
                    TotalSeats = table.Column<int>(type: "integer", nullable: false),
                    WheelchairPositions = table.Column<int>(type: "integer", nullable: false),
                    RampHoistDetails = table.Column<string>(type: "text", nullable: true),
                    DriverRequirements = table.Column<string>(type: "text", nullable: true),
                    IsInternal = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    ServiceDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    RegistrationDueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Vehicles", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Activities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventTemplateId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActivityName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    Location = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    AccessibilityNotes = table.Column<string>(type: "text", nullable: true),
                    SuitabilityNotes = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Activities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Activities_EventTemplates_EventTemplateId",
                        column: x => x.EventTemplateId,
                        principalTable: "EventTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "ParticipantContacts",
                columns: table => new
                {
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    ContactId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantContacts", x => new { x.ParticipantId, x.ContactId });
                    table.ForeignKey(
                        name: "FK_ParticipantContacts_Contacts_ContactId",
                        column: x => x.ContactId,
                        principalTable: "Contacts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ParticipantContacts_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SupportProfiles",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommunicationNotes = table.Column<string>(type: "text", nullable: true),
                    BehaviourSupportNotes = table.Column<string>(type: "text", nullable: true),
                    RestrictivePracticeDetails = table.Column<string>(type: "text", nullable: true),
                    ManualHandlingNotes = table.Column<string>(type: "text", nullable: true),
                    MedicationHealthSummary = table.Column<string>(type: "text", nullable: true),
                    EmergencyConsiderations = table.Column<string>(type: "text", nullable: true),
                    TravelSpecificNotes = table.Column<string>(type: "text", nullable: true),
                    ReviewDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupportProfiles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SupportProfiles_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StaffAvailabilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDateTime = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    EndDateTime = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    AvailabilityType = table.Column<int>(type: "integer", nullable: false),
                    IsRecurring = table.Column<bool>(type: "boolean", nullable: false),
                    RecurrenceNotes = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffAvailabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StaffAvailabilities_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TripInstances",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    TripCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    EventTemplateId = table.Column<Guid>(type: "uuid", nullable: true),
                    Destination = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Region = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DurationDays = table.Column<int>(type: "integer", nullable: false),
                    BookingCutoffDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    LeadCoordinatorId = table.Column<Guid>(type: "uuid", nullable: true),
                    MinParticipants = table.Column<int>(type: "integer", nullable: true),
                    MaxParticipants = table.Column<int>(type: "integer", nullable: true),
                    RequiredWheelchairCapacity = table.Column<int>(type: "integer", nullable: true),
                    RequiredBeds = table.Column<int>(type: "integer", nullable: true),
                    RequiredBedrooms = table.Column<int>(type: "integer", nullable: true),
                    MinStaffRequired = table.Column<int>(type: "integer", nullable: true),
                    CalculatedStaffRequired = table.Column<decimal>(type: "numeric", nullable: false),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripInstances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TripInstances_EventTemplates_EventTemplateId",
                        column: x => x.EventTemplateId,
                        principalTable: "EventTemplates",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_TripInstances_Staff_LeadCoordinatorId",
                        column: x => x.LeadCoordinatorId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "Users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PasswordHash = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Role = table.Column<int>(type: "integer", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    LastLoginAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Users", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Users_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "AccommodationReservations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccommodationPropertyId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestSentDate = table.Column<DateOnly>(type: "date", nullable: true),
                    DateBooked = table.Column<DateOnly>(type: "date", nullable: true),
                    DateConfirmed = table.Column<DateOnly>(type: "date", nullable: true),
                    CheckInDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CheckOutDate = table.Column<DateOnly>(type: "date", nullable: false),
                    BedroomsReserved = table.Column<int>(type: "integer", nullable: true),
                    BedsReserved = table.Column<int>(type: "integer", nullable: true),
                    Cost = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    ConfirmationReference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ReservationStatus = table.Column<int>(type: "integer", nullable: false),
                    Comments = table.Column<string>(type: "text", nullable: true),
                    CancellationReason = table.Column<string>(type: "text", nullable: true),
                    HasOverlapConflict = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AccommodationReservations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AccommodationReservations_AccommodationProperties_Accommoda~",
                        column: x => x.AccommodationPropertyId,
                        principalTable: "AccommodationProperties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AccommodationReservations_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ParticipantBookings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantId = table.Column<Guid>(type: "uuid", nullable: false),
                    BookingStatus = table.Column<int>(type: "integer", nullable: false),
                    BookingDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SupportRatioOverride = table.Column<int>(type: "integer", nullable: true),
                    NightSupportRequired = table.Column<bool>(type: "boolean", nullable: false),
                    WheelchairRequired = table.Column<bool>(type: "boolean", nullable: false),
                    HighSupportRequired = table.Column<bool>(type: "boolean", nullable: false),
                    HasRestrictivePracticeFlag = table.Column<bool>(type: "boolean", nullable: false),
                    PlanTypeOverride = table.Column<int>(type: "integer", nullable: true),
                    FundingNotes = table.Column<string>(type: "text", nullable: true),
                    RoomPreference = table.Column<string>(type: "text", nullable: true),
                    TransportNotes = table.Column<string>(type: "text", nullable: true),
                    EquipmentNotes = table.Column<string>(type: "text", nullable: true),
                    RiskSupportNotes = table.Column<string>(type: "text", nullable: true),
                    OopPaymentStatus = table.Column<string>(type: "text", nullable: true),
                    ActionRequired = table.Column<bool>(type: "boolean", nullable: false),
                    BookingNotes = table.Column<string>(type: "text", nullable: true),
                    CancellationReason = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ParticipantBookings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ParticipantBookings_Participants_ParticipantId",
                        column: x => x.ParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ParticipantBookings_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "StaffAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignmentRole = table.Column<string>(type: "text", nullable: true),
                    AssignmentStart = table.Column<DateOnly>(type: "date", nullable: false),
                    AssignmentEnd = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    IsDriver = table.Column<bool>(type: "boolean", nullable: false),
                    SleepoverType = table.Column<int>(type: "integer", nullable: false),
                    ShiftNotes = table.Column<string>(type: "text", nullable: true),
                    HasConflict = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StaffAssignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StaffAssignments_Staff_StaffId",
                        column: x => x.StaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StaffAssignments_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TripDays",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    DayNumber = table.Column<int>(type: "integer", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    DayTitle = table.Column<string>(type: "text", nullable: true),
                    DayNotes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripDays", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TripDays_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "VehicleAssignments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    VehicleId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ConfirmedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DriverStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    SeatRequirement = table.Column<int>(type: "integer", nullable: true),
                    WheelchairPositionRequirement = table.Column<int>(type: "integer", nullable: true),
                    PickupTravelNotes = table.Column<string>(type: "text", nullable: true),
                    Comments = table.Column<string>(type: "text", nullable: true),
                    HasOverlapConflict = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VehicleAssignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_VehicleAssignments_Staff_DriverStaffId",
                        column: x => x.DriverStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_VehicleAssignments_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_VehicleAssignments_Vehicles_VehicleId",
                        column: x => x.VehicleId,
                        principalTable: "Vehicles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "IncidentReports",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantBookingId = table.Column<Guid>(type: "uuid", nullable: true),
                    InvolvedParticipantId = table.Column<Guid>(type: "uuid", nullable: true),
                    InvolvedStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReportedByStaffId = table.Column<Guid>(type: "uuid", nullable: false),
                    IncidentType = table.Column<int>(type: "integer", nullable: false),
                    Severity = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    IncidentDateTime = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    Location = table.Column<string>(type: "text", nullable: true),
                    ImmediateActionsTaken = table.Column<string>(type: "text", nullable: true),
                    WereEmergencyServicesCalled = table.Column<bool>(type: "boolean", nullable: false),
                    EmergencyServicesDetails = table.Column<string>(type: "text", nullable: true),
                    WitnessNames = table.Column<string>(type: "text", nullable: true),
                    WitnessStatements = table.Column<string>(type: "text", nullable: true),
                    QscReportingStatus = table.Column<int>(type: "integer", nullable: false),
                    QscReportedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    QscReferenceNumber = table.Column<string>(type: "text", nullable: true),
                    ReviewedByStaffId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    ReviewNotes = table.Column<string>(type: "text", nullable: true),
                    CorrectiveActions = table.Column<string>(type: "text", nullable: true),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    FamilyNotified = table.Column<bool>(type: "boolean", nullable: false),
                    FamilyNotifiedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    SupportCoordinatorNotified = table.Column<bool>(type: "boolean", nullable: false),
                    SupportCoordinatorNotifiedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncidentReports", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncidentReports_ParticipantBookings_ParticipantBookingId",
                        column: x => x.ParticipantBookingId,
                        principalTable: "ParticipantBookings",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_IncidentReports_Participants_InvolvedParticipantId",
                        column: x => x.InvolvedParticipantId,
                        principalTable: "Participants",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_IncidentReports_Staff_InvolvedStaffId",
                        column: x => x.InvolvedStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_IncidentReports_Staff_ReportedByStaffId",
                        column: x => x.ReportedByStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_IncidentReports_Staff_ReviewedByStaffId",
                        column: x => x.ReviewedByStaffId,
                        principalTable: "Staff",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_IncidentReports_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TripDocuments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantBookingId = table.Column<Guid>(type: "uuid", nullable: true),
                    DocumentType = table.Column<int>(type: "integer", nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    FilePath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    FileSize = table.Column<long>(type: "bigint", nullable: true),
                    DocumentDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TripDocuments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TripDocuments_ParticipantBookings_ParticipantBookingId",
                        column: x => x.ParticipantBookingId,
                        principalTable: "ParticipantBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_TripDocuments_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledActivities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripDayId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActivityId = table.Column<Guid>(type: "uuid", nullable: true),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    EndTime = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    Location = table.Column<string>(type: "text", nullable: true),
                    AccessibilityNotes = table.Column<string>(type: "text", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledActivities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScheduledActivities_Activities_ActivityId",
                        column: x => x.ActivityId,
                        principalTable: "Activities",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ScheduledActivities_TripDays_TripDayId",
                        column: x => x.TripDayId,
                        principalTable: "TripDays",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookingTasks",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TripInstanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ParticipantBookingId = table.Column<Guid>(type: "uuid", nullable: true),
                    AccommodationReservationId = table.Column<Guid>(type: "uuid", nullable: true),
                    VehicleAssignmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    StaffAssignmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    TaskType = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    CompletedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Notes = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp without time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookingTasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookingTasks_AccommodationReservations_AccommodationReserva~",
                        column: x => x.AccommodationReservationId,
                        principalTable: "AccommodationReservations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BookingTasks_ParticipantBookings_ParticipantBookingId",
                        column: x => x.ParticipantBookingId,
                        principalTable: "ParticipantBookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BookingTasks_StaffAssignments_StaffAssignmentId",
                        column: x => x.StaffAssignmentId,
                        principalTable: "StaffAssignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BookingTasks_Staff_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "Staff",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BookingTasks_TripInstances_TripInstanceId",
                        column: x => x.TripInstanceId,
                        principalTable: "TripInstances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BookingTasks_VehicleAssignments_VehicleAssignmentId",
                        column: x => x.VehicleAssignmentId,
                        principalTable: "VehicleAssignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationProperties_IsActive",
                table: "AccommodationProperties",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationProperties_IsWheelchairAccessible",
                table: "AccommodationProperties",
                column: "IsWheelchairAccessible");

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationProperties_Region",
                table: "AccommodationProperties",
                column: "Region");

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationReservations_AccommodationPropertyId_CheckInDa~",
                table: "AccommodationReservations",
                columns: new[] { "AccommodationPropertyId", "CheckInDate", "CheckOutDate" });

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationReservations_ReservationStatus",
                table: "AccommodationReservations",
                column: "ReservationStatus");

            migrationBuilder.CreateIndex(
                name: "IX_AccommodationReservations_TripInstanceId",
                table: "AccommodationReservations",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_Category",
                table: "Activities",
                column: "Category");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_EventTemplateId",
                table: "Activities",
                column: "EventTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_Activities_IsActive",
                table: "Activities",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_AccommodationReservationId",
                table: "BookingTasks",
                column: "AccommodationReservationId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_DueDate",
                table: "BookingTasks",
                column: "DueDate");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_OwnerId",
                table: "BookingTasks",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_ParticipantBookingId",
                table: "BookingTasks",
                column: "ParticipantBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_Priority",
                table: "BookingTasks",
                column: "Priority");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_StaffAssignmentId",
                table: "BookingTasks",
                column: "StaffAssignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_Status",
                table: "BookingTasks",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_TaskType",
                table: "BookingTasks",
                column: "TaskType");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_TripInstanceId",
                table: "BookingTasks",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_BookingTasks_VehicleAssignmentId",
                table: "BookingTasks",
                column: "VehicleAssignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_Contacts_IsActive",
                table: "Contacts",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_EventTemplates_EventCode",
                table: "EventTemplates",
                column: "EventCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EventTemplates_IsActive",
                table: "EventTemplates",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_InvolvedParticipantId",
                table: "IncidentReports",
                column: "InvolvedParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_InvolvedStaffId",
                table: "IncidentReports",
                column: "InvolvedStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_IsActive",
                table: "IncidentReports",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ParticipantBookingId",
                table: "IncidentReports",
                column: "ParticipantBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_QscReportingStatus",
                table: "IncidentReports",
                column: "QscReportingStatus");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ReportedByStaffId",
                table: "IncidentReports",
                column: "ReportedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_ReviewedByStaffId",
                table: "IncidentReports",
                column: "ReviewedByStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_Severity",
                table: "IncidentReports",
                column: "Severity");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_Status",
                table: "IncidentReports",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_IncidentReports_TripInstanceId",
                table: "IncidentReports",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantBookings_BookingStatus",
                table: "ParticipantBookings",
                column: "BookingStatus");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantBookings_ParticipantId",
                table: "ParticipantBookings",
                column: "ParticipantId");

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantBookings_TripInstanceId_ParticipantId",
                table: "ParticipantBookings",
                columns: new[] { "TripInstanceId", "ParticipantId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ParticipantContacts_ContactId",
                table: "ParticipantContacts",
                column: "ContactId");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_IsActive",
                table: "Participants",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_NdisNumber",
                table: "Participants",
                column: "NdisNumber");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_Region",
                table: "Participants",
                column: "Region");

            migrationBuilder.CreateIndex(
                name: "IX_Participants_SupportRatio",
                table: "Participants",
                column: "SupportRatio");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledActivities_ActivityId",
                table: "ScheduledActivities",
                column: "ActivityId");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledActivities_SortOrder",
                table: "ScheduledActivities",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledActivities_TripDayId",
                table: "ScheduledActivities",
                column: "TripDayId");

            migrationBuilder.CreateIndex(
                name: "IX_Staff_IsActive",
                table: "Staff",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_Staff_Region",
                table: "Staff",
                column: "Region");

            migrationBuilder.CreateIndex(
                name: "IX_Staff_Role",
                table: "Staff",
                column: "Role");

            migrationBuilder.CreateIndex(
                name: "IX_StaffAssignments_StaffId_AssignmentStart_AssignmentEnd",
                table: "StaffAssignments",
                columns: new[] { "StaffId", "AssignmentStart", "AssignmentEnd" });

            migrationBuilder.CreateIndex(
                name: "IX_StaffAssignments_Status",
                table: "StaffAssignments",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_StaffAssignments_TripInstanceId",
                table: "StaffAssignments",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_StaffAvailabilities_AvailabilityType",
                table: "StaffAvailabilities",
                column: "AvailabilityType");

            migrationBuilder.CreateIndex(
                name: "IX_StaffAvailabilities_StaffId_StartDateTime_EndDateTime",
                table: "StaffAvailabilities",
                columns: new[] { "StaffId", "StartDateTime", "EndDateTime" });

            migrationBuilder.CreateIndex(
                name: "IX_SupportProfiles_ParticipantId",
                table: "SupportProfiles",
                column: "ParticipantId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TripDays_TripInstanceId_DayNumber",
                table: "TripDays",
                columns: new[] { "TripInstanceId", "DayNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TripDocuments_DocumentType",
                table: "TripDocuments",
                column: "DocumentType");

            migrationBuilder.CreateIndex(
                name: "IX_TripDocuments_ParticipantBookingId",
                table: "TripDocuments",
                column: "ParticipantBookingId");

            migrationBuilder.CreateIndex(
                name: "IX_TripDocuments_TripInstanceId",
                table: "TripDocuments",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_EventTemplateId",
                table: "TripInstances",
                column: "EventTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_LeadCoordinatorId",
                table: "TripInstances",
                column: "LeadCoordinatorId");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_Region",
                table: "TripInstances",
                column: "Region");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_StartDate",
                table: "TripInstances",
                column: "StartDate");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_Status",
                table: "TripInstances",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TripInstances_TripCode",
                table: "TripInstances",
                column: "TripCode",
                unique: true,
                filter: "\"TripCode\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Email",
                table: "Users",
                column: "Email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Users_IsActive",
                table: "Users",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_Users_StaffId",
                table: "Users",
                column: "StaffId");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_VehicleAssignments_DriverStaffId",
                table: "VehicleAssignments",
                column: "DriverStaffId");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleAssignments_Status",
                table: "VehicleAssignments",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleAssignments_TripInstanceId",
                table: "VehicleAssignments",
                column: "TripInstanceId");

            migrationBuilder.CreateIndex(
                name: "IX_VehicleAssignments_VehicleId",
                table: "VehicleAssignments",
                column: "VehicleId");

            migrationBuilder.CreateIndex(
                name: "IX_Vehicles_IsActive",
                table: "Vehicles",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_Vehicles_VehicleType",
                table: "Vehicles",
                column: "VehicleType");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BookingTasks");

            migrationBuilder.DropTable(
                name: "IncidentReports");

            migrationBuilder.DropTable(
                name: "ParticipantContacts");

            migrationBuilder.DropTable(
                name: "ScheduledActivities");

            migrationBuilder.DropTable(
                name: "StaffAvailabilities");

            migrationBuilder.DropTable(
                name: "SupportProfiles");

            migrationBuilder.DropTable(
                name: "TripDocuments");

            migrationBuilder.DropTable(
                name: "Users");

            migrationBuilder.DropTable(
                name: "AccommodationReservations");

            migrationBuilder.DropTable(
                name: "StaffAssignments");

            migrationBuilder.DropTable(
                name: "VehicleAssignments");

            migrationBuilder.DropTable(
                name: "Contacts");

            migrationBuilder.DropTable(
                name: "Activities");

            migrationBuilder.DropTable(
                name: "TripDays");

            migrationBuilder.DropTable(
                name: "ParticipantBookings");

            migrationBuilder.DropTable(
                name: "AccommodationProperties");

            migrationBuilder.DropTable(
                name: "Vehicles");

            migrationBuilder.DropTable(
                name: "Participants");

            migrationBuilder.DropTable(
                name: "TripInstances");

            migrationBuilder.DropTable(
                name: "EventTemplates");

            migrationBuilder.DropTable(
                name: "Staff");
        }
    }
}
