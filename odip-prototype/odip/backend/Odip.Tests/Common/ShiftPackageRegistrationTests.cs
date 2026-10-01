using System.Reflection;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>
/// The shift-package services are injected into controllers with optional constructor parameters (so every existing test that
/// builds a controller by hand keeps compiling), which means a missing DI registration would NOT fail any unit test - MVC would
/// silently activate the controller with the default (null -> new) fallback, or fail at the first request. This guards that every
/// Odip.Infrastructure.Services type a package controller takes is registered in Program.cs.
/// </summary>
public class ShiftPackageRegistrationTests
{
    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException("Could not locate Odip.sln");
    }

    [Theory]
    [InlineData(typeof(PortalController))]
    [InlineData(typeof(MedicationsController))]
    [InlineData(typeof(RosteringController))]
    public void EveryInfrastructureServiceAPackageControllerTakes_IsRegisteredInProgramCs(Type controller)
    {
        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));

        var serviceTypes = controller.GetConstructors().Single().GetParameters()
            .Select(p => p.ParameterType)
            .Where(t => t.Namespace == "Odip.Infrastructure.Services")
            .ToList();

        Assert.NotEmpty(serviceTypes);   // each of these controllers takes at least one
        foreach (var type in serviceTypes)
            Assert.True(
                program.Contains($"AddScoped<Odip.Infrastructure.Services.{type.Name}>()"),
                $"{type.Name} is a {controller.Name} constructor parameter but is not registered in Program.cs.");
    }

    [Fact]
    public void TimeProviderIsRegistered_SoTheControllersAndServicesShareOneClock()
    {
        var program = File.ReadAllText(Path.Combine(BackendRoot(), "Odip.Api", "Program.cs"));

        Assert.Contains("AddSingleton(TimeProvider.System)", program);
    }
}
