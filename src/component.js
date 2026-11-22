import fs from 'node:fs';
import path from 'node:path';
import { optimizeSvgContent } from './optimize.js';
import { toPascalCase } from './fs-utils.js';

const REACT_ATTR_MAP = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  'accent-height': 'accentHeight',
  'alignment-baseline': 'alignmentBaseline',
  'arabic-form': 'arabicForm',
  'baseline-shift': 'baselineShift',
  'cap-height': 'capHeight',
  'clip-path': 'clipPath',
  'clip-rule': 'clipRule',
  'color-interpolation': 'colorInterpolation',
  'color-interpolation-filters': 'colorInterpolationFilters',
  'color-profile': 'colorProfile',
  'dominant-baseline': 'dominantBaseline',
  'enable-background': 'enableBackground',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'flood-color': 'floodColor',
  'flood-opacity': 'floodOpacity',
  'font-family': 'fontFamily',
  'font-size': 'fontSize',
  'font-size-adjust': 'fontSizeAdjust',
  'font-stretch': 'fontStretch',
  'font-style': 'fontStyle',
  'font-variant': 'fontVariant',
  'font-weight': 'fontWeight',
  'glyph-name': 'glyphName',
  'glyph-orientation-horizontal': 'glyphOrientationHorizontal',
  'glyph-orientation-vertical': 'glyphOrientationVertical',
  'horiz-adv-x': 'horizAdvX',
  'horiz-origin-x': 'horizOriginX',
  'image-rendering': 'imageRendering',
  'letter-spacing': 'letterSpacing',
  'lighting-color': 'lightingColor',
  'marker-end': 'markerEnd',
  'marker-mid': 'markerMid',
  'marker-start': 'markerStart',
  'overline-position': 'overlinePosition',
  'overline-thickness': 'overlineThickness',
  'paint-order': 'paintOrder',
  'panose-1': 'panose1',
  'pointer-events': 'pointerEvents',
  'rendering-intent': 'renderingIntent',
  'shape-rendering': 'shapeRendering',
  'stop-color': 'stopColor',
  'stop-opacity': 'stopOpacity',
  'strikethrough-position': 'strikethroughPosition',
  'strikethrough-thickness': 'strikethroughThickness',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'text-anchor': 'textAnchor',
  'text-decoration': 'textDecoration',
  'text-rendering': 'textRendering',
  'underline-position': 'underlinePosition',
  'underline-thickness': 'underlineThickness',
  'unicode-bidi': 'unicodeBidi',
  'unicode-range': 'unicodeRange',
  'units-per-em': 'unitsPerEm',
  'v-alphabetic': 'vAlphabetic',
  'v-hanging': 'vHanging',
  'v-ideographic': 'vIdeographic',
  'v-mathematical': 'vMathematical',
  'vector-effect': 'vectorEffect',
  'vert-adv-y': 'vertAdvY',
  'vert-origin-x': 'vertOriginX',
  'vert-origin-y': 'vertOriginY',
  'word-spacing': 'wordSpacing',
  'writing-mode': 'writingMode',
  'x-height': 'xHeight',
  'xlink:actuate': 'xlinkActuate',
  'xlink:arcrole': 'xlinkArcrole',
  'xlink:href': 'xlinkHref',
  'xlink:role': 'xlinkRole',
  'xlink:show': 'xlinkShow',
  'xlink:title': 'xlinkTitle',
  'xlink:type': 'xlinkType',
  'xml:base': 'xmlBase',
  'xml:lang': 'xmlLang',
  'xml:space': 'xmlSpace',
  'xmlns:xlink': 'xmlnsXlink'
};

function parseSvgRoot(cleanSvg) {
  const openMatch = cleanSvg.match(/^<svg\b([^>]*)>/i);
  if (!openMatch) {
    throw new Error('Input does not start with a valid <svg> element');
  }
  const attrString = openMatch[1];
  const isSelfClosing = openMatch[0].endsWith('/>');
  const inner = isSelfClosing
    ? ''
    : cleanSvg.slice(openMatch[0].length).replace(/<\/svg>\s*$/i, '');

  const attrs = [];
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = attrRegex.exec(attrString)) !== null) {
    attrs.push({ name: m[1], value: m[2] ?? m[3] });
  }
  return { attrs, inner: inner.trim() };
}

