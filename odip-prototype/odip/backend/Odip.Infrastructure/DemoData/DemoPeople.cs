namespace Odip.Infrastructure.DemoData;

/// <summary>
/// The existing Demo people the top-up builds its stories on, by the natural key the plan prescribes (4.2): staff by email, participants
/// by NDIS number. Ids are deliberately not used: a person the owner re-created (a new row, the same email) is still the person.
/// </summary>
public static class DemoPeople
{
    public const string TenantName = "Demo";
    public const string TenantEmailDomain = "demo.odip.com.au";

    /// <summary>Staff key to email. The key is what a story names ("james"); only the first ten are rosterable support staff.</summary>
    public static readonly IReadOnlyDictionary<string, string> StaffEmails = new Dictionary<string, string>
    {
        ["sarah"] = "sarah.mitchell@demo.odip.com.au",
        ["james"] = "james.obrien@demo.odip.com.au",
        ["emily"] = "emily.nguyen@demo.odip.com.au",
        ["daniel"] = "daniel.williams@demo.odip.com.au",
        ["rachel"] = "rachel.thompson@demo.odip.com.au",
        ["marcus"] = "marcus.papadopoulos@demo.odip.com.au",
        ["priya"] = "priya.sharma@demo.odip.com.au",
        ["lachlan"] = "lachlan.robertson@demo.odip.com.au",
        ["jade"] = "jade.watkins@demo.odip.com.au",
        ["brendan"] = "brendan.nguyen@demo.odip.com.au",
    };

    /// <summary>Participant key (first name) to NDIS number, from the old seed (DbSeeder.cs). All of them are fictional.</summary>
    public static readonly IReadOnlyDictionary<string, string> ParticipantNdisNumbers = new Dictionary<string, string>
    {
        ["liam"] = "430567891",
        ["sophie"] = "430567892",
        ["noah"] = "430567893",
        ["olivia"] = "430567894",
        ["ethan"] = "430567895",
        ["mia"] = "430567896",
        ["jack"] = "430567897",
        ["charlotte"] = "430567898",
        ["william"] = "430567899",
        ["isabella"] = "430567901",
        ["mason"] = "430567902",
        ["chloe"] = "430567903",
        ["thomas"] = "430567904",
        ["grace"] = "430567905",
        ["harrison"] = "430567906",
        ["ryan"] = "430567908",
        ["dylan"] = "430567910",
    };
}
