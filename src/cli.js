import {
  auditPath,
  optimizePath,
  generateComponentFromFile
} from './index.js';

export const VERSION = '0.1.0';

const HELP_TEXT = `svgtidy v${VERSION} - SVG security/quality auditor, optimizer, and component generator

Usage:
  svgtidy audit <fileOrDir> [--json] [--strict]
  svgtidy optimize <fileOrDir> [--current-color] [--prefix-ids] [--in-place | --out-dir <dir>] [--json]
  svgtidy component <svgFile> --framework <react|svelte|vue|html> [--name <ComponentName>] [--out <file>]
  svgtidy --help | --version

Commands:
  audit       Scan .svg files for missing viewBox, hardcoded dimensions without viewBox,
              duplicate IDs, inline <script>/event XSS hazards, hardcoded hex colors,
              and XML/editor metadata bloat.
  optimize    Strip comments/DOCTYPE/editor metadata, collapse whitespace, normalize viewBox,
              convert monochrome hex fills/strokes to currentColor, and prefix internal IDs.
  component   Emit a clean typed/props-ready React, Svelte, Vue, or HTML component.
`;

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const valueFlags = new Set([
    '--out-dir',
    '--id-prefix',
    '--framework',
    '--name',
    '--out'
  ]);
  const boolFlags = new Set([
    '--json',
    '--strict',
    '--current-color',
    '--prefix-ids',
    '--in-place'
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const k = arg.slice(0, eqIdx);
        const v = arg.slice(eqIdx + 1);
        if (k === '--prefix-ids') {
          flags['prefix-ids'] = true;
          if (v && v !== 'true') flags['id-prefix'] = v;
        } else {
          flags[k.slice(2)] = v;
        }
        continue;
      }
      if (boolFlags.has(arg)) {
        flags[arg.slice(2)] = true;
        continue;
      }
      if (valueFlags.has(arg)) {
        if (i + 1 >= argv.length) {
          throw new Error(`Missing value for flag ${arg}`);
        }
        flags[arg.slice(2)] = argv[++i];
        continue;
      }
      throw new Error(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

export async function runCli(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    io.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }

  const { positionals, flags } = parsed;

  if (flags.version) {
    io.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (flags.help || positionals.length === 0) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  const command = positionals[0];
  const target = positionals[1];

  try {
    if (command === 'audit') {
      if (!target) {
        throw new Error('Missing <fileOrDir> argument for audit');
      }
      const report = auditPath(target);
      if (flags.json) {
        io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const item of report.files) {
          if (item.issues.length === 0) {
            io.stdout.write(`PASS ${item.file}\n`);
          } else {
            io.stdout.write(`ISSUES (${item.issues.length}) ${item.file}\n`);
            for (const iss of item.issues) {
              io.stdout.write(`  [${iss.severity.toUpperCase()}] ${iss.code}: ${iss.message}\n`);
            }
          }
        }
        io.stdout.write(
          `\nScanned ${report.totalFiles} SVG file(s): ` +
          `${report.issueCounts.error} error(s), ${report.issueCounts.warning} warning(s), ${report.issueCounts.info} info.\n`
        );
      }
      if (flags.strict && !report.ok) {
        return 1;
      }
      return 0;
    }

    if (command === 'optimize') {
      if (!target) {
        throw new Error('Missing <fileOrDir> argument for optimize');
      }
      const report = optimizePath(target, {
        currentColor: Boolean(flags['current-color']),
        prefixIds: Boolean(flags['prefix-ids']),
        idPrefix: flags['id-prefix'],
        inPlace: Boolean(flags['in-place']),
        outDir: flags['out-dir']
      });

      if (flags.json) {
        io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        for (const item of report.files) {
          const dest = item.outputPath ? ` -> ${item.outputPath}` : '';
          io.stdout.write(
            `${item.file}${dest}: ${item.originalBytes} B -> ${item.optimizedBytes} B ` +
            `(saved ${item.savedBytes} B / ${item.savedPercent}%)\n`
          );
        }
        io.stdout.write(
          `Total (${report.totalFiles} file(s)): ${report.totalOriginalBytes} B -> ${report.totalOptimizedBytes} B ` +
          `(saved ${report.totalSavedBytes} B / ${report.totalSavedPercent}%)\n`
        );
      }
      return 0;
    }

    if (command === 'component') {
      if (!target) {
        throw new Error('Missing <svgFile> argument for component');
      }
      if (!flags.framework) {
        throw new Error('Missing required --framework <react|svelte|vue|html>');
      }
      const result = generateComponentFromFile(target, {
        framework: flags.framework,
        name: flags.name,
        outFile: flags.out
      });
      if (result.outPath) {
        io.stdout.write(`Wrote ${flags.framework} component to ${result.outPath}\n`);
      } else {
        io.stdout.write(result.code);
      }
      return 0;
    }

    io.stderr.write(`Unknown command "${command}". Run "svgtidy --help" for usage.\n`);
    return 1;
  } catch (err) {
    io.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
}
