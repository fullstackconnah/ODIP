using Odip.Infrastructure.DemoData.Packs;

namespace Odip.Infrastructure.DemoData;

/// <summary>
/// The packs a production tick runs, in dependency order: a pack may rely on rows an earlier pack inserted (shifts need patterns, leave
/// coverage tasks need shifts and leave). Each pack is its own transaction and its own failure domain, so the order only matters for
/// what a later pack can find, never for whether it runs.
/// </summary>
public static class DemoPacks
{
    public static IReadOnlyList<IDemoPack> Default() => new IDemoPack[]
    {
        new ProviderSettingsPack(),
        new StaffCredentialsPack(),
        new CompatibilityPack(),
        new EmergencyContactsPack(),
        new ShiftPatternsPack(),
        new LeaveAndAvailabilityPack(),
        new RosterWeeksPack(),
        new LeaveCoverageTasksPack(),
        new MedicationsPack(),
        new LiveSetPack(),
        new MedicationHistoryPack(),
        new ShiftPackageHistoryPack(),
    };
}
