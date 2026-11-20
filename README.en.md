# Sub Page

Notion-style nested pages for Obsidian. Turn the notes scattered across folders into an expandable, draggable page hierarchy.

**No migration required.** Every note under the page root is a page; if a note happens to have a folder of the same name, it becomes a parent page and the notes inside that folder become its children. Open an existing vault and the tree is simply there.

## What it solves

With plain folders, "where is the entry point for this folder" needs a Folder Note plugin, and every new level needs another hand-maintained index note. Sub Page treats the folder itself as the page:

- Put `JVM.md` inside `Java/JVM/` and `JVM.md` becomes the page for that level; other notes in the folder are its children.
- Folders without a same-name note still show up as group folders — an imperfect vault still works. Right-click → pair to fill in the gap.
- The sidebar and the in-note ```subpages block share one index, so they can never disagree.

## Usage

1. Point "Page root" in settings at the folder holding your pages (defaults to the whole vault).
2. Click the **Sub Page** icon in the left ribbon, or run **Sub Page: Open sub page panel**. On first open, the tree appears in the left sidebar alongside Obsidian's file explorer.
3. Insert this anywhere in a note:

   ````markdown
   ```subpages
   view: list
   sort: manual
   ```
   ````

   The block lists the current note's children. It locates the page **purely by the note's own path**, so previews, multiple tabs and exports never point at the wrong page.

**Restore pages that have no children** is on by default. When the index refreshes, a paired folder containing only its original note is restored to a standalone note. Turn this setting off to keep paired folders.

### Block options

| Key | Values | Default |
| --- | --- | --- |
| `view` | `list` / `card` | setting default |
| `sort` | `name` / `created` / `modified` / `manual` | setting default |
| `show-icon` | `true` / `false` | `true` |
| `show-description` | `true` / `false` | `false` |
| `columns` | positive integer | `2` |
| `limit` | positive integer, `0` = no limit | `0` |

### Page metadata

Icons and descriptions live in the note's frontmatter:

```yaml
---
icon: "📁"        # emoji renders as text; lucide:folder uses the icon font
description: All JVM notes in one place
---
```

## Coexistence with the native file explorer

Sub Page neither takes over nor hides the native file explorer. The same folders appear twice, on purpose: the native tree is still better for renaming folders and dragging attachments. There is a command, **Collapse native file explorer**, when you want a single view.

## Ordering

Manual order is stored in `order.json` in the plugin folder (normally `.obsidian/plugins/sub-page/order.json`). The `roots` object holds a separate entry for each page root. Its empty key represents the entire vault.

```json
{
  "roots": {
    "": {
      "": ["Home", "Conventions", "Java"],
      "Java": ["jvm", "concurrency"]
    }
  }
}
```

Each entry maps parent page IDs to child names. The inner empty key represents top-level pages. Unlisted children use natural name order. The first time a page root is opened after upgrading, the plugin imports its legacy `.subpage-order.json` and keeps the original as a backup. Include `order.json` when syncing the plugin configuration across devices.

## Installation

Not yet in the community directory. Manual install: copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/sub-page/`, restart Obsidian and enable the plugin.

## Requirements

- Desktop and mobile both supported (`isDesktopOnly: false`); drag-and-drop is desktop only (mobile uses move up / move down in the menu).
- Obsidian 1.15.0 or newer.

## Development

See `CONTRIBUTING.md`. Terminology follows `GLOSSARY.md`; architecture decisions live in `docs/adr/`.

## License

MIT
