import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { writeDiagnostic } from './server-diagnostics.js';

export default class DiagnosticReporter implements Reporter {
  onBegin() {
    writeDiagnostic('run-begin');
  }
  onTestBegin(test: TestCase) {
    writeDiagnostic('test-begin', { test: test.title });
  }
  onTestEnd(test: TestCase, result: TestResult) {
    writeDiagnostic('test-end', {
      test: test.title,
      status: result.status,
      durationMs: result.duration,
    });
  }
  onStdErr(chunk: string | Buffer) {
    this.markError(chunk);
  }
  onStdOut(chunk: string | Buffer) {
    this.markError(chunk);
  }
  private markError(chunk: string | Buffer) {
    const value = chunk.toString();
    if (/ECONNRESET|uncaughtException|Error: aborted/.test(value))
      writeDiagnostic('server-error-output-observed', {
        reset: value.includes('ECONNRESET'),
        aborted: value.includes('aborted'),
        uncaught: value.includes('uncaughtException'),
      });
  }
  onEnd(result: FullResult) {
    writeDiagnostic('run-end', { status: result.status });
  }
  onExit(): Promise<void> {
    writeDiagnostic('runner-exit');
    return Promise.resolve();
  }
  // Runs alongside the list reporter, which retains all original output/errors/assertions.
}
