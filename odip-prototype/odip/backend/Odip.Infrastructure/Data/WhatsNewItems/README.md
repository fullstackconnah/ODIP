# What's New items

- To add an item, add one file here, named after a new dated key (for example `2026-11-my-change.cs`).
- Copy any shipped file: one `private static readonly Entry K_<key with underscores>` holding `new Item(key, title, body, roles, important)`. Leave out the Order number.
- Never edit or remove a shipped key: the seeder only inserts keys the table lacks.
- No `Important` unless everyone must notice.
- The 44 shipped items keep their numbered Order; new items follow them, sorted by key.
