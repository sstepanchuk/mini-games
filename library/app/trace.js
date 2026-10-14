// What happened lately on this page, for a bug report (together.js writes it; room.diag(), state() and, for tests,
// window.__ihroteka.trace() read it): the last MAX lines, oldest first, each with the time (UTC, to the tenth of a
// second: the reports of two devices line up). Types, names and sizes only: never what a message, a snapshot or a
// shared value says, nor an error's message (it may quote them). A line with the same key as the newest one takes
// its place and counts how many there were (a snapshot a second is one line, «×12»).
export const MAX = 40;
const lines = [];
const UTF8 = new TextEncoder();

export function note(text, key = text) {
  const last = lines[lines.length - 1], at = Date.now();   // (no .at(): Safari 15.4, as waiting.js)
  if (last && last.key === key) { last.text = text; last.at = at; last.n++; return; }
  lines.push({ at, text, key, n: 1 });
  if (lines.length > MAX) lines.shift();
}
const clock = t => new Date(t).toISOString().slice(11, 21);
export const read = () => lines.map(l => clock(l.at) + '  ' + l.text + (l.n > 1 ? '  ×' + l.n : ''));

// a value as the trace tells it: its size as JSON, in bytes ('?' when it cannot become JSON)
export function size(v) {
  try { const s = JSON.stringify(v); return (s === undefined ? 0 : UTF8.encode(s).length) + ' B'; } catch (e) { return '? B'; }
}
// what an event's arguments may say: names, flags and numbers as they are, a list of names joined, anything else its size
export const args = a => a.map(x => typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' || x == null ? String(x)
  : Array.isArray(x) && x.every(y => typeof y === 'string') ? '[' + x.join(', ') + ']' : size(x)).join(' ');

// An error as the trace tells it: its type and where it was thrown (the file's name, line and column: from the
// ErrorEvent ev, else the stack's first place), never its message. An error from another window (a game's frame)
// is no instance of ours: told apart by its tag.
export function error(e, ev) {
  const tag = Object.prototype.toString.call(e), typed = (tag === '[object Error]' || tag === '[object DOMException]') && typeof e.name === 'string';
  const name = typed ? e.name.slice(0, 40) : e === null ? 'null' : typeof e;
  let at = ev && ev.filename ? file(ev.filename) + ':' + ev.lineno + ':' + ev.colno : '';
  if (!at && typed && typeof e.stack === 'string') {
    const head = String(e), stack = e.stack.startsWith(head) ? e.stack.slice(head.length) : e.stack;   // (not the message: it may hold a place too)
    const m = stack.match(/([^\s()@]+):(\d+):(\d+)/);
    if (m) at = file(m[1]) + ':' + m[2] + ':' + m[3];
  }
  return name + (at ? ' at ' + at : '');
}
const file = f => String(f).split(/[?#]/)[0].split('/').filter(Boolean).pop() || '?';
