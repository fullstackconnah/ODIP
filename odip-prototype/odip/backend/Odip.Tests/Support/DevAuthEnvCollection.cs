using Xunit;

namespace Odip.Tests.Support;

/// <summary>Tests that set the process-wide DEV_AUTH_ENABLED variable run one at a time, so none reads another's value.</summary>
[CollectionDefinition(Name)]
public class DevAuthEnvCollection
{
    public const string Name = "DevAuthEnv";
}
