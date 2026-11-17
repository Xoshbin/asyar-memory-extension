# Memory

> Persistent cross-session memory for every Asyar AI agent.

`org.asyar.memory` is a Tier 2 Asyar extension that gives the launcher's
AI agents a durable, user-auditable memory. Anything the agent saves
here survives launcher restarts and is shared across every conversation
on the same machine. Uninstall the extension and the data is gone —
the memory store lives only inside this extension's sandbox.

## What it does

The extension exposes **7 tools** to AI agents:

| Tool            | What the agent uses it for                                   |
| --------------- | ------------------------------------------------------------ |
| `memory_save`   | Save a fact about the user — proactive, no need to be asked  |
| `memory_list`   | Pull everything saved (call at the start of a personal chat) |
| `memory_search` | Substring search over notes and tags                         |
| `memory_update` | Correct an existing memory by id                             |
| `memory_delete` | Forget a specific memory                                     |
| `memory_pin`    | Pin (or unpin) a memory — pinned never auto-evict            |
| `memory_clear`  | Wipe everything (asks the user for confirmation first)       |

Each tool description is written in directive language so the LLM
knows **when** to call it without needing custom system-prompt
instructions. For example, `memory_list` tells the model: _"call this
at the start of any conversation that could benefit from knowing the
user."_

## What you see

Opening the **Memory** command surfaces a clipboard-history-style two
pane view:

```
┌──────────────────────┬───────────────────────────────────────┐
│ Pinned               │  2h ago · 16 November 2026 at 09:41    │
│  📌 Likes oat milk   │                                        │
│  #preferences   2h   │  Likes **oat milk** in coffee          │
│                      │                                        │
│ Today                │  #preferences  #food                  │
│  Brother's birthday  │  ──────────────────────────────────────│
│  #family        5h   │  ⏎ Copy   ⌘E Edit   ⌘⇧P Pin   ⌃X Delete│
└──────────────────────┴───────────────────────────────────────┘
```

Entries are grouped into date buckets (Pinned / Today / Yesterday /
This week / Earlier) and sorted newest-first within each bucket. The
launcher's main search bar filters the list live (no in-view search
field), and clicking a tag pill in the detail pane filters to it.

Notes render as markdown — headings, lists, quotes, fenced code, links
and inline `#tags` — in the detail pane. A note with no markdown reads
as plain prose.

## Actions (⌘K)

While the view is open, ⌘K surfaces these view-scoped commands, and
their declared shortcuts work without opening the panel:

| Action                  | Shortcut | What it does                                      |
| ----------------------- | -------- | ------------------------------------------------- |
| **Add memory**          | `⌘N`     | Inline form: Memory textarea + Tags input         |
| **Edit memory**         | `⌘E`     | Same form, pre-filled with the selected entry     |
| **Pin or unpin memory** | `⌘⇧P`    | Toggle pin (pinned entries never auto-evict)      |
| **Copy memory**         | `⏎`      | Copy the selected note, then dismiss the launcher |
| **Copy as markdown**    | `⌘⇧C`    | Copy the note plus its `#tags`                    |
| **Delete memory**       | `⌃X`     | Confirm, then remove the selected entry           |
| **Export as markdown**  | —        | Download every memory as one `.md` file           |
| **Clear all memories**  | `⌃⇧X`    | Confirm, then wipe everything including pinned    |

Shortcuts are declared in Asyar's canonical `Mod+N` form, so Windows
and Linux render and bind `Ctrl` instead of `⌘`. `⌘C`, `⌘P`, `⌘⌫` and
`⌘⇧⌫` are reserved by the launcher for text editing, the search-bar
accessory and list navigation, so copy-in-view, pin and delete use the
approved alternatives above.

Form shortcuts: `⌘⏎` to save, `Esc` to cancel.

## Permissions

```json
"permissions": ["tools:register"]
```

That's the only one. Per-extension state is automatically scoped by the
launcher's IPC router — no `state:*` permission needed. There is no
network access, no clipboard write, no shell, no filesystem access.
The export download uses a sandboxed `Blob`/anchor click that stays
inside the iframe.

## Storage

Single state key `memory.entries` (SQLite, scoped per-extension):

```ts
interface MemoryEntry {
  id: string; // crypto.randomUUID()
  note: string; // raw text
  at: number; // ms epoch — creation time
  tags: string[]; // trim + lowercase, ≤5 items, ≤32 chars each
  pinned: boolean;
  source?: string; // reserved
}
```

Cap is **1000 unpinned entries** with LRU eviction (oldest `at` wins).
Pinned entries are never auto-evicted regardless of count.

## Install

From the Asyar Store, or via the Asyar CLI:

```bash
asyar install org.asyar.memory
```

Then open the **Agent editor** in the launcher and enable the
`memory_*` tools for any agent that should be able to use them.

## Develop

```bash
# from this directory
pnpm install
pnpm dev          # vite dev server
pnpm test:run     # vitest — 48 tests covering pure libs + tool handlers
pnpm build        # emits dist/{worker,view}.js + assets
pnpm link         # registers the dev path with the launcher
asyar publish     # builds, packages, GitHub release, store submission
```

The worker (`src/worker.ts`) is thin glue: it registers the 7 tools
on activate and routes view→worker RPCs (`memory.save`, `memory.update`,
`memory.delete`, `memory.pin`, `memory.clear`). All logic lives in
`src/lib/tools/*` as pure `(entries, args) → { next, result }`
functions, plus `src/lib/wrap.ts` which reads / writes the single
state key around each pure call. This means every behavior is unit-
testable without mocking the SDK.

## License

[MIT](./LICENSE) © Khoshbin
