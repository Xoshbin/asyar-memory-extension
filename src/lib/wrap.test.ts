import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrap, type StateLike } from './wrap';
import { STATE_KEYS, type MemoryEntry } from '../stateKeys';
import { save } from './tools/save';
import { clear } from './tools/clear';

function makeStateProxy(initial: unknown = null): StateLike & { snapshot: () => unknown } {
  let value: unknown = initial;
  return {
    get: vi.fn(async (_k: string) => value),
    set: vi.fn(async (_k: string, v: unknown) => {
      value = v;
    }),
    snapshot: () => value,
  };
}

describe('wrap', () => {
  let stateProxy: ReturnType<typeof makeStateProxy>;
  beforeEach(() => {
    stateProxy = makeStateProxy();
  });

  it('reads entries, calls pure fn, writes when next !== prev', async () => {
    const handler = wrap(stateProxy, (entries, args: { note: string }) =>
      save(entries, args, { now: () => 1, uuid: () => 'fixed' }),
    );
    const result = await handler({ note: 'hello' });
    expect(stateProxy.get).toHaveBeenCalledWith(STATE_KEYS.entries);
    expect(stateProxy.set).toHaveBeenCalledTimes(1);
    expect(stateProxy.set).toHaveBeenCalledWith(STATE_KEYS.entries, [
      { id: 'fixed', note: 'hello', at: 1, tags: [], pinned: false } as MemoryEntry,
    ]);
    expect(result).toEqual({ saved: true, id: 'fixed', total: 1 });
  });

  it('does NOT write when next === prev (no-op tool)', async () => {
    const handler = wrap(stateProxy, (entries) => ({
      next: entries,
      result: { count: 0, entries },
    }));
    await handler({});
    expect(stateProxy.set).not.toHaveBeenCalled();
  });

  it('writes empty array when clear is invoked on non-empty state', async () => {
    stateProxy = makeStateProxy([
      { id: 'x', note: 'x', at: 0, tags: [], pinned: true },
    ] as MemoryEntry[]);
    const handler = wrap(stateProxy, (entries, args) =>
      clear(entries, args as Record<string, never>),
    );
    const result = await handler({});
    expect(stateProxy.set).toHaveBeenCalledWith(STATE_KEYS.entries, []);
    expect(result).toEqual({ cleared: 1 });
    expect(stateProxy.snapshot()).toEqual([]);
  });

  it('treats null state as empty array on first read', async () => {
    stateProxy = makeStateProxy(null);
    const handler = wrap(stateProxy, (entries) => ({
      next: entries,
      result: { length: entries.length },
    }));
    const result = await handler({});
    expect(result).toEqual({ length: 0 });
  });
});