function reactifyAttributes(markup) {
  return markup.replace(/<([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g, (full, tag, rest) => {
    const converted = rest.replace(
      /\s([a-zA-Z_:][a-zA-Z0-9_.:-]*)(\s*=\s*(?:"[^"]*"|'[^']*'))/g,
      (m, attrName, rhs) => {
        if (attrName.startsWith('data-') || attrName.startsWith('aria-')) {
          return m;
        }
        const mapped = REACT_ATTR_MAP[attrName] || REACT_ATTR_MAP[attrName.toLowerCase()];
        return mapped ? ` ${mapped}${rhs}` : m;
      }
    );
    return `<${tag}${converted}>`;
  });
}

export function generateComponent(svgSource, {
  framework,
  name,
  filePath = 'Icon.svg'
} = {}) {
  const fw = String(framework || '').toLowerCase();
  if (!['react', 'svelte', 'vue', 'html'].includes(fw)) {
    throw new Error(`Unsupported --framework "${framework}". Expected react, svelte, vue, or html.`);
  }

  const componentName = toPascalCase(name || path.basename(filePath, path.extname(filePath)));
  const kebabName = componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

  const optimized = optimizeSvgContent(svgSource);
  const { attrs, inner } = parseSvgRoot(optimized);
  const innerWithoutTitle = inner.replace(/^<title\b[^>]*>[\s\S]*?<\/title>/i, '').trim();

  const defaultWidth = attrs.find((a) => a.name === 'width')?.value || '24';
  const defaultHeight = attrs.find((a) => a.name === 'height')?.value || '24';
  const baseAttrs = attrs.filter((a) => a.name !== 'width' && a.name !== 'height');

  if (fw === 'react') {
    const rootAttrStr = baseAttrs
      .map(({ name: k, value: v }) => {
        const key = (k.startsWith('data-') || k.startsWith('aria-'))
          ? k
          : (REACT_ATTR_MAP[k] || k);
        return `${key}="${v}"`;
      })
      .join(' ');
    const jsxInner = reactifyAttributes(innerWithoutTitle);

    return [
      '/**',
      ` * @typedef {import('react').SVGProps<SVGSVGElement> & { size?: number | string; title?: string }} ${componentName}Props`,
      ' */',
      '',
      '/**',
      ` * @param {${componentName}Props} props`,
      ' */',
      `export function ${componentName}({ size, width, height, title, ...props } = {}) {`,
      '  return (',
      `    <svg ${rootAttrStr} width={size ?? width ?? "${defaultWidth}"} height={size ?? height ?? "${defaultHeight}"} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} {...props}>`,
      '      {title ? <title>{title}</title> : null}',
      jsxInner ? `      ${jsxInner}` : '',
      '    </svg>',
      '  );',
      '}',
      '',
      `export default ${componentName};`,
      ''
    ].filter(Boolean).join('\n');
  }

  if (fw === 'svelte') {
    const rootAttrStr = baseAttrs.map(({ name: k, value: v }) => `${k}="${v}"`).join(' ');
    return [
      '<script lang="ts">',
      "  import type { SVGAttributes } from 'svelte/elements';",
      '',
      '  interface Props extends SVGAttributes<SVGSVGElement> {',
      '    size?: number | string;',
      '    title?: string;',
      '  }',
      '',
      `  let { size, width = '${defaultWidth}', height = '${defaultHeight}', title, ...props }: Props = $props();`,
      '</script>',
      '',
      `<svg ${rootAttrStr} width={size ?? width} height={size ?? height} role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} {...props}>`,
      '  {#if title}<title>{title}</title>{/if}',
      innerWithoutTitle ? `  ${innerWithoutTitle}` : '',
      '</svg>',
      ''
    ].filter(Boolean).join('\n');
  }

  if (fw === 'vue') {
    const rootAttrStr = baseAttrs.map(({ name: k, value: v }) => `${k}="${v}"`).join(' ');
    return [
      '<script setup lang="ts">',
      'withDefaults(defineProps<{',
      '  size?: number | string;',
      '  width?: number | string;',
      '  height?: number | string;',
      '  title?: string;',
      '}>(), {',
      '  size: undefined,',
      `  width: '${defaultWidth}',`,
      `  height: '${defaultHeight}',`,
      '  title: undefined',
      '});',
      '</script>',
      '',
      '<template>',
      `  <svg ${rootAttrStr} :width="size ?? width" :height="size ?? height" :role="title ? 'img' : undefined" :aria-hidden="title ? undefined : 'true'" v-bind="$attrs">`,
      '    <title v-if="title">{{ title }}</title>',
      innerWithoutTitle ? `    ${innerWithoutTitle}` : '',
      '  </svg>',
      '</template>',
      ''
    ].filter(Boolean).join('\n');
  }

  // html
  const filteredHtmlAttrs = baseAttrs.filter((a) => a.name !== 'class' && a.name !== 'role' && a.name !== 'aria-hidden');
  const existingClass = baseAttrs.find((a) => a.name === 'class')?.value;
  const mergedClass = existingClass ? `svgtidy-icon ${kebabName} ${existingClass}` : `svgtidy-icon ${kebabName}`;
  const htmlAttrStr = [
    ...filteredHtmlAttrs.map(({ name: k, value: v }) => `${k}="${v}"`),
    `width="${defaultWidth}"`,
    `height="${defaultHeight}"`,
    `class="${mergedClass}"`,
    'role="img"',
    `aria-label="${componentName}"`
  ].join(' ');

  return `<svg ${htmlAttrStr}>${inner}</svg>\n`;
}

export function generateComponentFromFile(svgFile, {
  framework,
  name,
  outFile
} = {}) {
  const resolved = path.resolve(svgFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`SVG file does not exist: ${svgFile}`);
  }
  const source = fs.readFileSync(resolved, 'utf8');
  const code = generateComponent(source, {
    framework,
    name,
    filePath: resolved
  });

  if (outFile) {
    const outResolved = path.resolve(outFile);
    fs.mkdirSync(path.dirname(outResolved), { recursive: true });
    fs.writeFileSync(outResolved, code, 'utf8');
    return { code, outPath: outResolved };
  }

  return { code, outPath: null };
}
