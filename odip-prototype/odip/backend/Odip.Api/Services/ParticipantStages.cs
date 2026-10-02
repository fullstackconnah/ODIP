using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Services;

/// <summary>
/// Where a participant is in the lifecycle the Participants hub shows, read from the participant's own flags and nothing else: never from
/// whether an enquiry or an <see cref="ParticipantOnboarding"/> row happens to exist (that is how the Onboarding tab used to miss people).
/// <list type="bullet">
/// <item><b>Intake in progress</b>: a draft whose intake is open. The Enquiries tab shows it, with its enquiry when there is one.</item>
/// <item><b>In onboarding</b>: a draft whose intake is complete. The Onboarding tab. Completing the profile
/// (<c>POST /participants/{id}/complete-profile</c>) finalises them, and the organisation's readiness mode decides whether that is allowed.</item>
/// <item><b>Active / archived</b>: finalised participants, by <c>IsActive</c>. The Active participants tab and its Archived view.</item>
/// </list>
/// A draft's stage follows its intake alone: <c>IsActive</c> is not read for a draft. The status endpoint never activates a draft and Create and
/// Convert force <c>IsActive = false</c>, but <c>Participant.IsActive</c> defaults to true and older drafts (the seeded demo draft is one) kept it, so
/// asking "not active" as well left such a draft on no tab once its intake was complete.
/// The predicates are query-shaped (they compose into the list SQL), so <c>ParticipantStagesSqlTests</c> checks their Npgsql translation:
/// EF InMemory would stay green even if one stopped translating.
/// </summary>
public static class ParticipantStages
{
    private static readonly Expression<Func<Participant, bool>> InOnboardingPredicate =
        p => p.IsDraft && p.IntakeCompletedAt != null;
    private static readonly Func<Participant, bool> InOnboardingCheck = InOnboardingPredicate.Compile();

    /// <summary>Participants in onboarding: still a draft, intake complete.</summary>
    public static IQueryable<Participant> InOnboarding(IQueryable<Participant> participants) => participants.Where(InOnboardingPredicate);

    /// <summary>The same rule for one participant already in memory (it must stay the same rule: both read <see cref="InOnboardingPredicate"/>).</summary>
    public static bool IsInOnboarding(Participant participant) => InOnboardingCheck(participant);

    /// <summary>
    /// Drafts whose intake is still open and that no enquiry links: an intake started in the Intake wizard (<c>/participants/new</c>) with no
    /// enquiry behind it. A draft an enquiry links is that enquiry's row on the Enquiries tab, never a second one.
    /// </summary>
    public static IQueryable<Participant> DirectIntakes(OdipDbContext db, IQueryable<Participant> participants) =>
        participants.Where(p => p.IsDraft && p.IntakeCompletedAt == null && !db.ParticipantInquiries.Any(i => i.ParticipantId == p.Id));
}
