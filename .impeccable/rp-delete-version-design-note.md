# Restrictive practices delete: version guard (design note)

What: a delete from a stale view is refused (409). Where: RestrictivePracticesTab confirmDelete. House component: the existing list error (`listError`), no new component.

States:
- Confirm dialog (unchanged copy). On confirm, the version the user saw (`updatedAt`) is sent.
- 409: the dialog closes (as it already does on any delete error), the list error shows "Someone else just changed this entry, so it wasn't deleted. Check their change, then delete it again if you still want to.", and the list is refetched so their change is visible. The entry stays.
- Other errors, success, loading, empty, focus: unchanged.

apple-design applied: forgiveness and agency (a destructive action never lands on data the user has not seen); feedback is specific and says what to do next; no new motion or chrome (restraint).
