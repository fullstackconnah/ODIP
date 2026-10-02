using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The staff witness of a high-risk dose answers it at 08:30 the next morning on the provider's clock (the request is "due the day after", and the
/// next shift is the first chance to open it in the portal). So the dose a viewer sees given today has a witness request waiting (the story, and the
/// <c>high-risk-medication-witness-gap</c> alert), and every earlier one is signed off, its obligation task closed as the portal closes it
/// (Completed, the provider's date, the instant). Only a request that is still Pending is answered, and only one this top-up recorded (its
/// idempotency key says so): a witness's own answer, or a coordinator's edit, wins. Shared by every pack that records a high-risk dose, so a dose
/// written by a catch-up is answered in the same tick.
/// </summary>
internal static class WitnessAnswers
{
    /// <summary>The next morning, on the provider's clock.</summary>
    public static readonly TimeOnly At = new(8, 30);

    private const int GraceMinutes = 2;

    public static async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var answers = (await DemoQueries.PendingWitnessDoses(run.Db).ToListAsync(ct))
            .Where(d => d.WitnessUserId is not null && d.WitnessRequestedAt is not null)
            .Select(d => (Dose: d, At: AnswerTime(anchors, d)))
            .Where(x => x.At.AddMinutes(GraceMinutes) <= anchors.NowUtc)
            .ToList();
        if (answers.Count == 0) return;

        var staff = await run.FreshStaffAsync(ct);
        var tasks = (await DemoQueries.OpenTasksByKeys(run.Db, answers.Select(x => $"med-witness:{x.Dose.Id}").ToList()).ToListAsync(ct))
            .ToDictionary(t => t.SourceKey!);
        foreach (var (dose, at) in answers)
        {
            var witness = staff.Values.FirstOrDefault(u => u.Id == dose.WitnessUserId);
            if (witness is null) continue;                                          // somebody the stories do not name: not ours to answer for

            var local = ProviderLocalTime.UtcToLocal(at, anchors.Zone);
            PackageRows.WitnessApproved(run, dose, local);
            run.StampAudit(dose.Id, dose.WitnessRespondedAt!.Value, witness);
            if (tasks.TryGetValue($"med-witness:{dose.Id}", out var task))
            {
                task.Status = TaskItemStatus.Completed;
                task.CompletedDate = DateOnly.FromDateTime(local);
                task.AutoCompletedAt = at;
                task.UpdatedAt = at;
                run.StampAudit(task.Id, at, witness);
            }
            run.Changed("witness requests answered");
        }
        await run.SaveAsync(ct);
    }

    private static DateTime AnswerTime(DemoAnchors anchors, Odip.Domain.Entities.MedicationAdministration dose)
    {
        var requestedLocal = ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(dose.WitnessRequestedAt!.Value), anchors.Zone);
        return anchors.LocalToUtc(PackageRows.Local(DateOnly.FromDateTime(requestedLocal).AddDays(1), At));
    }
}
