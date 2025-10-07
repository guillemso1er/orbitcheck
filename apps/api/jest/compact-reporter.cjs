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
    if (!/^\s*at /.test(l)) continue;
    // capture '(...path...:line:col)' or '...path...:line:col' (handles Windows drive letters)
    const m = l.match(/KATEX_INLINE_OPEN?(.+?):(\d+):(\d+)KATEX_INLINE_CLOSE?\s*$/);
    if (!m) continue;

    const [, file, line, col] = m;
    const frame = { file, line: Number(line), col: Number(col) };

    // Prefer project frames over node internals/node_modules
    if (!/node_modules|internal\/|^\s*at (?:node:|Native)/.test(l)) return frame;
    if (!fallback) fallback = frame;
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

      const head = trimMessageHead(failureMsg, 3);
      process.stdout.write(`    ${head.replace(/\n/g, '\n    ')}\n`);

      const block = extractExpectationBlock(failureMsg, 22);
      if (block) {
        process.stdout.write(`\n    ${block.replace(/\n/g, '\n    ')}\n`);
      }

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

      const stackStart = failureMsg.search(/\n\s+at /);
      if (stackStart !== -1) {
        const cleaned = cleanStack(failureMsg.slice(stackStart + 1), this._opts.maxStackLines);
        if (cleaned) {
          process.stdout.write('\n' + cleaned.split('\n').map(l => '    ' + l).join('\n') + '\n');
        }
      }

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
    // Suites that failed to run (e.g., syntax error, empty suite, import error)
    const failedToRunSuites = results.testResults.filter(
      s => (s.testExecError || s.failureMessage) && s.numFailingTests === 0
    );

    if (failedToRunSuites.length > 0) {
      for (const suite of failedToRunSuites) {
        const file = rel(suite.testFilePath);
        process.stdout.write(`\n${c.red('FAIL')} ${c.bold(file)}\n`);
;

        const parsed = parseFirstFrame(failureMsg, suite.testFilePath);

        let header = `  ${c.red('✖')} Suite Error`;
        if (parsed && parsed.line) {
          header += c.dim(` (${rel(parsed.file)}:${parsed.line}:${parsed.col || 0})`);
        }
        process.stdout.write(header + '\n');

        const exec = suite.testExecError || {};
        const failureMsg = suite.failureMessage ||
          (exec && (exec.stack || exec.message)) ||
          'Suite failed to run.';

        // Prefer a clean one-liner, else extract the reason block
        const reason =
          (exec && typeof exec.message === 'string' && exec.message.trim()) ||
          extractSuiteReason(failureMsg, 40);

        if (reason) {
          process.stdout.write(`    ${reason.replace(/\n/g, '\n    ')}\n`);
        } else {
          // Fallback: show a bit more of the original message (don’t stop at first blank line)
          const preview = failureMsg.split('\n').slice(0, 15).join('\n');
          process.stdout.write(`    ${preview.replace(/\n/g, '\n    ')}\n`);
        }

        if (this._opts.codeFrame && parsed && parsed.file && parsed.line) {
          const cf = codeFrame(parsed.file, parsed.line, parsed.col, this._opts.codeFrameLines);
          if (cf) {
            process.stdout.write('\n' + cf.split('\n').map(l => '    ' + l).join('\n') + '\n');
          }
        }

        const stackStart = failureMsg.search(/\n\s+at /);
        if (stackStart !== -1) {
          const cleaned = cleanStack(failureMsg.slice(stackStart + 1), this._opts.maxStackLines);
          if (cleaned) {
            process.stdout.write('\n' + cleaned.split('\n').map(l => '    ' + l).join('\n') + '\n');
          }
        }
      }
    }

    // Summary
    const secs = ((Date.now() - this._start) / 1000).toFixed(2);
    const fail = results.numFailedTests;
    const pass = results.numPassedTests;
    const skip = results.numPendingTests + results.numTodoTests;

    const summaryChunks = [];
    if (fail) summaryChunks.push(c.red(`${fail} failed`));
    if (pass) summaryChunks.push(c.green(`${pass} passed`));
    if (skip) summaryChunks.push(c.yellow(`${skip} skipped`));

    const failedToRunCount = failedToRunSuites.length || results.numRuntimeErrorTestSuites || 0;
    if (failedToRunCount > 0 && fail === 0) {
      summaryChunks.unshift(c.red(`${failedToRunCount} suite${failedToRunCount > 1 ? 's' : ''} failed to run`));
    }

    // If Jest says the run failed but we didn't count anything, nudge about global errors
    if (!results.success && summaryChunks.length === 0) {
      summaryChunks.push(c.red('run failed'));
    }

    const line1 = summaryChunks.join(', ') || c.green('all passed');
    const line2 = `${results.numTotalTests} total in ${results.numTotalTestSuites} files • ${secs}s`;
    process.stdout.write(`\n${line1}  ${line2}\n`);

    // Open handles (when detectOpenHandles is on)
    if (Array.isArray(results.openHandles) && results.openHandles.length) {
      process.stdout.write(`\n${c.yellow('Open handles detected')} ${c.dim(`(${results.openHandles.length})`)}\n`);
      for (const h of results.openHandles.slice(0, 5)) {
        process.stdout.write(`  ${c.dim(String(h))}\n`);
      }
      if (results.openHandles.length > 5) {
        process.stdout.write(`  ${c.dim(`… ${results.openHandles.length - 5} more`)}\n`);
      }
      process.stdout.write(`  ${c.dim('Tip: run with --detectOpenHandles --runInBand to debug open handles.')}\n`);
    }

    // Slowest files
    const slowFiles = results.testResults
      .map(tr => ({ file: rel(tr.testFilePath), ms: tr.perfStats ? (tr.perfStats.end - tr.perfStats.start) : 0 }))
      .filter(x => x.ms > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3);

    if (slowFiles.length) {
      process.stdout.write(c.dim('Slowest files:') + '\n');
      for (const s of slowFiles) {
        process.stdout.write(c.dim(`  ${s.file} ${Math.round(s.ms)}ms`) + '\n');
      }
    }
  }

  getLastError() { }
}
function extractSuiteReason(msg, maxLines = 40) {
  if (!msg) return null;
  const lines = msg.split('\n');

  // Skip leading empties
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;

  // Skip "● Test suite failed to run" header + following blank lines
  if (i < lines.length && /Test suite failed to run/i.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
  }

  // Collect until the stack trace begins ("  at ...")
  const out = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s+at /.test(l)) break;
    out.push(l);
  }

  // Trim trailing blanks
  while (out.length && out[out.length - 1].trim() === '') out.pop();

  if (!out.length) return null;

  if (out.length > maxLines) {
    const extra = out.length - maxLines;
    out.length = maxLines;
    out.push(c.dim(`… ${extra} more lines omitted`));
  }
  return out.join('\n');
}

module.exports = CompactReporter;