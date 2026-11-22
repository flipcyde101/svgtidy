# svgtidy

Zero-dependency Node 24 ESM CLI for auditing SVG quality and security hazards, optimizing bloated editor exports, and generating clean typed React, Svelte, Vue, or HTML components.

## Features

- **`svgtidy audit`**: Flags missing `viewBox`, hardcoded `width`/`height` without `viewBox`, duplicate `id` collisions, inline `<script>` / `on*=` event-handler XSS hazards, hardcoded hex strokes/fills vs `currentColor`, and XML/Inkscape/Sodipodi metadata bloat.
- **`svgtidy optimize`**: Strips XML prologs, DOCTYPE, comments, and editor metadata (`inkscape:`, `sodipodi:`, `<metadata>`), collapses redundant whitespace, normalizes or synthesizes `viewBox`, optionally rewrites monochrome hex colors to `currentColor`, and safely prefixes internal IDs + `url(#...)` references while reporting byte savings.
- **`svgtidy component`**: Emits typed, props-ready icon or diagram components for `react`, `svelte`, `vue`, and `html`.

## Usage

```bash
# Audit a file or directory of SVGs
node ./bin/svgtidy.js audit ./icons --json

# Optimize SVGs with currentColor conversion and ID prefixing
node ./bin/svgtidy.js optimize ./icons --current-color --prefix-ids --out-dir ./dist/icons

# Generate a React, Svelte, Vue, or HTML component
node ./bin/svgtidy.js component ./icons/sparkle.svg --framework react --name SparkleIcon --out ./src/SparkleIcon.jsx
```

## Testing

On Windows PowerShell (where `npm.ps1` may be blocked by execution policy), run `npm.cmd test` or `node --test`:

```powershell
npm.cmd test
node --test
```

## License

MIT
