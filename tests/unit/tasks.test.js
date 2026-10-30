import { describe, expect, it } from 'vitest';
import { countTasks, toggleTask } from '../../client/src/tasks.js';

const md = '# Shopping\n- [ ] milk\n- [x] eggs\n```\n- [ ] not a task\n```\n1. [ ] numbered\n* [X] star';

describe('markdown task lists', () => {
  it('counts tasks, skipping fenced code', () => expect(countTasks(md)).toEqual({ done: 2, total: 4 }));
  it('checks an open task', () => expect(toggleTask(md, 0)).toContain('- [x] milk'));
  it('unchecks a done task', () => expect(toggleTask(md, 1)).toContain('- [ ] eggs'));
  it('counts ordered tasks and leaves code blocks alone', () => {
    const out = toggleTask(md, 2);
    expect(out).toContain('1. [x] numbered');
    expect(out).toContain('- [ ] not a task');
  });
  it('ignores out-of-range indexes', () => {
    expect(toggleTask(md, 9)).toBe(md);
    expect(toggleTask(md, -1)).toBe(md);
  });
  it('treats empty text as no tasks', () => {
    expect(countTasks('').total).toBe(0);
    expect(countTasks().total).toBe(0);
  });
});
