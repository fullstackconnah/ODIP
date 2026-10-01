using System.Runtime.CompilerServices;

namespace Odip.Tests.Postgres;

/// <summary>
/// The app switches Npgsql to its legacy timestamp behaviour at startup (Odip.Api/Program.cs): a DateTime's Kind is persisted verbatim and a
/// Kind=Utc value may be written to a <c>timestamp without time zone</c> column or migration literal. Npgsql reads that switch ONCE, the first
/// time any Npgsql type mapping is used in the process, and test classes run in parallel - so a test that only builds a <c>UseNpgsql</c>
/// DbContext (ElectronicSigningEvidenceMigrationTests) can initialise Npgsql before a Postgres-backed test's fixture gets the chance to set it.
/// A module initializer runs before ANY test code in this assembly, so the switch is always in place first and the Postgres-backed tests are
/// not order-dependent.
/// </summary>
internal static class NpgsqlTestSwitches
{
    [ModuleInitializer]
    internal static void EnableLegacyTimestampBehavior() =>
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);
}
