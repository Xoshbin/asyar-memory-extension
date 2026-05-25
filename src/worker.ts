// ─────────────────────────────────────────────────────────────────────
// worker.ts — Memory Tier 2 worker entry, loaded by dist/worker.html.
//
// Responsibilities:
//   - Register the 7 memory_* agent tools on activate; unregister on deactivate.
//   - Register view→worker RPC handlers (memory.delete, memory.pin, memory.clear).
// All read-modify-write logic lives in `lib/wrap.ts` + `lib/tools/*`.
// ─────────────────────────────────────────────────────────────────────

import {
  ExtensionContext as WorkerExtensionContext,
  extensionBridge,
} from 'asyar-sdk/worker';
import type {
  Extension,
  ExtensionContext,
  CommandExecuteArgs,
  ExtensionStateProxy,
  ILogService,
  IToolsService,
  ManifestTool,
} from 'asyar-sdk/contracts';

import manifest from '../manifest.json';
import { wrap } from './lib/wrap';
import { save } from './lib/tools/save';
import { list } from './lib/tools/list';
import { query } from './lib/tools/query';
import { update } from './lib/tools/update';
import { del } from './lib/tools/del';
import { pin } from './lib/tools/pin';
import { clear } from './lib/tools/clear';

const extensionId =
  window.location.hostname === 'localhost' ||
  window.location.hostname === 'asyar-extension.localhost'
    ? window.location.pathname.split('/').filter(Boolean)[0] ||
      'org.asyar.memory'
    : window.location.hostname || 'org.asyar.memory';

const workerContext = new WorkerExtensionContext();
workerContext.setExtensionId(extensionId);

const log = workerContext.getService<ILogService>('log');
const toolsService = workerContext.getService<IToolsService>('tools');
const stateProxy = workerContext.getService<ExtensionStateProxy>('state');

const now = (): number => Date.now();
const uuid = (): string => crypto.randomUUID();

const HANDLERS: Record<string, (args: unknown) => Promise<unknown>> = {
  memory_save: wrap(stateProxy, (e, a: Parameters<typeof save>[1]) =>
    save(e, a, { now, uuid }),
  ),
  memory_list: wrap(stateProxy, (e, a: Parameters<typeof list>[1]) => list(e, a)),
  memory_search: wrap(stateProxy, (e, a: Parameters<typeof query>[1]) => query(e, a)),
  memory_update: wrap(stateProxy, (e, a: Parameters<typeof update>[1]) => update(e, a)),
  memory_delete: wrap(stateProxy, (e, a: Parameters<typeof del>[1]) => del(e, a)),
  memory_pin: wrap(stateProxy, (e, a: Parameters<typeof pin>[1]) => pin(e, a)),
  memory_clear: wrap(stateProxy, (e, a: Parameters<typeof clear>[1]) => clear(e, a)),
};

class MemoryExtension implements Extension {
  async initialize(_ctx: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    log.info(`[${extensionId}] worker activated`);
    for (const decl of manifest.tools as ManifestTool[]) {
      const handler = HANDLERS[decl.id];
      if (!handler) {
        log.warn(`no handler for tool '${decl.id}' — skipping registration`);
        continue;
      }
      try {
        await toolsService.registerTool(decl, handler);
      } catch (err: unknown) {
        log.warn(`registerTool(${decl.id}) failed: ${describe(err)}`);
      }
    }
  }

  async deactivate(): Promise<void> {
    for (const decl of manifest.tools as ManifestTool[]) {
      try {
        await toolsService.unregisterTool(decl.id);
      } catch (err: unknown) {
        log.warn(`unregisterTool(${decl.id}) failed: ${describe(err)}`);
      }
    }
    log.info(`[${extensionId}] worker deactivated`);
  }

  async executeCommand(_commandId: string, _args?: CommandExecuteArgs): Promise<unknown> {
    // No background commands — view navigation handled view-side.
    return undefined;
  }

  // Required by `searchable: true` in manifest. Memory entries should NEVER
  // surface in root search (privacy: the user opens the view explicitly to
  // see them). The flag is set only to unlock the in-view search bar — the
  // launcher hides it when activeViewSearchable is false.
  async search(_query: string): Promise<never[]> {
    return [];
  }

  onUnload = (): void => {};
}

const ext = new MemoryExtension();
extensionBridge.registerManifest(
  manifest as Parameters<typeof extensionBridge.registerManifest>[0],
);
extensionBridge.registerExtensionImplementation(extensionId, ext);

// View → worker RPCs (mutating only). Reads come via state.subscribe.
workerContext.onRequest<{ note: string; tags?: string[] }, unknown>('memory.save', (p) =>
  HANDLERS.memory_save(p),
);
workerContext.onRequest<{ id: string; note: string; tags?: string[] }, unknown>('memory.update', (p) =>
  HANDLERS.memory_update(p),
);
workerContext.onRequest<{ id: string }, unknown>('memory.delete', (p) =>
  HANDLERS.memory_delete(p),
);
workerContext.onRequest<{ id: string; pinned: boolean }, unknown>('memory.pin', (p) =>
  HANDLERS.memory_pin(p),
);
workerContext.onRequest<Record<string, never>, unknown>('memory.clear', (p) =>
  HANDLERS.memory_clear(p),
);

void (async () => {
  try {
    await ext.activate();
  } catch (err: unknown) {
    log.error(`[${extensionId}] worker activate failed: ${describe(err)}`);
  }
})();

window.addEventListener('beforeunload', () => {
  void ext.deactivate();
});

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
