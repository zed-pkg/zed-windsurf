'use strict';

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#') return line.slice(0, index);
  }
  return line;
}

function collectionBalance(input) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') depth += 1;
    else if (character === ']' || character === '}') depth -= 1;
  }
  return depth;
}

function findUnquoted(input, target) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{' || character === '(') depth += 1;
    else if (character === ']' || character === '}' || character === ')') depth = Math.max(0, depth - 1);
    else if (character === target && depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(input, delimiter = ',') {
  const values = [];
  let quote = null;
  let escaped = false;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{' || character === '(') depth += 1;
    else if (character === ']' || character === '}' || character === ')') depth = Math.max(0, depth - 1);
    else if (character === delimiter && depth === 0) {
      values.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(input.slice(start).trim());
  return values.filter((value) => value.length > 0);
}

function unquote(input) {
  const value = input.trim();
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) return value;
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;
  try {
    return JSON.parse(value);
  } catch {
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function splitDottedKey(input) {
  const parts = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '.') {
      parts.push(unquote(input.slice(start, index).trim()));
      start = index + 1;
    }
  }
  parts.push(unquote(input.slice(start).trim()));
  return parts.filter(Boolean);
}

function parseValue(input) {
  const value = input.trim();
  if (value === '') return '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquote(value);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return Number.parseFloat(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitTopLevel(value.slice(1, -1)).map(parseValue);
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    const object = {};
    for (const entry of splitTopLevel(value.slice(1, -1))) {
      const separator = findUnquoted(entry, '=');
      if (separator < 1) continue;
      const keyPath = splitDottedKey(entry.slice(0, separator));
      setNested(object, keyPath, parseValue(entry.slice(separator + 1)));
    }
    return object;
  }
  return value;
}

function ensureObject(root, path) {
  let current = root;
  for (const key of path) {
    if (!Object.prototype.hasOwnProperty.call(current, key) || current[key] === null || typeof current[key] !== 'object' || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }
  return current;
}

function setNested(root, path, value) {
  if (path.length === 0) return;
  const parent = ensureObject(root, path.slice(0, -1));
  parent[path[path.length - 1]] = value;
}

function getNested(root, path) {
  let current = root;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function parseToml(text) {
  const data = {};
  const assignments = [];
  const errors = [];
  let sectionPath = [];
  let container = data;
  let arrayIndex = null;
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const source = lines[lineIndex];
    const cleaned = stripComment(source).trim();
    if (!cleaned) continue;

    if (cleaned.startsWith('[[') && cleaned.endsWith(']]')) {
      const path = splitDottedKey(cleaned.slice(2, -2).trim());
      if (path.length === 0) {
        errors.push({ line: lineIndex, message: 'Empty array-table header.' });
        continue;
      }
      const parent = ensureObject(data, path.slice(0, -1));
      const key = path[path.length - 1];
      if (!Array.isArray(parent[key])) parent[key] = [];
      const item = {};
      parent[key].push(item);
      sectionPath = path;
      container = item;
      arrayIndex = parent[key].length - 1;
      continue;
    }

    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      const path = splitDottedKey(cleaned.slice(1, -1).trim());
      if (path.length === 0) {
        errors.push({ line: lineIndex, message: 'Empty table header.' });
        continue;
      }
      sectionPath = path;
      container = ensureObject(data, path);
      arrayIndex = null;
      continue;
    }

    const separator = findUnquoted(cleaned, '=');
    if (separator < 1) {
      errors.push({ line: lineIndex, message: 'Expected a key/value assignment.' });
      continue;
    }

    const keyPath = splitDottedKey(cleaned.slice(0, separator));
    if (keyPath.length === 0) {
      errors.push({ line: lineIndex, message: 'Expected a key before =.' });
      continue;
    }

    const assignmentLine = lineIndex;
    let rawValue = cleaned.slice(separator + 1).trim();
    let balance = collectionBalance(rawValue);
    while (balance > 0 && lineIndex + 1 < lines.length) {
      lineIndex += 1;
      const continuation = stripComment(lines[lineIndex]).trim();
      if (continuation) rawValue += `\n${continuation}`;
      balance = collectionBalance(rawValue);
    }
    if (balance > 0) {
      errors.push({ line: assignmentLine, message: 'Unterminated array or inline table value.' });
      continue;
    }

    try {
      const value = parseValue(rawValue);
      setNested(container, keyPath, value);
      assignments.push({
        sectionPath: [...sectionPath],
        keyPath,
        fullPath: [...sectionPath, ...keyPath],
        line: assignmentLine,
        raw: rawValue,
        value,
        arrayIndex
      });
    } catch (error) {
      errors.push({ line: assignmentLine, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { data, assignments, errors, lines };
}

function dependencyRequirement(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return '*';
  for (const key of ['version', 'requirement', 'req', 'tag', 'rev', 'branch', 'path', 'git']) {
    if (typeof value[key] === 'string' || typeof value[key] === 'number') return String(value[key]);
  }
  return '*';
}

function dependencyKind(section) {
  const lower = section.toLowerCase();
  if (lower.includes('dev-depend')) return 'dev';
  if (lower.includes('build-depend')) return 'build';
  if (lower.includes('peer-depend')) return 'peer';
  if (lower.includes('optional-depend')) return 'optional';
  return 'runtime';
}

function extractManifest(parsed) {
  const packageTable = parsed.data.package && !Array.isArray(parsed.data.package) ? parsed.data.package : {};
  const dependencies = [];

  for (const assignment of parsed.assignments) {
    const section = assignment.sectionPath.join('.');
    const normalized = section.toLowerCase();
    const isDependencySection = normalized === 'dependencies'
      || normalized.endsWith('.dependencies')
      || normalized.endsWith('dev-dependencies')
      || normalized.endsWith('build-dependencies')
      || normalized.endsWith('peer-dependencies')
      || normalized.endsWith('optional-dependencies');
    if (!isDependencySection) continue;
    const name = assignment.keyPath.join('.');
    dependencies.push({
      name,
      requirement: dependencyRequirement(assignment.value),
      kind: dependencyKind(normalized),
      line: assignment.line,
      value: assignment.value
    });
  }

  return {
    package: {
      org: typeof packageTable.org === 'string' ? packageTable.org : null,
      name: typeof packageTable.name === 'string' ? packageTable.name : null,
      version: typeof packageTable.version === 'string' || typeof packageTable.version === 'number' ? String(packageTable.version) : null,
      description: typeof packageTable.description === 'string' ? packageTable.description : null,
      language: typeof packageTable.language === 'string' ? packageTable.language : null,
      repository: packageTable.repository && typeof packageTable.repository === 'object' ? packageTable.repository : null
    },
    dependencies,
    generatedConsumer: parsed.lines.some((line) => line.includes('zed-generated-consumer')),
    raw: parsed.data
  };
}

function addLockEntry(entries, value, fallbackName = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const org = typeof value.org === 'string' ? value.org : null;
  const rawName = typeof value.name === 'string'
    ? value.name
    : typeof value.package === 'string'
      ? value.package
      : fallbackName;
  const name = org && rawName && !rawName.includes('/') ? `${org}/${rawName}` : rawName;
  const version = value.version === undefined || value.version === null ? null : String(value.version);
  if (!name) return;
  entries.push({ name, version, raw: value });
}

function extractLock(parsed) {
  const entries = [];
  for (const key of ['package', 'packages', 'dependency', 'dependencies']) {
    const value = parsed.data[key];
    if (Array.isArray(value)) {
      for (const item of value) addLockEntry(entries, item);
    } else if (value && typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) addLockEntry(entries, item, name);
    }
  }
  const deduplicated = new Map();
  for (const entry of entries) deduplicated.set(`${entry.name}@${entry.version ?? ''}`, entry);
  return {
    formatVersion: parsed.data.version === undefined ? null : String(parsed.data.version),
    packages: [...deduplicated.values()],
    raw: parsed.data
  };
}

module.exports = {
  collectionBalance,
  dependencyRequirement,
  extractLock,
  extractManifest,
  findUnquoted,
  getNested,
  parseToml,
  parseValue,
  splitDottedKey,
  splitTopLevel,
  stripComment,
  unquote
};
