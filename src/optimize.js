import fs from 'node:fs';
import path from 'node:path';
import { collectSvgFiles, stemPrefix } from './fs-utils.js';

function normalizeHex(hex) {
  const clean = hex.trim().toLowerCase();
  if (clean.length === 4) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  }
  if (clean.length === 5) {
    return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}${clean[4]}${clean[4]}`;
  }
  return clean;
}

function isAchromaticGray(normHex) {
  const h = normHex.slice(1, 7);
  if (h.length !== 6) return false;
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return r === g && g === b;
}

function convertMonochromeHexToCurrentColor(svg) {
  const allColors = new Set();
  const attrRegex = /\b(?:fill|stroke)\s*=\s*(?:"(#[0-9a-fA-F]{3,8})"|'(#[0-9a-fA-F]{3,8})')/g;
  let match;
  while ((match = attrRegex.exec(svg)) !== null) {
    allColors.add(normalizeHex(match[1] || match[2]));
  }
  const styleRegex = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((match = styleRegex.exec(svg)) !== null) {
    const body = match[1] ?? match[2];
    const propRegex = /\b(?:fill|stroke)\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
    let pm;
    while ((pm = propRegex.exec(body)) !== null) {
      allColors.add(normalizeHex(pm[1]));
    }
  }

  if (allColors.size === 0) return svg;

  const nonWhite = new Set([...allColors].filter((c) => c !== '#ffffff' && c !== '#ffffffff'));
  const isMonochrome =
    nonWhite.size === 1 ||
    (nonWhite.size > 1 && [...nonWhite].every(isAchromaticGray)) ||
    (nonWhite.size === 0 && allColors.size > 0);

  if (!isMonochrome) return svg;

  const targets = nonWhite.size > 0 ? nonWhite : allColors;

  let out = svg.replace(
    /\b(fill|stroke)\s*=\s*(?:"(#[0-9a-fA-F]{3,8})"|'(#[0-9a-fA-F]{3,8})')/g,
    (full, prop, dq, sq) => {
      const norm = normalizeHex(dq || sq);
      return targets.has(norm) ? `${prop}="currentColor"` : full;
    }
  );

  out = out.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/g, (full, quoted, dq, sq) => {
    const quote = quoted[0];
    const body = dq ?? sq;
    const replaced = body.replace(
      /\b(fill|stroke)(\s*:\s*)(#[0-9a-fA-F]{3,8})/gi,
      (m, prop, sep, hex) => (targets.has(normalizeHex(hex)) ? `${prop}${sep}currentColor` : m)
    );
    return `style=${quote}${replaced}${quote}`;
  });

  return out;
}

function prefixInternalIds(svg, rawPrefix) {
  const cleanPrefix = String(rawPrefix || 'svg-').endsWith('-')
    ? String(rawPrefix)
    : `${rawPrefix}-`;

  const idMap = new Map();
  const declRegex = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  let match;
  while ((match = declRegex.exec(svg)) !== null) {
    const oldId = match[1] ?? match[2];
    if (!idMap.has(oldId)) {
      const newId = oldId.startsWith(cleanPrefix) ? oldId : `${cleanPrefix}${oldId}`;
      idMap.set(oldId, newId);
    }
  }

  if (idMap.size === 0) return svg;

  let out = svg.replace(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g, (full, dq, sq) => {
    const oldId = dq ?? sq;
    const mapped = idMap.get(oldId);
    return mapped ? `id="${mapped}"` : full;
  });

  out = out.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (full, quote, refId) => {
    const mapped = idMap.get(refId);
    return mapped ? `url(${quote}#${mapped}${quote})` : full;
  });

  out = out.replace(/\b((?:xlink:)?href)\s*=\s*(?:"#([^"]+)"|'#([^']+)')/g, (full, attr, dq, sq) => {
    const refId = dq ?? sq;
    const mapped = idMap.get(refId);
    return mapped ? `${attr}="#${mapped}"` : full;
  });

  out = out.replace(
    /\b(aria-labelledby|aria-describedby)\s*=\s*(?:"([^"]+)"|'([^']+)')/g,
    (full, attr, dq, sq) => {
      const val = dq ?? sq;
      const tokens = val.trim().split(/\s+/).map((t) => idMap.get(t) || t);
      return `${attr}="${tokens.join(' ')}"`;
    }
  );

  return out;
}

