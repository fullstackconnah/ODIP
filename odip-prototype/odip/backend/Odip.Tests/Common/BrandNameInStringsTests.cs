using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Odip.Tests.Common;

/// <summary>
/// The product is "Bunya Support"; "ODIP" is only the internal code name. No string literal a person can read
/// (API refusals, emails, export README, PDF text) may say ODIP. Each kept case below is stored, compared or
/// machine-read, so changing it would break existing data or a parser.
/// </summary>
public class BrandNameInStringsTests
{
    private static readonly string[] SourceProjects = ["Odip.Api", "Odip.Application", "Odip.Domain", "Odip.Infrastructure"];

    // (file name, text inside the literal, why it stays)
    private static readonly (string File, string Contains, string Why)[] Kept =
    [
        ("MicrosoftAuthController.cs", "an ODIP user already has", "log message, never shown"),
        ("ProvisionalAgreementTemplate.cs", "ODIP-Service-Agreement-Blank-DRAFT", "persisted version and the names of the template files on disk"),
        ("IntakeIcs.cs", "-//ODIP//Intake visit//EN", "calendar PRODID, machine-read"),
        ("EmploymentHeroLeave.cs", "Sent from ODIP", "marker already written into Employment Hero notes and matched on read"),
        ("EmploymentHeroLeave.cs", "ODIP can't read this worker's Employment Hero id", "old LastError text still stored on outbox rows; IsWaiting matches it"),
    ];

    private static readonly Regex Literal = new(@"""(?:[^""\\]|\\.)*""", RegexOptions.Compiled);
    private static readonly Regex Brand = new(@"\bODIP\b", RegexOptions.Compiled);

    [Fact]
    public void NoReadableStringSaysOdip()
    {
        var root = BackendRoot();
        var hits = new List<string>();
        foreach (var project in SourceProjects)
        {
            var dir = Path.Combine(root, project);
            if (!Directory.Exists(dir)) continue;
            foreach (var path in Directory.EnumerateFiles(dir, "*.cs", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(root, path).Replace('\\', '/');
                if (rel.Contains("/bin/") || rel.Contains("/obj/") || rel.Contains("/Migrations/")) continue;
                var lines = File.ReadAllLines(path);
                for (var i = 0; i < lines.Length; i++)
                {
                    if (lines[i].TrimStart().StartsWith("//")) continue;
                    foreach (Match m in Literal.Matches(lines[i]))
                    {
                        if (!Brand.IsMatch(m.Value)) continue;
                        if (Kept.Any(k => rel.EndsWith("/" + k.File) && m.Value.Contains(k.Contains))) continue;
                        hits.Add($"{rel}:{i + 1}  {m.Value}");
                    }
                }
            }
        }
        Assert.True(hits.Count == 0, "Say \"Bunya Support\", not ODIP, in text a person reads (or add a kept case with its reason):\n" + string.Join("\n", hits));
    }

    private static string BackendRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir is not null && !File.Exists(Path.Combine(dir, "Odip.sln")))
            dir = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar));
        return dir ?? throw new InvalidOperationException($"Could not locate Odip.sln above {AppContext.BaseDirectory}");
    }
}
