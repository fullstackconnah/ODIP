namespace Odip.Tests.TestSupport;

public static class RepositoryPaths
{
    /// <summary>The repository root, found from the backend's Odip.sln; null where the repository is not next to the test assembly (the Docker image build's context is the backend folder alone).</summary>
    public static string? RepositoryRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
        {
            var parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
            if (parent == dir) return null;
            dir = parent;
        }
        return dir is null ? null : Path.GetFullPath(Path.Combine(dir, "..", "..", ".."));        // backend, odip, odip-prototype, the repository
    }
}
