<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type {
    ExtensionContext,
    ExtensionStateProxy,
    IFeedbackService,
    IActionService,
    ExtensionAction,
  } from 'asyar-sdk/view';
  import { ActionContext } from 'asyar-sdk/view';

  import { STATE_KEYS, type MemoryEntry } from '../stateKeys';
  import { toMarkdown } from '../lib/markdown';
  import { normalizeTags } from '../lib/normalize';
  import { renderMarkdown } from '../lib/renderMarkdown';

  const EXTENSION_ID = 'org.asyar.memory';

  interface Props {
    context: ExtensionContext;
  }
  let { context }: Props = $props();

  const stateProxy = $derived(context.getService<ExtensionStateProxy>('state'));
  const feedback = $derived(context.getService<IFeedbackService>('feedback'));
  const actions = $derived(context.getService<IActionService>('actions'));

  // Platform-aware keycaps. The launcher binds `Mod` itself; this is only the
  // hint strip inside our own pane, so it has to spell the host platform out.
  const IS_MAC = /mac/i.test(navigator.userAgent);
  const HINT = {
    copy: '⏎',
    edit: IS_MAC ? '⌘E' : 'Ctrl+E',
    pin: IS_MAC ? '⌘⇧P' : 'Ctrl+Shift+P',
    delete: IS_MAC ? '⌃X' : 'Ctrl+X',
    save: IS_MAC ? '⌘⏎' : 'Ctrl+Enter',
  };

  let entries = $state<MemoryEntry[]>([]);
  let searchText = $state('');
  let tagFilter = $state<string | null>(null);
  let selectedIndex = $state(0);

  // 'view' shows the rendered memory; 'create'/'edit' swap the right pane for
  // the inline form (snippets pattern) instead of opening a dialog.
  let mode = $state<'view' | 'create' | 'edit'>('view');
  let formNote = $state('');
  let formTags = $state('');
  let formError = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let saving = $state(false);

  let listEl = $state<HTMLDivElement>();
  let noteEl = $state<HTMLTextAreaElement>();

  // Pipeline: entries → (search + tag filter) → date buckets → flat render
  // order. `selected` comes from `displayed` so it always matches the row
  // drawn at `selectedIndex`.
  const matched = $derived(filterEntries(entries, searchText, tagFilter));
  const grouped = $derived(groupByBucket(matched));
  const displayed = $derived(grouped.flatMap((group) => group.entries));
  // A row's flat index is read in the template; a map keeps that O(1) so
  // filtering a 1000-entry list never turns into a quadratic render pass.
  const indexById = $derived(new Map(displayed.map((entry, index) => [entry.id, index])));
  const selected = $derived(displayed[selectedIndex] ?? null);
  const selectedBody = $derived(selected ? renderMarkdown(selected.note) : '');
  const editingEntry = $derived(
    editingId ? (entries.find((entry) => entry.id === editingId) ?? null) : null,
  );

  // ── Date buckets ───────────────────────────────────────────────────
  type Bucket = 'Pinned' | 'Today' | 'Yesterday' | 'This week' | 'Earlier';
  const BUCKET_ORDER: Bucket[] = ['Pinned', 'Today', 'Yesterday', 'This week', 'Earlier'];

  interface Group {
    name: Bucket;
    entries: MemoryEntry[];
  }

  function bucketFor(entry: MemoryEntry): Bucket {
    if (entry.pinned) return 'Pinned';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = new Date(entry.at);
    day.setHours(0, 0, 0, 0);
    const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return 'This week';
    return 'Earlier';
  }

  function groupByBucket(rows: MemoryEntry[]): Group[] {
    const buckets = new Map<Bucket, MemoryEntry[]>();
    for (const row of rows) {
      const name = bucketFor(row);
      const bucket = buckets.get(name);
      if (bucket) bucket.push(row);
      else buckets.set(name, [row]);
    }
    for (const bucket of buckets.values()) bucket.sort((a, b) => b.at - a.at);
    return BUCKET_ORDER.filter((name) => buckets.has(name)).map((name) => ({
      name,
      entries: buckets.get(name)!,
    }));
  }

  function filterEntries(rows: MemoryEntry[], text: string, tag: string | null): MemoryEntry[] {
    const needle = text.trim().toLowerCase();
    return rows.filter((entry) => {
      if (tag && !entry.tags.includes(tag)) return false;
      if (!needle) return true;
      return (
        entry.note.toLowerCase().includes(needle) ||
        entry.tags.some((entryTag) => entryTag.includes(needle))
      );
    });
  }

  // ── Formatting ─────────────────────────────────────────────────────
  const fullDateFormat = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  function formatFull(at: number): string {
    return fullDateFormat.format(at);
  }

  /** Compact mono timestamp for the list column: now · 5m · 2h · 3d · 2w. */
  function relativeShort(at: number): string {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d`;
    const weeks = Math.round(days / 7);
    if (weeks < 5) return `${weeks}w`;
    const months = Math.round(days / 30);
    if (months < 12) return `${months}mo`;
    return `${Math.round(days / 365)}y`;
  }

  function relativeLong(at: number): string {
    const short = relativeShort(at);
    return short === 'now' ? 'Just now' : `${short} ago`;
  }

  function titleOf(entry: MemoryEntry): string {
    const trimmed = entry.note.trim();
    const firstBreak = trimmed.indexOf('\n');
    return (firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak)).slice(0, 160);
  }

  /** Second line of a multi-line note, used when the entry has no tags. */
  function previewOf(entry: MemoryEntry): string {
    const trimmed = entry.note.trim();
    const firstBreak = trimmed.indexOf('\n');
    if (firstBreak === -1) return '';
    return trimmed
      .slice(firstBreak + 1)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  // ── Selection ──────────────────────────────────────────────────────
  function select(index: number) {
    selectedIndex = index;
  }

  function moveSelection(delta: number) {
    if (displayed.length === 0) return;
    selectedIndex = Math.min(displayed.length - 1, Math.max(0, selectedIndex + delta));
  }

  function scrollSelectedIntoView() {
    const row = listEl?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function filterByTag(tag: string) {
    tagFilter = tagFilter === tag ? null : tag;
    selectedIndex = 0;
  }

  // ── Launcher bridge ────────────────────────────────────────────────
  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return;
    const data = event.data as { type?: string; payload?: Record<string, unknown> } | null;
    if (!data || typeof data.type !== 'string') return;
    if (mode !== 'view') return;

    if (data.type === 'asyar:view:search') {
      searchText = String(data.payload?.query ?? '');
      tagFilter = null;
      selectedIndex = 0;
      return;
    }

    if (data.type === 'asyar:view:keydown') {
      const key = data.payload?.key;
      if (key === 'ArrowDown') moveSelection(1);
      else if (key === 'ArrowUp') moveSelection(-1);
      else if (key === 'Enter') void copyMemory();
    }
  }

  /**
   * When focus sits inside the iframe (after clicking a row, or on the frame
   * body once a form closes) the host never sees the key. Handle list keys
   * here too so navigation never depends on which side of the frame boundary
   * holds focus.
   */
  function handleLocalKeyDown(event: KeyboardEvent) {
    if (mode !== 'view' || event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void copyMemory();
    }
  }

  // Keep the highlight inside a list that just shrank (search, filter, delete).
  $effect(() => {
    const length = displayed.length;
    if (length === 0) {
      if (selectedIndex !== 0) selectedIndex = 0;
      return;
    }
    if (selectedIndex > length - 1) selectedIndex = length - 1;
  });

  $effect(() => {
    selectedIndex;
    if (mode !== 'view') return;
    requestAnimationFrame(scrollSelectedIntoView);
  });

  // ── Form ───────────────────────────────────────────────────────────
  function inlineTags(note: string): string[] {
    return Array.from(note.matchAll(/(?:^|\s)#([\w-]+)/g), (match) => match[1]);
  }

  function splitTags(input: string): string[] {
    return input
      .split(/[,\s]+/)
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
  }

  async function startCreate() {
    mode = 'create';
    formNote = '';
    formTags = '';
    formError = null;
    editingId = null;
    await focusFormNote();
  }

  async function startEdit(entry: MemoryEntry) {
    mode = 'edit';
    formNote = entry.note;
    formTags = entry.tags.join(', ');
    formError = null;
    editingId = entry.id;
    await focusFormNote();
  }

  async function focusFormNote() {
    await tick();
    noteEl?.focus();
    noteEl?.setSelectionRange(formNote.length, formNote.length);
    resizeNote();
  }

  function resizeNote() {
    const element = noteEl;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }

  function cancelForm() {
    mode = 'view';
    formNote = '';
    formTags = '';
    formError = null;
    editingId = null;
  }

  function onFormKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelForm();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveForm();
    }
  }

  async function saveForm() {
    if (saving) return;
    const note = formNote.trim();
    if (!note) {
      formError = 'Add text before saving.';
      return;
    }
    const tags = normalizeTags([...splitTags(formTags), ...inlineTags(formNote)]);

    saving = true;
    try {
      if (mode === 'create') {
        const result = (await context.request('memory.save', { note, tags })) as
          { saved: true; id: string; total: number } | { saved: false; error: string };
        if (!result.saved) {
          formError = result.error;
          return;
        }
        cancelForm();
        await feedback.showHUD('Memory saved');
      } else if (mode === 'edit' && editingId) {
        const result = (await context.request('memory.update', {
          id: editingId,
          note,
          tags,
        })) as { updated: true; id: string } | { updated: false; error: string };
        if (!result.updated) {
          formError = result.error;
          return;
        }
        cancelForm();
        await feedback.showHUD('Memory updated');
      }
    } finally {
      saving = false;
    }
  }

  // ── Actions ────────────────────────────────────────────────────────
  async function addMemory() {
    if (mode !== 'view') return;
    await startCreate();
  }

  async function editMemory() {
    if (mode !== 'view' || !selected) return;
    await startEdit(selected);
  }

  async function togglePin() {
    const entry = selected;
    if (!entry) return;
    keepSelectionId = entry.id;
    await context.request('memory.pin', { id: entry.id, pinned: !entry.pinned });
  }

  async function deleteMemory() {
    const entry = selected;
    if (!entry) return;
    const confirmed = await feedback.confirmAlert({
      title: 'Delete this memory?',
      message: titleOf(entry),
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    // Decide the neighbour before the row disappears, then let the state
    // subscription place the highlight on it once the list shrinks.
    const neighbourId =
      displayed[selectedIndex + 1]?.id ?? displayed[selectedIndex - 1]?.id ?? null;
    await context.request('memory.delete', { id: entry.id });
    if (neighbourId) keepSelectionId = neighbourId;
    else selectedIndex = 0;
  }

  async function clearAll() {
    if (entries.length === 0) return;
    const confirmed = await feedback.confirmAlert({
      title: 'Clear all memories?',
      message: `${entries.length} ${entries.length === 1 ? 'memory' : 'memories'} will be deleted. This cannot be undone.`,
      confirmText: 'Clear all',
      variant: 'danger',
    });
    if (!confirmed) return;
    await context.request('memory.clear', {});
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Sandboxed iframes can deny the async API; fall back to execCommand.
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }

  async function copyMemory() {
    const entry = selected;
    if (!entry) return;
    const copied = await writeClipboard(entry.note);
    await feedback.showHUD(copied ? 'Copied to clipboard' : 'Copy failed');
  }

  async function copyAsMarkdown() {
    const entry = selected;
    if (!entry) return;
    const markdown = [entry.note, entry.tags.map((tag) => `#${tag}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');
    const copied = await writeClipboard(markdown);
    await feedback.showHUD(copied ? 'Copied as markdown' : 'Copy failed');
  }

  async function exportMarkdown() {
    if (entries.length === 0) return;
    const markdown = toMarkdown(entries, new Date());
    const filename = `asyar-memory-${new Date().toISOString().slice(0, 10)}.md`;
    let downloaded = false;
    try {
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      downloaded = true;
    } catch {
      // Sandbox blocked the download — clipboard is the graceful fallback.
    }
    if (!downloaded) await writeClipboard(markdown);
    await feedback.showHUD(
      downloaded
        ? `Exported ${entries.length} ${entries.length === 1 ? 'memory' : 'memories'}`
        : 'Download blocked — markdown copied',
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────────────
  // Action metadata crosses the iframe boundary, so it must stay serializable:
  // no `visible()` closures (they cannot be cloned). Actions guard themselves
  // in `execute` instead.
  type ViewAction = ExtensionAction & { confirmInExecute?: boolean };

  let keepSelectionId: string | null = null;
  const registeredActionIds: string[] = [];

  onMount(() => {
    let active = true;
    const cleanups: Array<() => void | Promise<void>> = [];

    const onMessage = (event: MessageEvent) => handleMessage(event);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', handleLocalKeyDown);
    cleanups.push(() => window.removeEventListener('message', onMessage));
    cleanups.push(() => window.removeEventListener('keydown', handleLocalKeyDown));

    void (async () => {
      const [initial, unsubscribe] = await Promise.all([
        stateProxy.get(STATE_KEYS.entries),
        stateProxy.subscribe(STATE_KEYS.entries, (value) => {
          if (!active) return;
          const next = Array.isArray(value) ? (value as MemoryEntry[]) : [];
          entries = next;
          if (keepSelectionId) {
            const fresh = groupByBucket(filterEntries(next, searchText, tagFilter)).flatMap(
              (group) => group.entries,
            );
            const index = fresh.findIndex((entry) => entry.id === keepSelectionId);
            if (index >= 0) selectedIndex = index;
            keepSelectionId = null;
          }
        }),
      ]);
      if (!active) {
        void unsubscribe();
        return;
      }
      entries = Array.isArray(initial) ? (initial as MemoryEntry[]) : [];
      cleanups.push(unsubscribe);
    })();

    // View-scoped actions. `manifest.actions[]` only renders in root search, so
    // everything the user can reach while this pane is open is registered here.
    const viewActions: ViewAction[] = [
      {
        id: `${EXTENSION_ID}:add-memory`,
        title: 'Add memory',
        description: 'Write a new memory. #tags inside the note are saved as tags.',
        icon: 'icon:plus',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+N',
        execute: addMemory,
      },
      {
        id: `${EXTENSION_ID}:edit-memory`,
        title: 'Edit memory',
        description: 'Edit the selected memory in place.',
        icon: 'icon:pencil',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+E',
        execute: editMemory,
      },
      {
        id: `${EXTENSION_ID}:pin-memory`,
        title: 'Pin or unpin memory',
        description: 'Pinned memories are never evicted by the 1000-entry cap.',
        icon: 'icon:pin',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+P',
        execute: togglePin,
      },
      {
        id: `${EXTENSION_ID}:copy-memory`,
        title: 'Copy memory',
        description: 'Copy the selected note text to the clipboard.',
        icon: 'icon:copy',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: copyMemory,
      },
      {
        id: `${EXTENSION_ID}:copy-markdown`,
        title: 'Copy as markdown',
        description: 'Copy the selected memory as markdown with its #tags.',
        icon: 'icon:copy',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Mod+Shift+C',
        execute: copyAsMarkdown,
      },
      {
        id: `${EXTENSION_ID}:delete-memory`,
        title: 'Delete memory',
        description: 'Delete the selected memory after confirming.',
        icon: 'icon:trash',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Control+X',
        destructive: true,
        confirmInExecute: true,
        execute: deleteMemory,
      },
      {
        id: `${EXTENSION_ID}:export-markdown`,
        title: 'Export as markdown',
        description: 'Download every memory as a single markdown file.',
        icon: 'icon:download',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        execute: exportMarkdown,
      },
      {
        id: `${EXTENSION_ID}:clear-memories`,
        title: 'Clear all memories',
        description: 'Delete everything, including pinned memories, after confirming.',
        icon: 'icon:trash',
        category: 'Memory',
        extensionId: EXTENSION_ID,
        context: ActionContext.EXTENSION_VIEW,
        shortcut: 'Control+Shift+X',
        destructive: true,
        confirmInExecute: true,
        execute: clearAll,
      },
    ];

    for (const action of viewActions) {
      actions.registerAction(action);
      registeredActionIds.push(action.id);
    }

    return () => {
      active = false;
      for (const id of registeredActionIds) actions.unregisterAction(id);
      registeredActionIds.length = 0;
      for (const cleanup of cleanups) {
        try {
          void cleanup();
        } catch {
          // Teardown only — nothing left to report to.
        }
      }
    };
  });
</script>

<div class="memory">
  <aside class="list-pane" aria-label="Memories">
    {#if tagFilter}
      <div class="tag-filter">
        <span class="tag-filter-label">Filtering</span>
        <span class="tag-pill">#{tagFilter}</span>
        <button
          class="tag-filter-clear"
          type="button"
          aria-label="Clear tag filter"
          onclick={() => {
            tagFilter = null;
            selectedIndex = 0;
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    {/if}

    <div class="list-scroll" bind:this={listEl} role="listbox" aria-label="Memory list">
      {#if displayed.length === 0}
        <div class="list-empty">
          {#if entries.length === 0}
            <svg class="empty-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 4.5h9.5L19 9v10.5H5z M14 4.5V9h5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linejoin="round"
              />
            </svg>
            <p class="empty-title">No memories yet</p>
            <p class="empty-hint">
              Ask an agent to remember something, or press
              <kbd>{IS_MAC ? '⌘N' : 'Ctrl+N'}</kbd> to write one.
            </p>
          {:else}
            <p class="empty-title">Nothing matches</p>
            <p class="empty-hint">
              {#if tagFilter}No entry is tagged #{tagFilter}.{:else}No memory contains “{searchText}”.{/if}
            </p>
          {/if}
        </div>
      {:else}
        {#each grouped as group (group.name)}
          <div class="section" role="group" aria-label={group.name}>
            <div class="section-header">{group.name}</div>
            {#each group.entries as entry (entry.id)}
              {@const index = indexById.get(entry.id) ?? 0}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="row"
                class:selected={selectedIndex === index}
                data-index={index}
                role="option"
                tabindex="-1"
                aria-selected={selectedIndex === index}
                onclick={() => {
                  if (mode !== 'view') cancelForm();
                  select(index);
                }}
              >
                <span
                  class="row-pin"
                  aria-hidden={!entry.pinned}
                  aria-label={entry.pinned ? 'Pinned' : undefined}
                >
                  {#if entry.pinned}
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path
                        d="M4 1.5h4l-.6 2.4 1.7 1.8H2.9l1.7-1.8z M6 5.7v4.8"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.1"
                        stroke-linejoin="round"
                        stroke-linecap="round"
                      />
                    </svg>
                  {/if}
                </span>
                <span class="row-main">
                  <span class="row-title">{titleOf(entry)}</span>
                  <span class="row-meta">
                    {#if entry.tags.length > 0}
                      {#each entry.tags.slice(0, 2) as tag (tag)}
                        <span class="tag-pill">#{tag}</span>
                      {/each}
                      {#if entry.tags.length > 2}
                        <span class="tag-more">+{entry.tags.length - 2}</span>
                      {/if}
                    {:else if previewOf(entry)}
                      <span class="row-preview">{previewOf(entry)}</span>
                    {/if}
                  </span>
                </span>
                <span class="row-time">{relativeShort(entry.at)}</span>
              </div>
            {/each}
          </div>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="detail-pane" aria-label="Memory">
    {#if mode === 'view'}
      {#if selected}
        <header class="detail-header">
          <div class="detail-meta">
            <span class="detail-relative">{relativeLong(selected.at)}</span>
            <span class="detail-separator" aria-hidden="true">·</span>
            <span class="detail-date">{formatFull(selected.at)}</span>
          </div>
          {#if selected.pinned}
            <span class="pin-flag">
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path
                  d="M4 1.5h4l-.6 2.4 1.7 1.8H2.9l1.7-1.8z M6 5.7v4.8"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.1"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </svg>
              Pinned
            </span>
          {/if}
        </header>

        <div class="detail-scroll">
          <div class="md-body">{@html selectedBody}</div>
          {#if selected.tags.length > 0}
            <div class="tag-cluster">
              {#each selected.tags as tag (tag)}
                <button
                  class="tag-pill interactive"
                  type="button"
                  onclick={() => filterByTag(tag)}
                  aria-pressed={tagFilter === tag}
                >
                  #{tag}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <footer class="detail-footer">
          <span class="hint"><kbd>{HINT.copy}</kbd> Copy</span>
          <span class="hint"><kbd>{HINT.edit}</kbd> Edit</span>
          <span class="hint"><kbd>{HINT.pin}</kbd> {selected.pinned ? 'Unpin' : 'Pin'}</span>
          <span class="hint"><kbd>{HINT.delete}</kbd> Delete</span>
        </footer>
      {:else}
        <div class="detail-empty">
          <svg class="empty-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 4.5h9.5L19 9v10.5H5z M14 4.5V9h5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
          </svg>
          <p class="empty-title">
            {entries.length === 0 ? 'Nothing saved yet' : 'No memory selected'}
          </p>
          <p class="empty-hint">
            {entries.length === 0
              ? 'Memories written by an agent appear here.'
              : 'Pick a memory on the left, or press ' +
                (IS_MAC ? '⌘N' : 'Ctrl+N') +
                ' to add one.'}
          </p>
        </div>
      {/if}
    {:else}
      <div class="form">
        <header class="form-header">
          <h2 class="form-title">{mode === 'edit' ? 'Edit memory' : 'Add memory'}</h2>
          {#if mode === 'edit' && editingEntry}
            <p class="form-subtitle">
              Saved {formatFull(editingEntry.at)}
              <code class="form-id">{editingEntry.id.slice(0, 8)}</code>
            </p>
          {/if}
        </header>

        <div class="form-body">
          <div class="field">
            <label class="field-label" for="memory-note">Memory</label>
            <textarea
              id="memory-note"
              class="field-textarea"
              bind:value={formNote}
              bind:this={noteEl}
              oninput={resizeNote}
              onkeydown={onFormKeyDown}
              placeholder="Prefers dark roast coffee in the morning"
              rows="4"
              spellcheck="true"></textarea>
          </div>

          <div class="field">
            <label class="field-label" for="memory-tags">Tags</label>
            <input
              id="memory-tags"
              class="field-input"
              type="text"
              bind:value={formTags}
              onkeydown={onFormKeyDown}
              placeholder="preferences, food"
            />
            <p class="field-help">Comma separated, up to 5. #tags inside the note are saved too.</p>
          </div>

          {#if formError}
            <p class="form-error" role="alert">{formError}</p>
          {/if}
        </div>

        <footer class="form-footer">
          <span class="hint"><kbd>{HINT.save}</kbd> Save</span>
          <div class="form-actions">
            <button class="btn-secondary" type="button" onclick={cancelForm}>Cancel</button>
            <button class="btn-primary" type="button" onclick={saveForm} disabled={saving}>
              Save
            </button>
          </div>
        </footer>
      </div>
    {/if}
  </section>
</div>

<style>
  :global(html, body) {
    height: 100%;
    margin: 0;
    padding: 0;
  }
  :global(#app) {
    height: 100%;
    width: 100%;
  }

  .memory {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-primary);
    font-family: var(--font-ui);
    color: var(--text-primary);
  }

  /* ── Left: memory list ─────────────────────────────────────────── */
  .list-pane {
    display: flex;
    flex-direction: column;
    width: 300px;
    min-width: 260px;
    min-height: 0;
    border-right: 1px solid var(--separator);
  }

  .tag-filter {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--divider-soft);
  }
  .tag-filter-label {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
  .tag-filter-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-md);
    height: var(--size-md);
    margin-left: auto;
    padding: 0;
    border: none;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-tertiary);
    cursor: default;
  }
  .tag-filter-clear:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-3);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .section-header {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--space-4) var(--space-5) var(--space-1-5);
    font-size: var(--font-size-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-normal);
    color: var(--text-secondary);
    background: var(--bg-primary);
    backdrop-filter: blur(12px);
    user-select: none;
  }

  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-2);
    height: 44px;
    margin: 0 var(--space-2);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    box-sizing: border-box;
    cursor: default;
    transition: background var(--transition-fast);
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.selected {
    background: var(--bg-selected);
    transition: none;
  }

  .row-pin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-xs);
    color: var(--accent-warning);
  }
  .row-pin svg {
    width: var(--size-xs);
    height: var(--size-xs);
  }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .row-title {
    overflow: hidden;
    font-size: var(--font-size-md);
    font-weight: 500;
    line-height: 1.35;
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .row-preview {
    overflow: hidden;
    font-size: var(--font-size-xs);
    line-height: 1.35;
    color: var(--text-tertiary);
    text-overflow: ellipsis;
  }
  .row-time {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }

  .tag-pill {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-variant-numeric: tabular-nums;
    line-height: 1.5;
    color: var(--text-tertiary);
  }
  .tag-more {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
  }

  .list-empty,
  .detail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-9) var(--space-6);
    text-align: center;
  }
  .empty-glyph {
    width: var(--size-2xl);
    height: var(--size-2xl);
    color: var(--text-tertiary);
    opacity: 0.7;
  }
  .empty-title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 500;
    color: var(--text-secondary);
  }
  .empty-hint {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: var(--text-tertiary);
    max-width: 32ch;
  }

  /* ── Right: detail ──────────────────────────────────────────────── */
  .detail-pane {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-secondary);
  }

  .detail-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-5);
    flex-shrink: 0;
    padding: var(--space-7) var(--space-8) var(--space-3);
  }
  .detail-meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }
  .detail-relative {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .detail-separator {
    color: var(--text-tertiary);
  }
  .detail-date {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin-flag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    font-size: var(--font-size-xs);
    color: var(--accent-warning);
  }
  .pin-flag svg {
    width: var(--size-xs);
    height: var(--size-xs);
  }

  .detail-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4) var(--space-8) var(--space-9);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .tag-cluster {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-7);
    padding-top: var(--space-5);
    border-top: 1px solid var(--divider-soft);
  }
  .tag-pill.interactive {
    padding: 1px var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    cursor: default;
  }
  .tag-pill.interactive:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .tag-pill.interactive[aria-pressed='true'] {
    border-color: var(--border-color);
    color: var(--text-primary);
  }

  .detail-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    flex-shrink: 0;
    padding: var(--space-3) var(--space-8);
    border-top: 1px solid var(--separator);
    background: var(--bg-secondary);
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
  kbd {
    padding: 1px var(--space-1);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }

  /* ── Rendered markdown ──────────────────────────────────────────── */
  .md-body {
    font-size: var(--font-size-base);
    line-height: 1.55;
    color: var(--text-primary);
    word-break: break-word;
  }
  .md-body :global(.md-paragraph) {
    margin: 0 0 var(--space-5);
  }
  .md-body :global(.md-paragraph:last-child) {
    margin-bottom: 0;
  }
  .md-body :global(.md-heading) {
    margin: var(--space-7) 0 var(--space-3);
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }
  .md-body :global(h2.md-heading) {
    font-size: var(--font-size-xl);
  }
  .md-body :global(h3.md-heading) {
    font-size: var(--font-size-lg);
  }
  .md-body :global(h4.md-heading),
  .md-body :global(h5.md-heading),
  .md-body :global(h6.md-heading) {
    font-size: var(--font-size-base);
    color: var(--text-secondary);
  }
  .md-body :global(strong) {
    font-weight: 600;
  }
  .md-body :global(.md-list) {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0 0 var(--space-5);
    padding-left: var(--space-7);
  }
  .md-body :global(.md-item) {
    line-height: 1.55;
  }
  .md-body :global(.md-code) {
    margin: 0 0 var(--space-5);
    padding: var(--space-5);
    overflow-x: auto;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
  }
  .md-body :global(.md-code code) {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre;
  }
  .md-body :global(.md-inline-code) {
    padding: 1px var(--space-1-5);
    background: var(--bg-tertiary);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
  .md-body :global(.md-quote) {
    margin: 0 0 var(--space-5);
    padding-left: var(--space-5);
    border-left: 2px solid var(--border-color);
    color: var(--text-secondary);
  }
  .md-body :global(.md-rule) {
    margin: var(--space-6) 0;
    border: none;
    border-top: 1px solid var(--separator);
  }
  .md-body :global(.md-link) {
    color: var(--accent-primary);
    text-decoration: none;
  }
  .md-body :global(.md-link:hover) {
    text-decoration: underline;
  }
  .md-body :global(.md-tag) {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .md-body :global(del) {
    color: var(--text-tertiary);
  }

  /* ── Inline form ────────────────────────────────────────────────── */
  .form {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .form-header {
    flex-shrink: 0;
    padding: var(--space-7) var(--space-8) var(--space-4);
  }
  .form-title {
    margin: 0;
    font-size: var(--font-size-xl);
    font-weight: 600;
    letter-spacing: var(--tracking-tight);
    color: var(--text-primary);
  }
  .form-subtitle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }
  .form-id {
    padding: 1px var(--space-1-5);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
  }

  .form-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-6);
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--space-8) var(--space-7);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .field-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .field-input,
  .field-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-base);
    line-height: 1.55;
    outline: none;
    transition:
      border-color var(--transition-fast),
      box-shadow var(--transition-fast);
  }
  .field-textarea {
    min-height: 96px;
    max-height: 45vh;
    overflow-y: auto;
    resize: none;
  }
  .field-input::placeholder,
  .field-textarea::placeholder {
    color: var(--text-tertiary);
  }
  .field-input:focus,
  .field-textarea:focus {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }
  .field-help {
    margin: 0;
    font-size: var(--font-size-xs);
    line-height: 1.45;
    color: var(--text-tertiary);
  }
  .form-error {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--accent-danger) 32%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
    font-size: var(--font-size-sm);
    color: var(--accent-danger);
  }

  .form-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    flex-shrink: 0;
    padding: var(--space-4) var(--space-8);
    border-top: 1px solid var(--separator);
  }
  .form-actions {
    display: flex;
    gap: var(--space-2);
  }
  .btn-primary,
  .btn-secondary {
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-sm);
    font-family: var(--font-ui);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: default;
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);
  }
  .btn-primary {
    border: 1px solid transparent;
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
  }
  .btn-primary:hover {
    opacity: 0.92;
  }
  .btn-primary:disabled {
    opacity: 0.5;
  }
  .btn-secondary {
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-primary);
  }
  .btn-secondary:hover {
    background: var(--bg-hover);
  }
  .btn-primary:focus-visible,
  .btn-secondary:focus-visible,
  .tag-pill.interactive:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
</style>
