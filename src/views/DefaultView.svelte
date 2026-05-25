<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    ExtensionContext,
    ExtensionStateProxy,
    IFeedbackService,
    IActionService,
    ExtensionAction,
  } from 'asyar-sdk/view';
  import { ActionContext } from 'asyar-sdk/view';

  const EXTENSION_ID = 'org.asyar.memory';
  import { STATE_KEYS, type MemoryEntry } from '../stateKeys';
  import { toMarkdown } from '../lib/markdown';
  import { normalizeTags } from '../lib/normalize';

  interface Props { context: ExtensionContext; }
  let { context }: Props = $props();

  const stateProxy = $derived(context.getService<ExtensionStateProxy>('state'));
  const feedback = $derived(context.getService<IFeedbackService>('feedback'));

  let entries = $state<MemoryEntry[]>([]);
  let searchText = $state('');
  let selectedIndex = $state(0);
  let lastForgetAt = $state(0);
  let listContainer: HTMLDivElement | undefined = $state();

  // ── Form mode (snippets-style: 'view' | 'create' | 'edit') ───────
  // When mode !== 'view' the right pane shows an inline form instead
  // of the detail display. Add/Edit actions enter this mode.
  let mode = $state<'view' | 'create' | 'edit'>('view');
  let formNote = $state('');
  let formTagsInput = $state('');
  let formError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let formNoteEl: HTMLTextAreaElement | undefined = $state();

  // Pipeline: entries → (search filter) → grouped (date buckets, sorted
  // within bucket by `at` desc) → displayed (flat in render order).
  // `selected` MUST come from `displayed` so it matches the rendered
  // row at `selectedIndex` — using `filtered` here would resolve to a
  // different entry once date-bucket sorting reorders things.
  const searchFiltered = $derived(filterEntries(entries, searchText));
  const grouped = $derived(groupByBucket(searchFiltered));
  const displayed = $derived(grouped.flatMap((g) => g.entries));
  const selected = $derived(displayed[selectedIndex] ?? null);

  function filterEntries(rows: MemoryEntry[], text: string): MemoryEntry[] {
    if (!text.trim()) return rows;
    const needle = text.trim().toLowerCase();
    return rows.filter(
      (e) =>
        e.note.toLowerCase().includes(needle) ||
        e.tags.some((t) => t.includes(needle)),
    );
  }

  // ── Date bucketing for section headers (clipboard-history style) ──
  type Bucket = 'Pinned' | 'Today' | 'Yesterday' | 'This week' | 'This month' | 'Earlier';
  const BUCKET_ORDER: Bucket[] = ['Pinned', 'Today', 'Yesterday', 'This week', 'This month', 'Earlier'];

  function bucketFor(entry: MemoryEntry): Bucket {
    if (entry.pinned) return 'Pinned';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(entry.at);
    day.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'This week';
    const now = new Date();
    if (
      day.getMonth() === now.getMonth() &&
      day.getFullYear() === now.getFullYear()
    ) return 'This month';
    return 'Earlier';
  }

  interface Group { name: Bucket; entries: MemoryEntry[]; }

  function groupByBucket(rows: MemoryEntry[]): Group[] {
    const map = new Map<Bucket, MemoryEntry[]>();
    for (const r of rows) {
      const b = bucketFor(r);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(r);
    }
    // Sort each bucket newest-first.
    for (const arr of map.values()) {
      arr.sort((a, b) => b.at - a.at);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({
      name: b,
      entries: map.get(b)!,
    }));
  }

  function flatIndex(groupIdx: number, itemIdx: number): number {
    let idx = 0;
    for (let g = 0; g < groupIdx; g++) idx += grouped[g].entries.length;
    return idx + itemIdx;
  }

  // ── #tag parsing for Add Memory ──────────────────────────────────
  function parseNoteAndTags(input: string): { note: string; tags: string[] } {
    const tagPattern = /(?:^|\s)#([\w-]+)/g;
    const matches = Array.from(input.matchAll(tagPattern), (m) => m[1]);
    const note = input.replace(/(?:^|\s)#[\w-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { note, tags: normalizeTags(matches) };
  }

  // ── Postmessage listener (launcher → view) ───────────────────────
  function ensureVisible() {
    requestAnimationFrame(() => {
      const el = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }

  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Form is open: the user is editing text in our textarea/inputs,
    // so ignore launcher search / list-nav keystrokes entirely.
    if (mode !== 'view') return;

    if (data.type === 'asyar:view:search') {
      searchText = data.payload?.query ?? '';
      selectedIndex = 0;
    }

    if (data.type === 'asyar:view:keydown') {
      const key = data.payload?.key;
      if (key === 'ArrowDown') {
        selectedIndex = Math.min(displayed.length - 1, selectedIndex + 1);
        ensureVisible();
      } else if (key === 'ArrowUp') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        ensureVisible();
      } else if (key === 'Enter') {
        void copyMemory();
      }
    }
  }

  function fmtDate(at: number): string {
    return new Date(at).toLocaleString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function firstLine(text: string): string {
    const trimmed = text.trim();
    const nl = trimmed.indexOf('\n');
    return (nl === -1 ? trimmed : trimmed.slice(0, nl)).slice(0, 120);
  }

  function entryDesc(entry: MemoryEntry): string {
    if (entry.tags.length > 0) return entry.tags.map((t) => `#${t}`).join('  ');
    // No tags → show the second line if multi-line, otherwise empty.
    const trimmed = entry.note.trim();
    const nl = trimmed.indexOf('\n');
    if (nl === -1) return '';
    return trimmed.slice(nl + 1).slice(0, 120).trim();
  }

  // ── Form helpers (snippets pattern) ───────────────────────────────
  function startCreate() {
    mode = 'create';
    formNote = '';
    formTagsInput = '';
    formError = null;
    editingId = null;
    queueMicrotask(() => formNoteEl?.focus());
  }

  function startEdit(entry: MemoryEntry) {
    mode = 'edit';
    formNote = entry.note;
    formTagsInput = entry.tags.join(' ');
    formError = null;
    editingId = entry.id;
    queueMicrotask(() => formNoteEl?.focus());
  }

  function cancelForm() {
    mode = 'view';
    formNote = '';
    formTagsInput = '';
    formError = null;
    editingId = null;
  }

  function parseFormTags(input: string): string[] {
    const raw = input
      .split(/[,\s]+/)
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);
    return normalizeTags(raw);
  }

  async function saveForm() {
    const note = formNote.trim();
    if (!note) {
      formError = 'Memory text is required.';
      return;
    }
    const tags = parseFormTags(formTagsInput);

    if (mode === 'create') {
      const res = (await context.request('memory.save', { note, tags })) as
        | { saved: true; id: string; total: number }
        | { saved: false; error: string };
      if (!res.saved) {
        formError = res.error;
        return;
      }
      cancelForm();
      await feedback.showHUD(
        tags.length
          ? `✅ Saved with ${tags.length} tag${tags.length > 1 ? 's' : ''} (total: ${res.total})`
          : `✅ Saved (total: ${res.total})`,
      );
    } else if (mode === 'edit' && editingId) {
      const res = (await context.request('memory.update', {
        id: editingId,
        note,
        tags,
      })) as { updated: true; id: string } | { updated: false; error: string };
      if (!res.updated) {
        formError = res.error;
        return;
      }
      cancelForm();
      await feedback.showHUD(`✅ Updated: ${note.slice(0, 40)}`);
    }
  }

  function onFormKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelForm();
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      void saveForm();
    }
  }

  // ── Action implementations ────────────────────────────────────────
  async function addMemory() {
    startCreate();
  }

  async function editMemory() {
    if (!selected) {
      await feedback.showHUD('Select a memory first (↑↓ in the list)');
      return;
    }
    startEdit(selected);
  }

  async function deleteMemory() {
    if (!selected) {
      await feedback.showHUD('Select a memory first (↑↓ in the list)');
      return;
    }
    const preview = selected.note.slice(0, 40);
    await context.request('memory.delete', { id: selected.id });
    if (selectedIndex >= displayed.length - 1) {
      selectedIndex = Math.max(0, displayed.length - 2);
    }
    await feedback.showHUD(`Deleted: ${preview}`);
  }

  async function togglePinMemory() {
    if (!selected) {
      await feedback.showHUD('Select a memory first (↑↓ in the list)');
      return;
    }
    const nextPinned = !selected.pinned;
    const preview = selected.note.slice(0, 40);
    await context.request('memory.pin', { id: selected.id, pinned: nextPinned });
    await feedback.showHUD(nextPinned ? `📌 Pinned: ${preview}` : `Unpinned: ${preview}`);
  }

  async function copyMemory() {
    if (!selected) {
      await feedback.showHUD('Select a memory first (↑↓ in the list)');
      return;
    }
    const text = selected.note;
    // Try the modern API first; fall back to execCommand for sandboxed
    // iframe contexts where Permissions API denies clipboard.
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch { /* try fallback */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch { /* give up */ }
    }
    await feedback.showHUD(ok ? `Copied: ${text.slice(0, 40)}` : 'Copy failed');
  }

  async function exportMarkdown() {
    const md = toMarkdown(entries, new Date());
    const today = new Date().toISOString().slice(0, 10);
    const filename = `asyar-memory-${today}.md`;
    // Try blob anchor download; fall back to clipboard if the sandbox
    // blocks programmatic downloads.
    let downloaded = false;
    try {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      downloaded = true;
    } catch { /* try clipboard fallback */ }
    if (downloaded) {
      await feedback.showHUD(`Exported ${entries.length} memories → ${filename}`);
    } else {
      try { await navigator.clipboard.writeText(md); } catch { /* */ }
      await feedback.showHUD(`Download blocked — markdown copied to clipboard (${entries.length} entries)`);
    }
  }

  async function forgetAll() {
    const count = entries.length;
    if (count === 0) {
      await feedback.showHUD('Nothing to forget.');
      return;
    }
    const now = Date.now();
    if (now - lastForgetAt > 5000) {
      lastForgetAt = now;
      await feedback.showHUD(
        `Forget all ${count} memories? ⌘K → Forget All again within 5s to confirm.`,
      );
      return;
    }
    await context.request('memory.clear', {});
    lastForgetAt = 0;
    await feedback.showHUD(`Forgotten ${count} memories.`);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────
  onMount(() => {
    let active = true;
    const cleanup: Array<() => void | Promise<void>> = [];

    window.addEventListener('message', handleMessage);
    cleanup.push(() => window.removeEventListener('message', handleMessage));

    (async () => {
      const [initial, unsubscribe] = await Promise.all([
        stateProxy.get(STATE_KEYS.entries),
        stateProxy.subscribe(STATE_KEYS.entries, (v) => {
          if (!active) return;
          entries = Array.isArray(v) ? (v as MemoryEntry[]) : [];
          if (selectedIndex >= displayed.length) {
            selectedIndex = Math.max(0, displayed.length - 1);
          }
        }),
      ]);
      if (!active) { void unsubscribe(); return; }
      entries = Array.isArray(initial) ? (initial as MemoryEntry[]) : [];
      cleanup.push(unsubscribe);
    })();

    // View-scoped actions (visible in ⌘K while this view is mounted).
    // Per launcher behavior: manifest `command.actions[]` are CORE-context
    // (only shown when the command is highlighted in ROOT search). Actions
    // that should appear while the view is open MUST be registered at
    // runtime with ActionContext.EXTENSION_VIEW and an inline `execute`.
    const actions = context.getService<IActionService>('actions');
    const viewActions: ExtensionAction[] = [
      {
        id: `${EXTENSION_ID}:add-memory`,
        title: 'Add Memory',
        description: 'Save what is in the launcher search bar as a new memory. Use #tag inside the text to attach tags.',
        icon: '➕',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: addMemory,
      },
      {
        id: `${EXTENSION_ID}:edit-memory`,
        title: 'Edit Memory',
        description: 'Replace the selected memory text with whatever is in the launcher search bar.',
        icon: '✏️',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: editMemory,
      },
      {
        id: `${EXTENSION_ID}:delete-memory`,
        title: 'Delete Memory',
        description: 'Delete the currently selected memory.',
        icon: '🗑️',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: deleteMemory,
      },
      {
        id: `${EXTENSION_ID}:pin-memory`,
        title: 'Pin or Unpin Memory',
        description: 'Toggle pin on the selected memory. Pinned entries never auto-evict.',
        icon: '📌',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: togglePinMemory,
      },
      {
        id: `${EXTENSION_ID}:copy-memory`,
        title: 'Copy Memory',
        description: 'Copy the selected memory text to the clipboard.',
        icon: '📋',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: copyMemory,
      },
      {
        id: `${EXTENSION_ID}:export-md`,
        title: 'Export as Markdown',
        description: 'Download every memory as a single markdown file.',
        icon: '📥',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: exportMarkdown,
      },
      {
        id: `${EXTENSION_ID}:forget-all`,
        title: 'Forget All Memories',
        description: 'Wipe every memory including pinned. Press twice within 5s to confirm.',
        icon: '💥',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: forgetAll,
      },
    ];

    for (const action of viewActions) {
      actions.registerAction(action);
    }
    cleanup.push(() => {
      for (const action of viewActions) {
        actions.unregisterAction(action.id);
      }
    });

    return () => {
      active = false;
      for (const fn of cleanup) {
        try { void fn(); } catch { /* */ }
      }
    };
  });
</script>

<div class="container">
  <div class="split-view">
    <!-- Left: Memory list -->
    <div
      class="doc-list"
      bind:this={listContainer}
      tabindex="0"
      role="listbox"
      aria-label="Memories"
    >
      {#if displayed.length === 0}
        <div class="empty-state">
          {#if entries.length === 0}
            <span class="empty-icon">🧠</span>
            <span>No memories yet.</span>
            <span class="empty-hint">
              Ask your AI to remember something, or type a memory above and press
              <kbd>⌘K</kbd> → <em>Add Memory</em>.
            </span>
          {:else}
            <span class="empty-icon">🔍</span>
            <span>No results for "{searchText}"</span>
          {/if}
        </div>
      {:else}
        {#each grouped as group, groupIdx (group.name)}
          <div class="section-header">{group.name}</div>
          {#each group.entries as entry, itemIdx (entry.id)}
            {@const idx = flatIndex(groupIdx, itemIdx)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <div
              data-index={idx}
              class="doc-item"
              class:selected={selectedIndex === idx}
              role="option"
              aria-selected={selectedIndex === idx}
              onclick={() => {
                if (mode !== 'view') cancelForm();
                selectedIndex = idx;
              }}
            >
              <div class="doc-title">{firstLine(entry.note)}</div>
              <div class="doc-desc">{entryDesc(entry) || ' '}</div>
            </div>
          {/each}
        {/each}
      {/if}
    </div>

    <!-- Right: Detail panel OR inline form (snippets-pattern) -->
    <div class="detail-panel">
      {#if mode === 'create' || mode === 'edit'}
        <!-- Inline form (mirrors built-in snippets) -->
        <div class="form-panel" onkeydown={onFormKeyDown} role="form">
          <div class="form-header">
            <h2 class="form-title">{mode === 'edit' ? 'Edit Memory' : 'New Memory'}</h2>
            {#if mode === 'edit' && editingId}
              {@const editingEntry = entries.find((e) => e.id === editingId)}
              {#if editingEntry}
                <div class="form-subtitle">
                  Editing memory saved {fmtDate(editingEntry.at)}
                  · <code class="form-subtitle-id">{editingId.slice(0, 8)}…</code>
                </div>
              {/if}
            {/if}
          </div>
          <div class="form-body">
            <div class="form-field">
              <label class="form-label" for="memory-note">Memory</label>
              <textarea
                id="memory-note"
                class="field-textarea"
                bind:value={formNote}
                bind:this={formNoteEl}
                placeholder="e.g. Prefers dark roast coffee in the morning"
                rows="5"
              ></textarea>
            </div>
            <div class="form-field">
              <label class="form-label" for="memory-tags">Tags <span class="form-hint">(space-separated, optional)</span></label>
              <input
                id="memory-tags"
                class="field-input"
                type="text"
                bind:value={formTagsInput}
                placeholder="e.g. preferences food"
              />
              <p class="form-help">Trim + lowercase, max 5 tags, max 32 chars each. # is optional.</p>
            </div>
            {#if formError}
              <div class="form-error">{formError}</div>
            {/if}
          </div>
          <div class="form-footer">
            <span class="form-shortcut-hint">⌘↵ to save · Esc to cancel</span>
            <div class="form-buttons">
              <button class="btn-secondary" type="button" onclick={cancelForm}>Cancel</button>
              <button class="btn-primary" type="button" onclick={saveForm}>{mode === 'edit' ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      {:else if !selected}
        <div class="detail-empty">
          <span class="detail-empty-icon">🧠</span>
          <span>Select a memory to see details</span>
        </div>
      {:else}
        <div class="doc-header">
          <h2>{firstLine(selected.note)}</h2>
          <div class="meta">
            <span class="doc-path">{fmtDate(selected.at)}</span>
            {#if selected.pinned}
              <span class="pin-badge">📌 Pinned</span>
            {/if}
          </div>
        </div>
        <div class="detail-content">
          {#if selected.note.includes('\n') || selected.note.length > 120}
            <p class="full-note">{selected.note}</p>
          {/if}
          {#if selected.tags.length > 0}
            <div class="detail-section">
              <div class="detail-section-label">Tags</div>
              <div class="detail-tags">
                {#each selected.tags as t}
                  <span class="detail-tag">#{t}</span>
                {/each}
              </div>
            </div>
          {/if}
          <div class="detail-section">
            <div class="detail-section-label">ID</div>
            <code class="detail-id">{selected.id}</code>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* ── Force the iframe document to fill its parent so the split
        panes can use 100% height. The launcher mounts the view in
        an iframe sized by the chrome, but #app / body / html default
        to auto-height which collapses everything below content. */
  :global(html, body) {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  :global(#app) {
    height: 100%;
    width: 100%;
  }

  /* ── Container (matches Tauri Docs verbatim) ───────────────────── */
  .container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    font-family: var(--font-ui);
    color: var(--text-primary);
    background: var(--bg-primary);
  }

  .split-view {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Left list (copied verbatim from Tauri Docs) ───────────────── */
  .doc-list {
    width: 280px;
    min-width: 220px;
    overflow-y: auto;
    border-right: 1px solid var(--border-color);
    padding: 4px 0;
    background: var(--bg-primary);
    outline: none;
  }

  .section-header {
    padding: var(--space-4) var(--space-5) var(--space-2);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }

  .doc-item {
    padding: var(--space-3) var(--space-5);
    margin: 1px 6px;
    border-radius: var(--radius-sm);
    cursor: default;
    transition: background var(--transition-fast);
  }

  .doc-item:hover {
    background: var(--hover-bg, #f5f5f5);
  }

  .doc-item.selected {
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  .doc-title {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .doc-desc {
    font-size: var(--font-size-xs);
    line-height: 1.3;
    margin-top: 2px;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .doc-item.selected .doc-desc {
    opacity: 0.85;
  }

  /* ── Right detail panel (copied verbatim from Tauri Docs) ──────── */
  .detail-panel {
    flex: 1;
    overflow-y: auto;
    background: var(--bg-secondary, #fafafa);
    display: flex;
    flex-direction: column;
  }

  .doc-header {
    background: var(--bg-primary);
    padding: 24px 32px 16px;
    border-bottom: 1px solid var(--border, #e5e5e5);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .doc-header h2 {
    margin: 0 0 8px 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
  }

  .doc-header .meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .doc-path {
    font-size: 13px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    background: var(--bg-tertiary, #f0f0f0);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .pin-badge {
    font-size: 12px;
    color: var(--text-secondary);
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--warning-bg, rgba(255, 200, 0, 0.12));
  }

  .detail-content {
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .full-note {
    margin: 0;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .detail-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-section-label {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }

  .detail-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .detail-tag {
    font-size: 13px;
    color: var(--accent-primary, #007aff);
    background: var(--bg-tertiary, #f0f0f0);
    padding: 3px 9px;
    border-radius: 4px;
  }

  .detail-id {
    font-size: 12px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    background: var(--bg-tertiary, #f0f0f0);
    padding: 4px 8px;
    border-radius: 4px;
    word-break: break-all;
    align-self: flex-start;
  }

  /* ── Empty states (copied verbatim from Tauri Docs) ────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    color: var(--text-tertiary);
    font-size: 13px;
    padding: 40px 20px;
    text-align: center;
  }

  .empty-icon {
    font-size: 28px;
    opacity: 0.5;
  }

  .empty-hint {
    font-size: 12px;
    line-height: 1.5;
  }

  .empty-hint kbd {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 11px;
    background: var(--bg-secondary, rgba(255,255,255,0.06));
    border: 1px solid var(--border-color);
    border-radius: 3px;
    padding: 1px 5px;
  }

  .detail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 12px;
    color: var(--text-tertiary, #aaa);
    font-size: var(--font-size-base);
  }

  .detail-empty-icon {
    font-size: 36px;
    opacity: 0.4;
  }

  /* ── Inline form (snippets-pattern) ────────────────────────────── */
  .form-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-primary);
  }
  .form-header {
    padding: 24px 32px 0;
    flex-shrink: 0;
  }
  .form-title {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .form-subtitle {
    margin: 0 0 18px;
    font-size: 12px;
    color: var(--text-tertiary, var(--text-secondary));
  }
  .form-subtitle-id {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 11px;
    background: var(--bg-tertiary, rgba(255,255,255,0.05));
    padding: 1px 5px;
    border-radius: 3px;
  }
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .form-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .form-hint {
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-tertiary, var(--text-secondary));
    margin-left: 4px;
  }
  .form-help {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
    line-height: 1.4;
  }
  .field-input,
  .field-textarea {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-secondary, rgba(255,255,255,0.04));
    border: 1px solid var(--border-color, var(--separator));
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    box-sizing: border-box;
    line-height: 1.5;
  }
  .field-textarea {
    resize: vertical;
    min-height: 100px;
  }
  .field-input:focus,
  .field-textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary);
  }
  .form-error {
    padding: 8px 12px;
    background: var(--error-bg, rgba(255, 80, 80, 0.1));
    border: 1px solid var(--error-border, rgba(255, 80, 80, 0.3));
    border-radius: 6px;
    color: var(--error-text, #ff8080);
    font-size: 12px;
  }
  .form-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 32px;
    border-top: 1px solid var(--border-color, var(--separator));
    flex-shrink: 0;
  }
  .form-shortcut-hint {
    font-size: 11px;
    color: var(--text-tertiary, var(--text-secondary));
  }
  .form-buttons {
    display: flex;
    gap: 8px;
  }
  .btn-primary,
  .btn-secondary {
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
  }
  .btn-primary {
    background: var(--accent-primary, #007aff);
    color: white;
  }
  .btn-primary:hover { filter: brightness(1.05); }
  .btn-secondary {
    background: transparent;
    color: var(--text-primary);
    border-color: var(--border-color, var(--separator));
  }
  .btn-secondary:hover {
    background: var(--bg-secondary, rgba(255,255,255,0.05));
  }

  /* ── Scrollbars (copied verbatim from Tauri Docs) ──────────────── */
  .doc-list::-webkit-scrollbar,
  .detail-panel::-webkit-scrollbar {
    width: 6px;
  }
  .doc-list::-webkit-scrollbar-track,
  .detail-panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .doc-list::-webkit-scrollbar-thumb,
  .detail-panel::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(150, 150, 150, 0.3));
    border-radius: 10px;
  }

  /* No @media (prefers-color-scheme: dark) block: Asyar's tokens.css
     is dark-by-default and we consume only the --bg-*, --text-*,
     --accent-*, --border-color CSS variables it exposes. Adding a
     hardcoded dark-mode block would override the design tokens. */
</style>
