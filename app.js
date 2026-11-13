import { EXAMPLES, editedText, endingStyle, lines, resolve } from './core.js';
const $ = (id) => document.getElementById(id);
let sources = structuredClone(EXAMPLES.independent),
  result = null,
  resolutions = {},
  worker = null,
  revision = 0;
const editors = {};
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function status(text) {
  $('status').textContent = text;
}
function beginImport() {
  worker?.terminate();
  worker = null;
  $('merge').disabled = false;
  return ++revision;
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  result = null;
  resolutions = {};
  $('results').hidden = true;
  $('merge').disabled = false;
  $('save-session').disabled = true;
  status('Sources changed. Compare to update.');
}
function sync() {
  for (const key of ['base', 'ours', 'theirs']) {
    editors[key].input.value = sources[key];
    metadata(key);
  }
}
function metadata(key) {
  const text = sources[key];
  editors[key].numbers.textContent = Array.from(
    { length: editors[key].input.value.split('\n').length },
    (_, i) => i + 1,
  ).join('\n');
  editors[key].meta.textContent =
    `${text.length.toLocaleString()} chars · ${endingStyle(text)}${text && !/[\r\n]$/.test(text) ? ' · no final newline' : ''}${endingStyle(text) === 'mixed' ? ' · editing normalizes to LF' : ''}`;
}
for (const key of ['base', 'ours', 'theirs']) {
  const section = node('div', undefined, 'source'),
    top = node('div', undefined, 'source-top'),
    title = node('label', key === 'base' ? 'Base' : key === 'ours' ? 'Ours' : 'Theirs');
  title.htmlFor = key;
  const upload = node('label', 'Load text', 'import'),
    file = node('input');
  file.type = 'file';
  file.id = `file-${key}`;
  file.setAttribute('aria-label', `Load ${key} text`);
  upload.append(file);
  top.append(title, upload);
  const input = node('textarea');
  input.id = key;
  input.spellcheck = false;
  input.maxLength = 100000;
  const meta = node('p', undefined, 'meta');
  const numbers = node('pre', '', 'line-numbers'),
    code = node('div', undefined, 'code-editor');
  numbers.setAttribute('aria-hidden', 'true');
  input.wrap = 'off';
  code.append(numbers, input);
  section.dataset.source = key;
  section.dataset.active = key === 'base';
  input.addEventListener('scroll', () => {
    numbers.scrollTop = input.scrollTop;
  });
  editors[key] = { input, meta, numbers };
  input.addEventListener('input', () => {
    sources[key] = editedText(sources[key], input.value);
    invalidate();
    metadata(key);
  });
  file.addEventListener('change', async () => {
    const selected = file.files[0];
    if (!selected) return;
    const ticket = beginImport();
    try {
      if (selected.size > 400000) throw Error('Text files must be at most 400 KB.');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        await selected.arrayBuffer(),
      );
      lines(text);
      if (ticket !== revision) return;
      sources[key] = text;
      invalidate();
      sync();
    } catch (e) {
      if (ticket === revision) status(e.message);
    } finally {
      file.value = '';
    }
  });
  section.append(top, code, meta);
  $('sources').append(section);
}
function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = node('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function output() {
  try {
    const merged = resolve(result, resolutions);
    $('output').textContent = merged.text || '(empty document)';
    $('remaining').textContent = merged.unresolved
      ? `${merged.unresolved} unresolved · markers included`
      : 'All changes resolved';
    $('save').textContent = merged.unresolved ? 'Download with markers ↓' : 'Download text ↓';
    $('remaining').dataset.unresolved = merged.unresolved > 0;
    $('save').disabled = false;
    $('save-session').disabled = false;
  } catch (e) {
    status(e.message);
    $('save').disabled = true;
    $('save-session').disabled = true;
  }
}
function diffView() {
  if (!result) return;
  const fragment = document.createDocumentFragment();
  for (const op of result.diffs[$('side').value].operations) {
    const row = node('div', undefined, `diff-row ${op.type}`);
    row.append(
      node('span', op.oldLine ?? '', 'gutter'),
      node('span', op.newLine ?? '', 'gutter'),
      node('span', op.type === 'insert' ? '+' : op.type === 'delete' ? '−' : ' '),
      node('span', op.text.replace(/[\r\n]+$/, '')),
      node('span', endingStyle(op.text) === 'none' ? '∅ EOL' : endingStyle(op.text), 'ending'),
    );
    fragment.append(row);
  }
  $('diff').replaceChildren(fragment);
}
function render() {
  const fragment = document.createDocumentFragment();
  for (const c of result.conflicts) {
    const card = node('article', undefined, 'conflict');
    card.append(
      node(
        'h3',
        `Conflict ${c.id + 1} · base ${c.start === c.end ? `insertion at line ${c.start + 1}` : `lines ${c.start + 1}–${c.end}`}`,
      ),
    );
    const columns = node('div', undefined, 'columns');
    for (const key of ['base', 'ours', 'theirs']) {
      const part = node('div');
      part.append(node('h3', key), node('pre', c[key] || '(empty)'));
      columns.append(part);
    }
    const label = node('label', 'Resolution '),
      select = node('select');
    select.setAttribute('aria-label', `Resolve conflict ${c.id + 1}`);
    for (const choice of ['unresolved', 'ours', 'theirs', 'base', 'manual']) {
      const option = node(
        'option',
        choice === 'unresolved'
          ? 'Leave unresolved'
          : choice === 'manual'
            ? 'Write a resolution'
            : `Keep ${choice}`,
      );
      option.value = choice;
      select.append(option);
    }
    select.value = resolutions[c.id]?.choice || 'unresolved';
    label.append(select);
    const manual = node('textarea');
    manual.setAttribute('aria-label', `Manual resolution ${c.id + 1}`);
    manual.maxLength = 100000;
    manual.value = resolutions[c.id]?.text ?? c.ours;
    manual.hidden = select.value !== 'manual';
    let rawManual = resolutions[c.id]?.text ?? c.ours;
    select.addEventListener('change', () => {
      resolutions[c.id] =
        select.value === 'manual'
          ? { choice: 'manual', text: rawManual }
          : { choice: select.value };
      manual.hidden = select.value !== 'manual';
      output();
    });
    manual.addEventListener('input', () => {
      rawManual = editedText(rawManual, manual.value);
      resolutions[c.id] = { choice: 'manual', text: rawManual };
      output();
    });
    card.append(columns, label, manual);
    card.dataset.resolved = select.value !== 'unresolved';
    select.addEventListener(
      'change',
      () => (card.dataset.resolved = select.value !== 'unresolved'),
    );
    fragment.append(card);
  }
  if (!result.conflicts.length) {
    const empty = node('div', undefined, 'empty-conflicts');
    empty.append(node('span', '✓'), node('p', 'No conflicts'));
    fragment.append(empty);
  }
  $('conflicts').replaceChildren(fragment);
  $('stats').textContent =
    `${result.automaticGroups} automatic groups · ${result.conflicts.length} conflicts`;
  $('results').hidden = false;
  output();
  diffView();
}
function compute(session = { sources, resolutions: {} }, imported = false) {
  worker?.terminate();
  const ticket = ++revision;
  const current = new Worker('./worker.js', { type: 'module' });
  worker = current;
  $('merge').disabled = true;
  status('Comparing line changes…');
  current.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    current.terminate();
    worker = null;
    $('merge').disabled = false;
    if (data.error) {
      status(data.error);
      return;
    }
    result = data.result;
    resolutions = data.resolutions;
    if (imported) {
      sources = { ...result.sources };
      sync();
    }
    render();
    status(`Compared in ${data.milliseconds.toFixed(1)} ms`);
  };
  current.onerror = () => {
    if (ticket !== revision) return;
    current.terminate();
    worker = null;
    $('merge').disabled = false;
    status('The comparison worker failed. Try comparing again.');
  };
  current.postMessage(session);
}
$('merge').addEventListener('click', () => compute());
$('example').addEventListener('change', () => {
  invalidate();
  sources = structuredClone(EXAMPLES[$('example').value]);
  sync();
  compute();
});
$('side').addEventListener('change', diffView);
$('save').addEventListener('click', () => {
  const merged = resolve(result, resolutions);
  download(merged.unresolved ? 'merged.conflicted.txt' : 'merged.txt', merged.text);
});
$('save-session').addEventListener('click', () =>
  download(
    'merge-session.json',
    JSON.stringify({ sources: result.sources, resolutions }, null, 2),
    'application/json',
  ),
);
$('session').addEventListener('change', async () => {
  const file = $('session').files[0];
  if (!file) return;
  const ticket = beginImport();
  try {
    if (file.size > 2000000) throw Error('Sessions must be at most 2 MB.');
    const candidate = JSON.parse(await file.text());
    if (ticket === revision) compute(candidate, true);
  } catch (e) {
    if (ticket === revision) status(`Session not loaded: ${e.message}`);
  } finally {
    $('session').value = '';
  }
});
for (const b of document.querySelectorAll('[data-source]'))
  b.onclick = () => {
    for (const t of document.querySelectorAll('.source-tabs button'))
      t.setAttribute('aria-pressed', t === b);
    for (const s of document.querySelectorAll('.source'))
      s.dataset.active = s.dataset.source === b.dataset.source;
  };
function outputView(changes) {
  for (const [name, active] of [
    ['merged', !changes],
    ['changes', changes],
  ]) {
    $(name + '-pane').hidden = !active;
    $(name + '-tab').setAttribute('aria-selected', active);
    $(name + '-tab').tabIndex = active ? 0 : -1;
  }
}
$('merged-tab').onclick = () => outputView(false);
$('changes-tab').onclick = () => outputView(true);
for (const id of ['merged-tab', 'changes-tab'])
  $(id).onkeydown = (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const changes = e.key === 'End' || (e.key !== 'Home' && id === 'merged-tab');
      outputView(changes);
      $(changes ? 'changes-tab' : 'merged-tab').focus();
    }
  };
sync();
compute();
