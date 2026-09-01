using Odip.Domain.Enums;
using Xunit;

namespace Odip.Tests.Routines;

/// <summary>
/// Direct unit coverage for <see cref="ParticipantRoutineDayMapper"/> (PD-4) — the wire
/// (<c>IReadOnlyList&lt;DayOfWeek&gt;</c>) ⇄ storage (<see cref="ParticipantRoutineDays"/> flags)
/// conversion, and the one-off data-migration conversion rule
/// (<see cref="ParticipantRoutineDayMapper.ConvertLegacyDayOfWeek"/>) that the
/// AddParticipantRoutineMultiDay migration's raw-SQL <c>CASE</c> expression mirrors but which
/// isn't itself unit-testable — this is the source of truth both are checked against.
/// </summary>
public class ParticipantRoutineDayMapperTests
{
    // ── ToFlags / ToDayList round-trip ──────────────────────────────────────

    [Fact]
    public void ToFlags_Null_ReturnsNone()
    {
        Assert.Equal(ParticipantRoutineDays.None, ParticipantRoutineDayMapper.ToFlags(null));
    }

    [Fact]
    public void ToFlags_EmptyList_ReturnsNone()
    {
        Assert.Equal(ParticipantRoutineDays.None, ParticipantRoutineDayMapper.ToFlags(Array.Empty<DayOfWeek>()));
    }

    [Fact]
    public void ToFlags_SingleDay_ReturnsThatBitOnly()
    {
        Assert.Equal(ParticipantRoutineDays.Saturday, ParticipantRoutineDayMapper.ToFlags(new[] { DayOfWeek.Saturday }));
    }

    [Fact]
    public void ToFlags_MonWedFri_ReturnsExactlyThoseThreeBits()
    {
        var flags = ParticipantRoutineDayMapper.ToFlags(new[] { DayOfWeek.Monday, DayOfWeek.Wednesday, DayOfWeek.Friday });

        Assert.Equal(
            ParticipantRoutineDays.Monday | ParticipantRoutineDays.Wednesday | ParticipantRoutineDays.Friday,
            flags);
        Assert.False(flags.HasFlag(ParticipantRoutineDays.Tuesday));
        Assert.False(flags.HasFlag(ParticipantRoutineDays.Saturday));
    }

    [Fact]
    public void ToFlags_AllSevenDays_ReturnsAll()
    {
        var everyDay = new[]
        {
            DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
            DayOfWeek.Friday, DayOfWeek.Saturday, DayOfWeek.Sunday,
        };

        Assert.Equal(ParticipantRoutineDays.All, ParticipantRoutineDayMapper.ToFlags(everyDay));
    }

    [Fact]
    public void ToFlags_DuplicateDaysInInput_CollapseHarmlessly()
    {
        var flags = ParticipantRoutineDayMapper.ToFlags(new[] { DayOfWeek.Monday, DayOfWeek.Monday, DayOfWeek.Tuesday });

        Assert.Equal(ParticipantRoutineDays.Monday | ParticipantRoutineDays.Tuesday, flags);
    }

    [Fact]
    public void ToDayList_All_ReturnsAllSevenInMondayFirstOrder()
    {
        var days = ParticipantRoutineDayMapper.ToDayList(ParticipantRoutineDays.All);

        Assert.Equal(
            new[]
            {
                DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
                DayOfWeek.Friday, DayOfWeek.Saturday, DayOfWeek.Sunday,
            },
            days);
    }

    [Fact]
    public void ToDayList_None_ReturnsEmptyList()
    {
        Assert.Empty(ParticipantRoutineDayMapper.ToDayList(ParticipantRoutineDays.None));
    }

    [Fact]
    public void ToDayList_WeekendOnly_ReturnsSaturdayThenSunday_MondayFirstOrder()
    {
        var days = ParticipantRoutineDayMapper.ToDayList(ParticipantRoutineDays.Saturday | ParticipantRoutineDays.Sunday);

        Assert.Equal(new[] { DayOfWeek.Saturday, DayOfWeek.Sunday }, days);
    }

    [Theory]
    [InlineData(DayOfWeek.Sunday)]
    [InlineData(DayOfWeek.Monday)]
    [InlineData(DayOfWeek.Tuesday)]
    [InlineData(DayOfWeek.Wednesday)]
    [InlineData(DayOfWeek.Thursday)]
    [InlineData(DayOfWeek.Friday)]
    [InlineData(DayOfWeek.Saturday)]
    public void ToFlags_ThenToDayList_RoundTripsEverySingleDay(DayOfWeek day)
    {
        var flags = ParticipantRoutineDayMapper.ToFlags(new[] { day });
        var roundTripped = ParticipantRoutineDayMapper.ToDayList(flags);

        Assert.Equal(new[] { day }, roundTripped);
    }

    // ── Migration conversion rule ────────────────────────────────────────────
    // Mirrors the AddParticipantRoutineMultiDay migration's raw-SQL CASE expression exactly:
    // NULL -> All (every day); a specific DayOfWeek -> that single bit. This is the logic under
    // test since the SQL itself isn't unit-testable.

    [Fact]
    public void ConvertLegacyDayOfWeek_Null_ConvertsToAll()
    {
        Assert.Equal(ParticipantRoutineDays.All, ParticipantRoutineDayMapper.ConvertLegacyDayOfWeek(null));
    }

    [Theory]
    [InlineData(DayOfWeek.Monday, ParticipantRoutineDays.Monday)]
    [InlineData(DayOfWeek.Tuesday, ParticipantRoutineDays.Tuesday)]
    [InlineData(DayOfWeek.Wednesday, ParticipantRoutineDays.Wednesday)]
    [InlineData(DayOfWeek.Thursday, ParticipantRoutineDays.Thursday)]
    [InlineData(DayOfWeek.Friday, ParticipantRoutineDays.Friday)]
    [InlineData(DayOfWeek.Saturday, ParticipantRoutineDays.Saturday)]
    [InlineData(DayOfWeek.Sunday, ParticipantRoutineDays.Sunday)]
    public void ConvertLegacyDayOfWeek_SpecificDay_ConvertsToThatSingleBit(DayOfWeek legacyDay, ParticipantRoutineDays expected)
    {
        Assert.Equal(expected, ParticipantRoutineDayMapper.ConvertLegacyDayOfWeek(legacyDay));
    }
}
