export const MAX_CHARS = 100000,
  MAX_LINES = 800;
export function lines(text) {
  if (typeof text !== 'string' || text.length > MAX_CHARS || text.includes('\0'))
    throw Error('Each input must be text without NUL, at most 100,000 characters.');
  const result = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
  if (result.length > MAX_LINES) throw Error('Each input is limited to 800 lines.');
  return result;
}
export function endingStyle(text) {
  const endings = text.match(/\r\n|\r|\n/g) || [],
    unique = new Set(endings);
  return unique.size > 1
    ? 'mixed'
    : unique.size === 0
      ? 'none'
      : endings[0] === '\r\n'
        ? 'CRLF'
        : endings[0] === '\r'
          ? 'CR'
          : 'LF';
}
export function editedText(previous, value) {
  const style = endingStyle(previous),
    normalized = value.replace(/\r\n|\r/g, '\n');
  return style === 'CRLF'
    ? normalized.replaceAll('\n', '\r\n')
    : style === 'CR'
      ? normalized.replaceAll('\n', '\r')
      : normalized;
}
export function diff(base, changed) {
  const a = lines(base),
    b = lines(changed),
    width = b.length + 1,
    dp = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
  let i = 0,
    j = 0;
  const operations = [],
    hunks = [];
  let hunk = null;
  function flush() {
    if (hunk) {
      hunks.push(hunk);
      hunk = null;
    }
  }
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      operations.push({ type: 'equal', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (
      i < a.length &&
      (j === b.length || dp[(i + 1) * width + j] >= dp[i * width + j + 1])
    ) {
      hunk ??= { start: i, end: i, replacement: [] };
      operations.push({ type: 'delete', text: a[i], oldLine: i + 1, newLine: null });
      i++;
      hunk.end = i;
    } else {
      hunk ??= { start: i, end: i, replacement: [] };
      operations.push({ type: 'insert', text: b[j], oldLine: null, newLine: j + 1 });
      hunk.replacement.push(b[j++]);
    }
  }
  flush();
  return {
    operations,
    hunks,
    commonLines: dp[0],
    deleted: operations.filter((o) => o.type === 'delete').length,
    inserted: operations.filter((o) => o.type === 'insert').length,
  };
}
function touches(a, b) {
  const ai = a.start === a.end,
    bi = b.start === b.end;
  if (ai && bi) return a.start === b.start;
  if (ai) return a.start >= b.start && a.start <= b.end;
  if (bi) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}
function apply(base, start, end, hunks) {
  let cursor = start;
  const out = [];
  for (const h of hunks.sort((a, b) => a.start - b.start || a.end - b.end)) {
    out.push(...base.slice(cursor, h.start), ...h.replacement);
    cursor = h.end;
  }
  out.push(...base.slice(cursor, end));
  return out.join('');
}
export function merge(sources) {
  if (
    !sources ||
    typeof sources !== 'object' ||
    Array.isArray(sources) ||
    Object.keys(sources).length !== 3 ||
    !['base', 'ours', 'theirs'].every((k) => Object.hasOwn(sources, k))
  )
    throw Error('Provide base, ours, and theirs only.');
  const base = lines(sources.base);
  lines(sources.ours);
  lines(sources.theirs);
  const ours = diff(sources.base, sources.ours),
    theirs = diff(sources.base, sources.theirs),
    all = [
      ...ours.hunks.map((h) => ({ ...h, side: 'ours' })),
      ...theirs.hunks.map((h) => ({ ...h, side: 'theirs' })),
    ],
    parent = all.map((_, i) => i);
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      if (all[i].side !== all[j].side && touches(all[i], all[j])) parent[root(j)] = root(i);
  const grouped = new Map();
  all.forEach((h, i) => {
    const r = root(i);
    if (!grouped.has(r)) grouped.set(r, []);
    grouped.get(r).push(h);
  });
  const groups = [...grouped.values()]
    .map((edits) => ({
      edits,
      start: Math.min(...edits.map((h) => h.start)),
      end: Math.max(...edits.map((h) => h.end)),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const segments = [],
    conflicts = [];
  let cursor = 0,
    automaticGroups = 0;
  function text(value) {
    if (!value) return;
    if (segments.at(-1)?.kind === 'text') segments.at(-1).text += value;
    else segments.push({ kind: 'text', text: value });
  }
  for (const group of groups) {
    if (group.start < cursor) throw Error('Unexpected overlapping merge groups.');
    text(base.slice(cursor, group.start).join(''));
    const original = base.slice(group.start, group.end).join(''),
      left = apply(
        base,
        group.start,
        group.end,
        group.edits.filter((h) => h.side === 'ours'),
      ),
      right = apply(
        base,
        group.start,
        group.end,
        group.edits.filter((h) => h.side === 'theirs'),
      );
    if (left === right) {
      text(left);
      automaticGroups++;
    } else if (left === original) {
      text(right);
      automaticGroups++;
    } else if (right === original) {
      text(left);
      automaticGroups++;
    } else {
      const conflict = {
        id: conflicts.length,
        start: group.start,
        end: group.end,
        base: original,
        ours: left,
        theirs: right,
      };
      conflicts.push(conflict);
      segments.push({ kind: 'conflict', id: conflict.id });
    }
    cursor = group.end;
  }
  text(base.slice(cursor).join(''));
  const preferred = sources.base.match(/\r\n|\r|\n/)?.[0] || '\n';
  return {
    sources: { ...sources },
    diffs: { ours, theirs },
    segments,
    conflicts,
    automaticGroups,
    markerEnding: preferred,
  };
}
export function resolve(result, resolutions = {}) {
  if (!resolutions || typeof resolutions !== 'object' || Array.isArray(resolutions))
    throw Error('Resolutions must be an object keyed by conflict ID.');
  let manualChars = 0;
  for (const [key, value] of Object.entries(resolutions)) {
    if (
      !/^(0|[1-9][0-9]*)$/.test(key) ||
      Number(key) >= result.conflicts.length ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !['unresolved', 'ours', 'theirs', 'base', 'manual'].includes(value.choice) ||
      Object.keys(value).some((k) => !['choice', 'text'].includes(k))
    )
      throw Error('Invalid or stale conflict resolution.');
    if (value.choice === 'manual') {
      if (typeof value.text !== 'string' || value.text.includes('\0'))
        throw Error('Manual resolutions must be text without NUL.');
      manualChars += value.text.length;
    } else if (Object.hasOwn(value, 'text')) throw Error('Only manual resolutions carry text.');
  }
  if (manualChars > MAX_CHARS)
    throw Error('Manual resolutions exceed 100,000 characters in total.');
  let unresolved = 0;
  const eol = result.markerEnding,
    close = (text) => (text && !/[\r\n]$/.test(text) ? text + eol : text);
  const output = result.segments
    .map((segment) => {
      if (segment.kind === 'text') return segment.text;
      const c = result.conflicts[segment.id],
        resolution = resolutions[c.id] || { choice: 'unresolved' };
      if (resolution.choice === 'manual') return resolution.text;
      if (resolution.choice !== 'unresolved') return c[resolution.choice];
      unresolved++;
      return `<<<<<<< OURS${eol}${close(c.ours)}||||||| BASE${eol}${close(c.base)}=======${eol}${close(c.theirs)}>>>>>>> THEIRS${eol}`;
    })
    .join('');
  return { text: output, unresolved, resolved: result.conflicts.length - unresolved };
}
export function validateSession(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, 'sources') ||
    !Object.hasOwn(input, 'resolutions')
  )
    throw Error('Session needs sources and resolutions only.');
  const result = merge(input.sources);
  resolve(result, input.resolutions);
  return { result, resolutions: structuredClone(input.resolutions) };
}
export const EXAMPLES = {
  independent: {
    base: 'name: evening-service\nport: 3000\nlogging: basic\ncache: off\n',
    ours: 'name: evening-service\nport: 8080\nlogging: basic\ncache: off\n',
    theirs: 'name: evening-service\nport: 3000\nlogging: basic\ncache: on\n',
  },
  conflict: {
    base: 'title: Release notes\nstatus: draft\nowner: platform\n',
    ours: 'title: Release notes\nstatus: ready\nowner: platform\n',
    theirs: 'title: Release notes\nstatus: review\nowner: platform\n',
  },
  insertion: {
    base: 'Shopping list\nTea\nBread\n',
    ours: 'Shopping list\nCoffee\nTea\nBread\n',
    theirs: 'Shopping list\nFruit\nTea\nBread\n',
  },
};
