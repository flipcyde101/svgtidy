import fs from 'node:fs';
import { collectSvgFiles } from './fs-utils.js';

export function auditSvgContent(svg, filePath = 'inline.svg') {
  const issues = [];
  const raw = String(svg ?? '');
  const uncommented = raw.replace(/<!--[\s\S]*?-->/g, '');

  const svgTagMatch = uncommented.match(/<svg\b[^>]*>/i);
  if (!svgTagMatch) {
    issues.push({
      code: 'invalid-svg',
      severity: 'error',
      message: 'No root <svg> element found'
    });
    return { file: filePath, ok: false, issues };
  }

  const svgOpenTag = svgTagMatch[0];
  const hasViewBox = /\bviewBox\s*=\s*(?:"[^"]*"|'[^']*')/i.test(svgOpenTag);
  const hasWidth = /\bwidth\s*=\s*(?:"[^"]*"|'[^']*')/i.test(svgOpenTag);
  const hasHeight = /\bheight\s*=\s*(?:"[^"]*"|'[^']*')/i.test(svgOpenTag);

  if (!hasViewBox) {
    issues.push({
      code: 'missing-viewbox',
      severity: 'error',
      message: 'Root <svg> is missing a viewBox attribute'
    });
    if (hasWidth || hasHeight) {
      issues.push({
        code: 'hardcoded-dimensions-no-viewbox',
        severity: 'error',
        message: 'Root <svg> defines hardcoded width/height without a viewBox'
      });
    }
  }

  // Duplicate ID collisions
  const idCounts = new Map();
  const idRegex = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/g;
  let match;
  while ((match = idRegex.exec(uncommented)) !== null) {
    const idVal = match[1] ?? match[2];
    idCounts.set(idVal, (idCounts.get(idVal) || 0) + 1);
  }
  const duplicates = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicates.length > 0) {
    issues.push({
      code: 'duplicate-id',
      severity: 'error',
      message: `Duplicate id attribute collision(s): ${duplicates.join(', ')}`,
      duplicates
    });
  }

  // Inline <script> and event-handler XSS hazards
  const xssFindings = [];
  if (/<script\b/i.test(uncommented)) {
    xssFindings.push('<script> element');
  }
  const handlerRegex = /\s(on[a-zA-Z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;
  const handlers = new Set();
  while ((match = handlerRegex.exec(uncommented)) !== null) {
    handlers.add(match[1].toLowerCase());
  }
  for (const h of handlers) {
    xssFindings.push(`${h}= event handler`);
  }
  if (/\b(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript:|data:text\/html)|'\s*(?:javascript:|data:text\/html))/i.test(uncommented)) {
    xssFindings.push('executable href URI');
  }
  if (xssFindings.length > 0) {
    issues.push({
      code: 'xss-hazard',
      severity: 'error',
      message: `Inline XSS hazard(s) detected: ${xssFindings.join(', ')}`,
      hazards: xssFindings
    });
  }

  // Hardcoded hex strokes/fills vs currentColor
  const hexSet = new Set();
  const attrColorRegex = /\b(?:fill|stroke)\s*=\s*(?:"(#[0-9a-fA-F]{3,8})"|'(#[0-9a-fA-F]{3,8})')/g;
  while ((match = attrColorRegex.exec(uncommented)) !== null) {
    hexSet.add((match[1] || match[2]).toLowerCase());
  }
  const styleRegex = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((match = styleRegex.exec(uncommented)) !== null) {
    const styleBody = match[1] ?? match[2];
    const propRegex = /\b(?:fill|stroke)\s*:\s*(#[0-9a-fA-F]{3,8})/gi;
    let pm;
    while ((pm = propRegex.exec(styleBody)) !== null) {
      hexSet.add(pm[1].toLowerCase());
    }
  }
  if (hexSet.size > 0) {
    const colors = [...hexSet];
    issues.push({
      code: 'hardcoded-hex-color',
      severity: 'warning',
      message: `Hardcoded hex fill/stroke (${colors.join(', ')}) instead of currentColor`,
      colors
    });
  }

  // XML / editor metadata bloat
  const bloatMarkers = [];
  if (/<\?xml\b/i.test(raw)) bloatMarkers.push('xml-prolog');
  if (/<!DOCTYPE\b/i.test(raw)) bloatMarkers.push('doctype');
  if (/<!--[\s\S]*?-->/.test(raw)) bloatMarkers.push('xml-comments');
  if (/<metadata\b/i.test(uncommented)) bloatMarkers.push('<metadata>');
  if (/\binkscape:|\bxmlns:inkscape\b/i.test(uncommented)) bloatMarkers.push('inkscape-metadata');
  if (/\bsodipodi:|\bxmlns:sodipodi\b/i.test(uncommented)) bloatMarkers.push('sodipodi-metadata');
  if (bloatMarkers.length > 0) {
    issues.push({
      code: 'editor-metadata-bloat',
      severity: 'info',
      message: `XML/editor metadata bloat present (${bloatMarkers.join(', ')})`,
      markers: bloatMarkers
    });
  }

  const hasError = issues.some((i) => i.severity === 'error');
  return {
    file: filePath,
    ok: !hasError,
    issues
  };
}

export function auditPath(fileOrDir) {
  const svgFiles = collectSvgFiles(fileOrDir);
  const files = svgFiles.map((fp) => auditSvgContent(fs.readFileSync(fp, 'utf8'), fp));

  const issueCounts = { error: 0, warning: 0, info: 0, total: 0 };
  let filesWithIssues = 0;
  for (const item of files) {
    if (item.issues.length > 0) filesWithIssues++;
    for (const iss of item.issues) {
      issueCounts[iss.severity] = (issueCounts[iss.severity] || 0) + 1;
      issueCounts.total++;
    }
  }

  return {
    ok: issueCounts.error === 0,
    totalFiles: files.length,
    filesWithIssues,
    issueCounts,
    files
  };
}
