// Lightweight source assembly only. The worker's real Bend checker owns validation.
const standaloneError = () => new Error(
  'Cannot match this fragment to its chapter context. Paste a standalone program with top-level import Base and a pure main instead.',
);

// Hide comments and quoted text without changing line/column offsets. In particular,
// declaration-looking text in a string must not become an assembly anchor.
function codeOnly(source) {
  let quote = '', escaped = false, comment = false;
  let result = '';
  for (const char of source) {
    if (comment) {
      result += char === '\n' ? '\n' : ' ';
      if (char === '\n') comment = false;
    } else if (quote) {
      result += char === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
    } else if (char === '#') {
      comment = true;
      result += ' ';
    } else if (char === '"' || char === "'") {
      quote = char;
      result += '_';
    } else {
      result += char;
    }
  }
  return result;
}

function dedent(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const widths = lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)[0].length);
  const width = widths.length ? Math.min(...widths) : 0;
  return lines.map((line) => line.slice(Math.min(width, /^[ \t]*/.exec(line)[0].length))).join('\n');
}

function segments(source) {
  const lines = source.split('\n');
  const masked = codeOnly(source).split('\n');
  const starts = [];
  for (let i = 0; i < masked.length; i++) {
    const match = /^(def|type|law)\s+([A-Za-z_][\w.?]*)\b/.exec(masked[i]);
    if (!match) continue;
    let start = i;
    // Decorators belong to the following declaration, including unsafe ones:
    // assembly must retain them so the compiler can reject them.
    while (start > 0 && (!lines[start - 1].trim() || /^\s*#/.test(lines[start - 1]) || /^@/.test(masked[start - 1]))) start--;
    starts.push({ start, header: i, key: `${match[1]}:${match[2]}` });
  }
  const declarations = starts.map((entry, index) => ({
    ...entry,
    end: starts[index + 1]?.start ?? lines.length,
    text: lines.slice(entry.start, starts[index + 1]?.start ?? lines.length).join('\n').trimEnd(),
  }));
  const keys = declarations.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) throw standaloneError();
  return { lines, masked, declarations, prefix: lines.slice(0, starts[0]?.start ?? lines.length).join('\n') };
}

const hasBase = (source) => /^import[ \t]+Base[ \t]*$/m.test(codeOnly(source));
const onlyTrivia = (source) => source.split('\n').every((line) => !line.trim() || /^\s*#/.test(line));
const join = (prefix, declarations) => [prefix.trimEnd(), ...declarations.map(({ text }) => text)]
  .filter((text) => text.trim()).join('\n\n') + '\n';

function merge(edited, starter, chapter, filename) {
  if (!onlyTrivia(edited.prefix) || !onlyTrivia(starter.prefix)) throw standaloneError();
  const contextKeys = new Set(chapter.declarations.map(({ key }) => key));
  const starterKeys = new Set(starter.declarations.map(({ key }) => key));
  // A tutorial may show an alternative main rather than the chapter's exact main.
  if ([...starterKeys].some((key) => key !== 'def:main' && !contextKeys.has(key))) throw standaloneError();
  const replacements = [...edited.declarations];
  if (filename === '07-effects.bend' && starterKeys.size === 1 && starterKeys.has('def:add_strs') &&
      replacements.some(({ key }) => key === 'def:add_strs') &&
      !replacements.some(({ key }) => key === 'def:main')) {
    replacements.push({ key: 'def:main', text: 'def main() -> Maybe<&2, U32>:\n  add_strs("40", "2")' });
  }
  const replacementKeys = new Set(replacements.map(({ key }) => key));
  const anchors = replacements.filter(({ key }) => contextKeys.has(key));
  const anchorKeys = new Set(anchors.map(({ key }) => key));
  const groups = [];
  let pending = [];
  for (const declaration of replacements) {
    pending.push(declaration);
    if (anchorKeys.has(declaration.key)) { groups.push(pending); pending = []; }
  }
  const result = [];
  let slot = 0, inserted = false;
  for (const declaration of chapter.declarations) {
    if (anchorKeys.has(declaration.key)) {
      // Keep untouched context between slots (e.g. add_strs before main), but
      // preserve the user's declaration order and helpers preceding each anchor.
      result.push(...groups[slot++]);
      inserted = true;
      if (slot === groups.length) { result.push(...pending); pending = []; }
    } else if (starterKeys.has(declaration.key)) {
      // A renamed/deleted declaration replaces the old one, not an extra copy.
      if (!anchors.length && !inserted) { result.push(...pending); pending = []; inserted = true; }
    } else if (!replacementKeys.has(declaration.key)) {
      result.push(declaration);
    }
  }
  if (!inserted) {
    // A hypothetical main is allowed even when the context has no main yet.
    const index = result.findIndex(({ key }) => key === 'def:main');
    result.splice(index < 0 ? result.length : index, 0, ...pending);
  }
  const prefix = hasBase(chapter.prefix) ? chapter.prefix : `import Base\n${chapter.prefix}`;
  return join(prefix, result);
}

function replaceStatement(editedSource, starterSource, chapterSource, chapter) {
  const needle = dedent(starterSource);
  if (!needle || segments(dedent(editedSource)).declarations.length) throw standaloneError();
  const count = needle.split('\n').length;
  const matches = [];
  for (const declaration of chapter.declarations) {
    if (!declaration.key.startsWith('def:')) continue;
    for (let i = declaration.header + 1; i + count <= declaration.end; i++) {
      if (!/^[ \t]+\S/.test(chapter.masked[i])) continue;
      const candidate = chapter.lines.slice(i, i + count).join('\n');
      if (dedent(candidate) === needle) matches.push({ start: i, indent: /^[ \t]*/.exec(chapter.lines[i])[0] });
    }
  }
  if (matches.length !== 1) throw standaloneError();
  const { start, indent } = matches[0];
  const replacement = dedent(editedSource).split('\n').map((line) => line ? indent + line : '');
  const lines = [...chapter.lines];
  lines.splice(start, count, ...replacement);
  const source = lines.join('\n');
  return hasBase(chapterSource) ? source : `import Base\n\n${source}`;
}

/** Assemble one edited Markdown fence with its already-pure starter and chapter.
 * No compiler, evaluation, IO adaptation, or worker size-policy changes occur here.
 */
export function buildProgram(editedSnippet, starterSnippet, chapterProgram, filename = '') {
  if ([editedSnippet, starterSnippet, chapterProgram, filename].some((value) => typeof value !== 'string')) {
    throw new TypeError('buildProgram expects source strings and an optional filename string.');
  }
  // Explicit standalone source is authoritative, even if it fails worker checks.
  if (hasBase(editedSnippet)) return editedSnippet;
  const edited = segments(dedent(editedSnippet));
  const starter = segments(dedent(starterSnippet));
  const chapter = segments(dedent(chapterProgram));
  if (!chapter.declarations.length || !editedSnippet.trim()) throw standaloneError();
  if (starter.declarations.length) {
    if (!edited.declarations.length) throw standaloneError();
    return merge(edited, starter, chapter, filename);
  }
  return replaceStatement(editedSnippet, starterSnippet, chapterProgram, chapter);
}
