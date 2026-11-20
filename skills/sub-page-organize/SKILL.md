---
name: sub-page-organize
description: Organize notes in an Obsidian vault that uses Sub Page. Use when creating child pages, moving existing notes between parent pages, or restructuring the page tree.
---

# Organize notes with Sub Page

1. Start at the vault root and read its instructions. Check `.obsidian/plugins/sub-page/data.json` for `pageRoot` and excluded folders. If the vault uses a custom Obsidian configuration folder, use that folder instead. An empty page root means the entire vault.
2. Inspect the target paths and existing links. A standalone note is `Topic.md`. A parent page is `Topic/Topic.md`; its child notes sit beside it, for example `Topic/Child.md`. A folder without a matching note groups its contents. Create a matching folder only when a note needs children. Check the contents before pairing an existing same-named folder.
3. Use Obsidian's move or rename commands when available. For direct filesystem moves, preserve the note and its properties, then check and update affected wiki links, Markdown links, and embeds. Check links into every moved note when relocating a folder. Keep changes within the paths requested by the user.
4. Add a `subpages` code block when a parent note should display its children in the body. The file layout determines the hierarchy. Use the sidebar for manual ordering when requested.
5. Verify the resulting paths, the parent note and its immediate children, and any links affected by the move. If the Obsidian workspace is available, check that the tree reflects the new hierarchy.

If **Restore pages that have no children** is enabled, Sub Page can move the parent note up one level when it is the only remaining item in its folder. Check this setting before relying on an empty parent folder.

<!-- managed-by: sub-page-organize -->
