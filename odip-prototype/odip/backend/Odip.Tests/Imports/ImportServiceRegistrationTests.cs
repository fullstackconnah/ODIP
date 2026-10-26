using System.Text.RegularExpressions;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Imports;

/// <summary>
/// OnboardingImportService takes its roster and budget services as optional constructor parameters (so hand-built test instances keep compiling), which means
/// a missing registration in Program.cs would NOT fail any unit test: the host would silently hand it null and the Upcoming shifts import would throw at the
/// first request. Program.cs cannot start in a test, so this reads its registrations, as ShiftPackageRegistrationTests does for the package controllers.
/// </summary>
public class ImportServiceRegistrationTests
{
    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException("Could not locate Odip.sln");
    }

    [Fact]
    public void OnboardingImportService_AndEveryInfrastructureServiceItTakes_AreRegisteredInProgramCs()
    {
        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));
        var types = typeof(OnboardingImportService).GetConstructors().Single().GetParameters()
            .Select(p => p.ParameterType)
            .Where(t => t.Namespace is "Odip.Infrastructure.Services" or "Odip.Infrastructure.Rostering")
            .Append(typeof(OnboardingImportService))
            .ToList();

        Assert.Contains(typeof(Odip.Infrastructure.Rostering.RosterWeekStarter), types);
        Assert.Contains(typeof(Odip.Infrastructure.Rostering.RosterAvailability), types);
        Assert.Contains(typeof(ShiftBudgetCheck), types);
        foreach (var type in types)
            Assert.True(Regex.IsMatch(program, $@"Add(Scoped|Singleton|Transient)<[^>;]*\b{type.Name}>"), $"{type.Name} is not registered in Program.cs.");
    }
}
