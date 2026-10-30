import { beforeAll, describe, expect, it, vi } from 'vitest';

let undoMod;
const events = [];
beforeAll(async () => {
  const target = new EventTarget();
  vi.stubGlobal('window', Object.assign(target, { dispatchEvent: (e) => { events.push(e.detail); return true; } }));
  vi.stubGlobal('CustomEvent', class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } });
  undoMod = await import('../../client/src/undo.js');
});

describe('undo stack', () => {
  it('undoes and redoes in order', async () => {
    const log = [];
    const { pushUndo, undo, redo } = undoMod;
    pushUndo({ label: 'a', undo: async () => log.push('undo a'), redo: async () => log.push('redo a') });
    pushUndo({ label: 'b', undo: async () => log.push('undo b'), redo: async () => log.push('redo b') });
    await undo();
    await undo();
    await redo();
    expect(log).toEqual(['undo b', 'undo a', 'redo a']);
    expect(events.at(-1)).toEqual({ label: 'a', kind: 'redid' });
  });
  it('reports a failed undo without losing the toast', async () => {
    const { pushUndo, undo } = undoMod;
    pushUndo({ label: 'c', undo: async () => { throw new Error('gone'); }, redo: async () => {} });
    await undo();
    expect(events.at(-1).kind).toBe('error');
    expect(events.at(-1).label).toContain('gone');
  });
});
