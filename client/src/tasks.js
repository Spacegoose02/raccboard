// @ts-check
// Markdown task lists ("- [ ] item"): count and toggle them in source text, skipping fenced code.
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

function taskLines(md) {
  const lines = md.split('\n');
  const found = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && TASK.test(line)) found.push(i);
  });
  return { lines, found };
}

export function countTasks(md = '') {
  const { lines, found } = taskLines(md);
  const done = found.filter((i) => TASK.exec(lines[i])[2] !== ' ').length;
  return { done, total: found.length };
}

// Flips the n-th task (0-based, document order); returns the text unchanged if there is no such task.
export function toggleTask(md, n) {
  const { lines, found } = taskLines(md);
  if (n < 0 || n >= found.length) return md;
  const i = found[n];
  lines[i] = lines[i].replace(TASK, (_, a, mark, b) => `${a}${mark === ' ' ? 'x' : ' '}${b}`);
  return lines.join('\n');
}
