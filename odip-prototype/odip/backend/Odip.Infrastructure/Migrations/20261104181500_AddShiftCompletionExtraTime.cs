using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Odip.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShiftCompletionExtraTime : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ExtraTime",
                table: "ShiftCompletions",
                type: "integer",
                nullable: true);

            // Completions already waiting for review with extra time (early start or late finish over 5 minutes) that Employment Hero has
            // not been sent: start them Pending (0), so they are held at rostered hours until a coordinator decides. Anything already sent
            // (an outbox row, EntityId = the completion id) keeps its hash and is never touched. A sleepover (NightType 3) has no extra time to decide.
            migrationBuilder.Sql(@"
UPDATE ""ShiftCompletions"" c SET ""ExtraTime"" = 0
FROM ""Shifts"" s
WHERE s.""Id"" = c.""ShiftId"" AND s.""Status"" = 5 AND s.""NightType"" <> 3 AND c.""IsActive""
  AND (c.""VarianceMinutesStart"" < -5 OR c.""VarianceMinutesEnd"" > 5)
  AND NOT EXISTS (SELECT 1 FROM ""EmploymentHeroOutbox"" o WHERE o.""Kind"" = 0 AND o.""EntityId"" = c.""Id"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ExtraTime",
                table: "ShiftCompletions");
        }
    }
}
