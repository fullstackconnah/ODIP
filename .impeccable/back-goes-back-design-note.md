# Back goes back: design note (written before the first edit)

Owner: "The back buttons on all pages in the platform should go back to the previous page that I visited."

## What Back does
| Case | Behaviour |
|---|---|
| In-app history (idx > 0) | plain left-click runs `navigate(-1)`; the control stays a real link whose href is the fallback |
| Deep link / new tab (idx 0) | `navigate(fallback)` as a push |
| Reload mid-session | idx survives in history.state, so history Back still works; the name falls back to the page's own label (the path map is module state and is gone) |
| After a save | the finished form is replaced (`replace: true`), so Back never reopens it; Medication/Profile leave via `back.leave()` |
| Dirty form | `navigate(-1)` is a router navigation, so `useBlocker` still shows the dialog |
| Ctrl/Cmd/Shift/Alt/middle click, copy link | not intercepted; the browser uses the href (the fallback) |

## Accessible name
Previous screen known (map at idx-1): "Back to <screen>" (existing buildAriaLabel). Unknown: "Back to <label>". Visible text stays "Back" / arrow icon. Names never lie: the name describes where the click goes.

## The one new visible control
Claim detail gets the house `BackButton` icon variant (ghost, 44px on touch via --tap-min) in the same header slot as TripDetailPage. Fallback /trips, label "trips". Breadcrumb stays. States: default, hover, focus-visible ring (house Button), touch 44px. No new motion (apple-design: familiarity, consistency; response is instant because navigation starts on click).

## Controls that follow Back
Cancel buttons go where the header Back goes (WizardNavFooter already does; six fixed Cancels move to useBackTarget). "Back to staff", "Back to enquiries", "Back to import data" become history-aware with today's target as fallback.

## Controls that stay fixed, and why
Caregiver public wizard (outside the app shell, tracker not mounted); portal "Back to my shifts" (end-of-task destinations); TenantDetailView onBack (component state); wizard/modal/form-step Backs and week chevrons (not page history); tab/filter replace writers and participantTabs push.

## apple-design rules applied
Familiarity/consistency (same control, same slot, same behaviour everywhere); agency (modifier-click and copy-link keep working); forgiveness (blocker on dirty forms); spatial consistency (Back returns along the path you came in on); no new animation.
