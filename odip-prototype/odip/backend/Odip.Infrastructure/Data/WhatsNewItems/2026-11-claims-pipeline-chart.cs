using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_pipeline_chart = new(
    new Item("2026-11-claims-pipeline-chart", "Claims sent and paid by week",
        "The Claims page now shows the dollars sent to the NDIA and paid in each of the last 12 weeks, and how much is still waiting on the NDIA.",
        Staff, false));
}