function normalizeRootViewBox(svg) {
  return svg.replace(/<svg\b[^>]*>/i, (openTag) => {
    const vbMatch = openTag.match(/\bviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (vbMatch) {
      const rawVb = (vbMatch[1] ?? vbMatch[2]).trim();
      const cleaned = rawVb
        .replace(/px\b/gi, '')
        .split(/[\s,]+/)
        .filter(Boolean)
        .join(' ');
      return openTag.replace(vbMatch[0], `viewBox="${cleaned}"`);
    }

    const wMatch = openTag.match(/\bwidth\s*=\s*(?:"\s*(\d+(?:\.\d+)?)(?:px)?\s*"|'\s*(\d+(?:\.\d+)?)(?:px)?\s*')/i);
    const hMatch = openTag.match(/\bheight\s*=\s*(?:"\s*(\d+(?:\.\d+)?)(?:px)?\s*"|'\s*(\d+(?:\.\d+)?)(?:px)?\s*')/i);
    if (wMatch && hMatch) {
      const w = wMatch[1] ?? wMatch[2];
      const h = hMatch[1] ?? hMatch[2];
      if (openTag.endsWith('/>')) {
        return `${openTag.slice(0, -2)} viewBox="0 0 ${w} ${h}"/>`;
      }
      return `${openTag.slice(0, -1)} viewBox="0 0 ${w} ${h}">`;
    }
    return openTag;
  });
}

function compactTagWhitespace(tag) {
  // Preserve quoted strings while collapsing whitespace outside quotes
  const parts = [];
  let inQuote = null;
  let buf = '';
  for (let i = 0; i < tag.length; i++) {
    const ch = tag[i];
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) {
        parts.push({ quoted: true, text: buf });
        buf = '';
        inQuote = null;
      }
    } else if (ch === '"' || ch === "'") {
      if (buf) parts.push({ quoted: false, text: buf });
      buf = ch;
      inQuote = ch;
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push({ quoted: false, text: buf });

  const joined = parts
    .map((p) => (p.quoted ? p.text : p.text.replace(/\s+/g, ' ')))
    .join('');

  return joined
    .replace(/\s+\/>$/, '/>')
    .replace(/\s+>$/, '>');
}

export function optimizeSvgContent(svg, {
  currentColor = false,
  prefixIds = false,
  idPrefix = 'svg-'
} = {}) {
  let out = String(svg ?? '').replace(/^\uFEFF/, '');

  // Strip XML prolog, DOCTYPE, and comments
  out = out.replace(/<\?xml\b[\s\S]*?\?>/gi, '');
  out = out.replace(/<!DOCTYPE[^>\[]*(?:\[[\s\S]*?\])?\s*>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  // Strip editor metadata elements
  out = out.replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/gi, '');
  out = out.replace(/<metadata\b[^>]*\/>/gi, '');
  out = out.replace(/<(?:sodipodi|inkscape):[a-zA-Z0-9_-]+\b[^>]*>[\s\S]*?<\/(?:sodipodi|inkscape):[a-zA-Z0-9_-]+>/gi, '');
  out = out.replace(/<(?:sodipodi|inkscape):[a-zA-Z0-9_-]+\b[^>]*\/>/gi, '');
  out = out.replace(/<rdf:RDF\b[^>]*>[\s\S]*?<\/rdf:RDF>/gi, '');

  // Strip editor namespaces and attributes
  out = out.replace(/\s+xmlns:(?:inkscape|sodipodi|dc|cc|rdf|svg)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  out = out.replace(/\s+(?:inkscape|sodipodi):[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  out = out.replace(/\s+xml:space\s*=\s*(?:"preserve"|'preserve')/gi, '');

  // Remove empty <defs>
  out = out.replace(/<defs\b[^>]*>\s*<\/defs>/gi, '');
  out = out.replace(/<defs\s*\/>/gi, '');

  // Normalize or synthesize viewBox
  out = normalizeRootViewBox(out);

  // Optional transformations
  if (currentColor) {
    out = convertMonochromeHexToCurrentColor(out);
  }
  if (prefixIds) {
    out = prefixInternalIds(out, idPrefix);
  }

  // Compact path data and polygon points whitespace
  out = out.replace(/\b(d|points)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (full, attr, dq, sq) => {
    const val = (dq ?? sq).trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',');
    return `${attr}="${val}"`;
  });

  // Compact opening/self-closing tags and collapse inter-tag whitespace
  out = out.replace(/<[a-zA-Z][^>]*>/g, compactTagWhitespace);
  out = out.replace(/>\s+</g, '><');

  return out.trim();
}

export function optimizePath(fileOrDir, {
  currentColor = false,
  prefixIds = false,
  idPrefix,
  inPlace = false,
  outDir
} = {}) {
  if (inPlace && outDir) {
    throw new Error('Cannot combine --in-place and --out-dir');
  }

  const rootResolved = path.resolve(fileOrDir);
  const rootIsDir = fs.statSync(rootResolved).isDirectory();
  const svgFiles = collectSvgFiles(rootResolved);

  const results = [];
  let totalOriginalBytes = 0;
  let totalOptimizedBytes = 0;

  for (const fp of svgFiles) {
    const original = fs.readFileSync(fp, 'utf8');
    const prefix = idPrefix || stemPrefix(fp);
    const optimized = optimizeSvgContent(original, {
      currentColor,
      prefixIds,
      idPrefix: prefix
    });

    const originalBytes = Buffer.byteLength(original, 'utf8');
    const optimizedBytes = Buffer.byteLength(optimized, 'utf8');
    const savedBytes = originalBytes - optimizedBytes;
    const savedPercent = originalBytes > 0
      ? Number(((savedBytes / originalBytes) * 100).toFixed(2))
      : 0;

    totalOriginalBytes += originalBytes;
    totalOptimizedBytes += optimizedBytes;

    let outputPath = null;
    if (inPlace) {
      outputPath = fp;
      fs.writeFileSync(fp, `${optimized}\n`, 'utf8');
    } else if (outDir) {
      const targetRoot = path.resolve(outDir);
      const rel = rootIsDir ? path.relative(rootResolved, fp) : path.basename(fp);
      outputPath = path.join(targetRoot, rel);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${optimized}\n`, 'utf8');
    }

    results.push({
      file: fp,
      outputPath,
      originalBytes,
      optimizedBytes,
      savedBytes,
      savedPercent,
      svg: optimized
    });
  }

  const totalSavedBytes = totalOriginalBytes - totalOptimizedBytes;
  const totalSavedPercent = totalOriginalBytes > 0
    ? Number(((totalSavedBytes / totalOriginalBytes) * 100).toFixed(2))
    : 0;

  return {
    ok: true,
    totalFiles: results.length,
    totalOriginalBytes,
    totalOptimizedBytes,
    totalSavedBytes,
    totalSavedPercent,
    files: results
  };
}
