// jest/compact-reporter.cjs
// Minimal, high-signal reporter for Jest (CJS to avoid ESM interop issues)
const path = require('path');
const fs = require('fs');

const tty = process.stdout.isTTY;
const c = {
  red: s => tty ? `\x1b[31m${s}\x1b[0m` : s,
  green: s => tty ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: s => tty ? `\x1b[33m${s}\x1b[0m` : s,
  cyan: s => tty ? `\x1b[36m${s}\x1b[0m` : s,
  gray: s => tty ? `\x1b[90m${s}\x1b[0m` : s,
  bold: s => tty ? `\x1b[1m${s}\x1b[0m` : s,
  dim: s => tty ? `\x1b[2m${s}\x1b[0m` : s,
};

const rel = p => path.relative(process.cwd(), p || '');

function codeFrame(fp, line, col, context = 2) {
  try {
    const rows = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
    const start = Math.max(1, line - context);
    const end = Math.min(rows.length, line + context);
    const width = String(end).length;
    const out = [];
    for (let ln = start; ln <= end; ln++) {
      const prefix = ln === line ? c.red('>') : ' ';
      const num = String(ln).padStart(width);
      const text = rows[ln - 1];
      if (ln === line && col) {
        const caret = ' '.repeat(col - 1) + c.red('^');
        out.push(`${prefix} ${c.gray(num)} ${text}`);
        out.push(`${' '.repeat(prefix.length)} ${' '.repeat(width)} ${caret}`);
      } else {
        out.push(`${prefix} ${c.gray(num)} ${text}`);
      }
    }
    return out.join('\n');
  } catch {
    return null;
  }
}

function cleanStack(stack, maxLines = 5) {
  if (!stack) return '';
  const lines = stack.split('\n').filter(Boolean);
  const isProject = l =>
    !/node_modules|internal\/|^\s+at (?:node:|Native)/.test(l) &&
    (l.includes(path.sep + 'src' + path.sep) || l.includes(process.cwd()));
  const proj = lines.filter(isProject);
  const chosen = (proj.length ? proj : lines).slice(0, maxLines);
  const more = (proj.length ? proj.length : lines.length) - chosen.length;
  const out = [c.dim('Stack'), ...chosen.map(l => c.dim(l.trim()))];
  if (more > 0) out.push(c.dim(`… ${more} more`));
  return out.join('\n');
}

function parseFirstFrame(msg, fallbackFile) {
  const lines = msg.split('\n');
  let fallback;
  for (const l of lines) {
    const m = l.match(/(?:KATEX_INLINE_OPEN|\s)([^\s()]+):(\d+):(\d+)KATEX_INLINE_CLOSE?/);
    if (m) {
      const [_, file, line, col] = m;
      const frame = { file, line: Number(line), col: Number(col) };
      if (!/node_modules/.test(file)) return frame;
      fallback = frame;
    }
  }
  return fallback || (fallbackFile ? { file: fallbackFile } : null);
}

function extractExpectationBlock(msg, maxLines = 30) {
  const lines = msg.split('\n');
  const startIdx = lines.findIndex(l => l.trim().startsWith('Expected:'));
  if (startIdx === -1) return null;
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    const line = lines[endIdx];
    if (/^\s+at /.test(line)) break;
    endIdx++;
  }
  let block = lines.slice(startIdx, endIdx);
  if (block.length > maxLines) {
    const trimmed = block.slice(0, maxLines);
    trimmed.push(c.dim(`… ${block.length - maxLines} more lines omitted`));
    block = trimmed;
  }
  return block.join('\n');
}

function trimMessageHead(msg, maxLines = 3) {
  const lines = msg.split('\n');
  const firstBlank = lines.findIndex(l => l.trim() === '');
  const end = firstBlank === -1 ? Math.min(maxLines, lines.length) : Math.min(firstBlank, maxLines);
  return lines.slice(0, end).join('\n');
}

class CompactReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._opts = Object.assign(
      {
        maxStackLines: 4,
        maxConsoleLines: 20,
        codeFrame: true,
        codeFrameLines: 2,
      },
      options || {}
    );
    this._start = Date.now();
  }

  onTestResult(test, testResult) {
    const failed = testResult.testResults.filter(r => r.status === 'failed');
    if (!failed.length) return;

    const file = rel(testResult.testFilePath);
    process.stdout.write(`\n${c.red('FAIL')} ${c.bold(file)}\n`);

    for (const t of failed) {
      const title = [...t.ancestorTitles, t.title].join(' › ');
      const failureMsg = (t.failureMessages && t.failureMessages.length)
        ? t.failureMessages.join('\n\n')
        : 'Test failed';

      // Location
      let header = `  ${c.red('✖')} ${title}`;
      const loc = t.location || null;
      let parsed = null;
      if (loc) {
        header += c.dim(` (${rel(testResult.testFilePath)}:${loc.line}:${loc.column || 0})`);
      } else {
        parsed = parseFirstFrame(failureMsg, testResult.testFilePath);
        if (parsed && parsed.line) {
          header += c.dim(` (${rel(parsed.file)}:${parsed.line}:${parsed.col || 0})`);
        }
      }
      process.stdout.write(header + '\n');

      // Matcher summary
      const head = trimMessageHead(failureMsg, 3);
      process.stdout.write(`    ${head.replace(/\n/g, '\n    ')}\n`);

      // Expected/Received block
      const block = extractExpectationBlock(failureMsg, 22);
      if (block) {
        process.stdout.write(`\n    ${block.replace(/\n/g, '\n    ')}\n`);
      }

      // Code frame
      if (this._opts.codeFrame) {
        const pos =
          (loc && { file: testResult.testFilePath, line: loc.line, col: loc.column }) ||
          parsed;
        if (pos && pos.file && pos.line) {
          const cf = codeFrame(pos.file, pos.line, pos.col, this._opts.codeFrameLines);
          if (cf) {
            process.stdout.write('\n' + cf.split('\n').map(l => '    ' + l).join('\n') + '\n');
          }
        }
      }

      // Clean stack
      const stackStart = failureMsg.search(/\n\s+at /);
      if (stackStart !== -1) {
        const cleaned = cleanStack(failureMsg.slice(stackStart + 1), this._opts.maxStackLines);
        if (cleaned) {
          process.stdout.write('\n' + cleaned.split('\n').map(l => '    ' + l).join('\n') + '\n');
        }
      }

      // Console for this file (Jest aggregates per file)
      const entries = (testResult.console || []).filter(e => e.type !== 'debug');
      if (entries.length) {
        const max = this._opts.maxConsoleLines;
        const lines = [];
        for (const e of entries) {
          const parts = e.message.split('\n');
          const msg = parts.slice(1).join('\n').trim() || e.message.trim();
          const tag =
            e.type === 'warn' ? c.yellow('warn') :
            e.type === 'error' ? c.red('error') :
            c.gray(e.type);
          lines.push(`${tag} ${msg}`);
        }
        const trimmed = lines.length > max ? lines.slice(-max) : lines;
        process.stdout.write(`\n    ${c.cyan('Console')} ${c.dim(`(${trimmed.length} line${trimmed.length === 1 ? '' : 's'})`)}\n`);
        for (const line of trimmed) {
          process.stdout.write('      ' + line.replace(/\n/g, '\n      ') + '\n');
        }
      }

      process.stdout.write('\n');
    }
  }

  onRunComplete(_, results) {
    const secs = ((Date.now() - this._start) / 1000).toFixed(2);
    const fail = results.numFailedTests;
    const pass = results.numPassedTests;
    const skip = results.numPendingTests + results.numTodoTests;

    const summaryChunks = [];
    if (fail) summaryChunks.push(c.red(`${fail} failed`));
    if (pass) summaryChunks.push(c.green(`${pass} passed`));
    if (skip) summaryChunks.push(c.yellow(`${skip} skipped`));

    const line1 = summaryChunks.join(', ') || c.green('all passed');
    const line2 = `${results.numTotalTests} total in ${results.numTotalTestSuites} files • ${secs}s`;

    process.stdout.write(`${line1}  ${line2}\n`);

    // Show top slow files (optional)
    const slowFiles = results.testResults
      .map(tr => ({ file: rel(tr.testFilePath), ms: tr.perfStats ? (tr.perfStats.end - tr.perfStats.start) : 0 }))
      .filter(x => x.ms > 0)
      .sort((a,b) => b.ms - a.ms)
      .slice(0, 3);

    if (slowFiles.length) {
      process.stdout.write(c.dim('Slowest files:') + '\n');
      for (const s of slowFiles) {
        process.stdout.write(c.dim(`  ${s.file} ${Math.round(s.ms)}ms`) + '\n');
      }
    }
  }

  getLastError() {}
}

module.exports = CompactReporter;