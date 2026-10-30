// Unit tests for markdown task-list helpers used by simple-layout cards.
import { countTasks, toggleTask } from '../client/src/tasks.js';

let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok' : 'FAIL'} - ${msg}`); if (!ok) failed++; };

const md = '# Shopping\n- [ ] milk\n- [x] eggs\n```\n- [ ] not a task\n```\n1. [ ] numbered\n* [X] star';
check(JSON.stringify(countTasks(md)) === '{"done":2,"total":4}', 'counts tasks, skipping fenced code');
check(toggleTask(md, 0).includes('- [x] milk'), 'checks an open task');
check(toggleTask(md, 1).includes('- [ ] eggs'), 'unchecks a done task');
check(toggleTask(md, 2).includes('1. [x] numbered') && toggleTask(md, 2).includes('- [ ] not a task'), 'ordered tasks count, code blocks are left alone');
check(toggleTask(md, 9) === md && toggleTask(md, -1) === md, 'out-of-range index is a no-op');
check(countTasks('').total === 0 && countTasks().total === 0, 'empty text has no tasks');

if (failed) { console.error(`${failed} task test(s) failed.`); process.exit(1); }
console.log('Task tests passed.');
