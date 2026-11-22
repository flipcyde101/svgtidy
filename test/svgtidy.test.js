import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN_PATH = path.join(REPO_ROOT, 'bin', 'svgtidy.js');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'svgtidy-test-'));
}

test('CLI --help and --version output expected info', () => {
  const helpOut = execFileSync(process.execPath, [BIN_PATH, '--help'], { encoding: 'utf8' });
  assert.match(helpOut, /svgtidy audit <fileOrDir>/);
  assert.match(helpOut, /svgtidy optimize <fileOrDir>/);
  assert.match(helpOut, /svgtidy component <svgFile>/);

  const verOut = execFileSync(process.execPath, [BIN_PATH, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(verOut, '0.1.0');
});

test('audit detects missing viewBox, hardcoded dimensions, duplicate IDs, XSS, hex colors, and metadata bloat', () => {
  const dir = makeTempDir();
  try {
    const hazardSvg = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Exported by Inkscape -->
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="32" height="32" onload="alert(1)">
  <metadata><rdf:RDF>bloat</rdf:RDF></metadata>
  <sodipodi:namedview inkscape:zoom="2.0" />
  <script>window.__pwned = true;</script>
  <g id="dup">
    <path id="dup" d="M 0 0 L 16 16" fill="#1e293b" stroke="#1e293b" onclick="evil()" />
    <a href="javascript:alert(2)"><rect width="10" height="10" /></a>
  </g>
</svg>`;

    const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16" stroke="currentColor"/></svg>`;

    fs.writeFileSync(path.join(dir, 'hazard.svg'), hazardSvg, 'utf8');
    fs.writeFileSync(path.join(dir, 'clean.svg'), cleanSvg, 'utf8');

    const raw = execFileSync(process.execPath, [BIN_PATH, 'audit', dir, '--json'], { encoding: 'utf8' });
    const report = JSON.parse(raw);

    assert.equal(report.totalFiles, 2);
    assert.equal(report.ok, false);
    assert.equal(report.filesWithIssues, 1);

    const cleanRes = report.files.find((f) => f.file.endsWith('clean.svg'));
    assert.equal(cleanRes.ok, true);
    assert.equal(cleanRes.issues.length, 0);

    const hazardRes = report.files.find((f) => f.file.endsWith('hazard.svg'));
    assert.equal(hazardRes.ok, false);
    const codes = new Set(hazardRes.issues.map((i) => i.code));
    assert.equal(codes.has('missing-viewbox'), true);
    assert.equal(codes.has('hardcoded-dimensions-no-viewbox'), true);
    assert.equal(codes.has('duplicate-id'), true);
    assert.equal(codes.has('xss-hazard'), true);
    assert.equal(codes.has('hardcoded-hex-color'), true);
    assert.equal(codes.has('editor-metadata-bloat'), true);

    const dupIssue = hazardRes.issues.find((i) => i.code === 'duplicate-id');
    assert.deepEqual(dupIssue.duplicates, ['dup']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('optimize strips editor bloat, normalizes viewBox, converts monochrome hex to currentColor, prefixes IDs + url(#...), and reports byte savings', () => {
  const dir = makeTempDir();
  try {
    const bloatedIcon = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- Generator: Inkscape 1.3 -->
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="24px"
     height="24px"
     inkscape:version="1.3">
  <sodipodi:namedview id="namedview1" inkscape:current-layer="layer1" />
  <metadata>Some big editor metadata payload that wastes bytes</metadata>
  <defs>
    <clipPath id="clip-main">
      <rect x="0" y="0" width="24" height="24" />
    </clipPath>
  </defs>
  <g inkscape:label="Layer 1" clip-path="url(#clip-main)">
    <path id="arrow" d="M 4   12   L 20   12   M 14  6 L 20 12 L 14 18" fill="none" stroke="#0f172a" stroke-width="2" />
    <use href="#arrow" />
  </g>
</svg>`;

    const multiColorLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0, 0, 32, 32">
      <rect width="16" height="16" fill="#ef4444" />
      <circle cx="24" cy="24" r="8" fill="#22c55e" />
    </svg>`;

    const srcDir = path.join(dir, 'src');
    const outDir = path.join(dir, 'out');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'arrow-right.svg'), bloatedIcon, 'utf8');
    fs.writeFileSync(path.join(srcDir, 'brand-logo.svg'), multiColorLogo, 'utf8');

    const raw = execFileSync(
      process.execPath,
      [BIN_PATH, 'optimize', srcDir, '--current-color', '--prefix-ids', '--out-dir', outDir, '--json'],
      { encoding: 'utf8' }
    );
    const report = JSON.parse(raw);

    assert.equal(report.ok, true);
    assert.equal(report.totalFiles, 2);
    assert.ok(report.totalSavedBytes > 300, `Expected significant byte savings, got ${report.totalSavedBytes}`);
    assert.ok(report.totalSavedPercent > 30);

    const optIcon = fs.readFileSync(path.join(outDir, 'arrow-right.svg'), 'utf8');
    assert.equal(optIcon.includes('<?xml'), false);
    assert.equal(optIcon.includes('<!DOCTYPE'), false);
    assert.equal(optIcon.includes('<!--'), false);
    assert.equal(optIcon.includes('inkscape:'), false);
    assert.equal(optIcon.includes('sodipodi:'), false);
    assert.equal(optIcon.includes('<metadata'), false);
    assert.match(optIcon, /viewBox="0 0 24 24"/);
    assert.match(optIcon, /stroke="currentColor"/);
    assert.equal(optIcon.includes('#0f172a'), false);
    assert.match(optIcon, /id="arrow-right-clip-main"/);
    assert.match(optIcon, /clip-path="url\(#arrow-right-clip-main\)"/);
    assert.match(optIcon, /id="arrow-right-arrow"/);
    assert.match(optIcon, /href="#arrow-right-arrow"/);

    // Multi-color SVG keeps its distinct brand colors while normalizing viewBox
    const optLogo = fs.readFileSync(path.join(outDir, 'brand-logo.svg'), 'utf8');
    assert.match(optLogo, /viewBox="0 0 32 32"/);
    assert.match(optLogo, /fill="#ef4444"/);
    assert.match(optLogo, /fill="#22c55e"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('component emits clean props-ready components for react, svelte, vue, and html', () => {
  const dir = makeTempDir();
  try {
    const iconPath = path.join(dir, 'sparkle-star.svg');
    fs.writeFileSync(
      iconPath,
      `<?xml version="1.0"?>
      <!-- comment -->
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" clip-rule="evenodd" />
      </svg>`,
      'utf8'
    );

    const reactCode = execFileSync(
      process.execPath,
      [BIN_PATH, 'component', iconPath, '--framework', 'react', '--name', 'SparkleIcon'],
      { encoding: 'utf8' }
    );
    assert.match(reactCode, /export function SparkleIcon/);
    assert.match(reactCode, /strokeWidth="2"/);
    assert.match(reactCode, /strokeLinecap="round"/);
    assert.match(reactCode, /clipRule="evenodd"/);
    assert.match(reactCode, /\{\.\.\.props\}/);

    const svelteOut = path.join(dir, 'SparkleStar.svelte');
    execFileSync(
      process.execPath,
      [BIN_PATH, 'component', iconPath, '--framework', 'svelte', '--out', svelteOut],
      { encoding: 'utf8' }
    );
    const svelteCode = fs.readFileSync(svelteOut, 'utf8');
    assert.match(svelteCode, /<script lang="ts">/);
    assert.match(svelteCode, /\$props\(\)/);
    assert.match(svelteCode, /\{#if title\}<title>\{title\}<\/title>\{\/if\}/);

    const vueCode = execFileSync(
      process.execPath,
      [BIN_PATH, 'component', iconPath, '--framework', 'vue'],
      { encoding: 'utf8' }
    );
    assert.match(vueCode, /<script setup lang="ts">/);
    assert.match(vueCode, /defineProps/);
    assert.match(vueCode, /<template>/);
    assert.match(vueCode, /v-bind="\$attrs"/);

    const htmlCode = execFileSync(
      process.execPath,
      [BIN_PATH, 'component', iconPath, '--framework', 'html'],
      { encoding: 'utf8' }
    );
    assert.match(htmlCode, /^<svg /);
    assert.match(htmlCode, /viewBox="0 0 24 24"/);
    assert.match(htmlCode, /class="svgtidy-icon sparkle-star"/);
    assert.equal(htmlCode.includes('<?xml'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('repository contains zero U+2014 em dashes', () => {
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const text = fs.readFileSync(fullPath, 'utf8');
        assert.equal(
          text.includes('\u2014'),
          false,
          `Found forbidden U+2014 em dash in ${path.relative(REPO_ROOT, fullPath)}`
        );
      }
    }
  }
  walk(REPO_ROOT);
});
