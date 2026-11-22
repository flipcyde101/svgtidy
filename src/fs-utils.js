import fs from 'node:fs';
import path from 'node:path';

export function collectSvgFiles(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${fileOrDir}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return [resolved];
  }

  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        results.push(full);
      }
    }
  }
  walk(resolved);
  return results;
}

export function stemPrefix(filePath) {
  const base = path.basename(filePath || 'svg', path.extname(filePath || ''));
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = clean ? (/^[a-z_]/.test(clean) ? clean : `svg-${clean}`) : 'svg';
  return `${safe}-`;
}

export function toPascalCase(raw) {
  const base = String(raw || 'SvgIcon')
    .replace(/\.svg$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  if (!base) return 'SvgIcon';
  const parts = base.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const joined = parts.join('');
  return /^[A-Za-z_$]/.test(joined) ? joined : `Svg${joined}`;
}
