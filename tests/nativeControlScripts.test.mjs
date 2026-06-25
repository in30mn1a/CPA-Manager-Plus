import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unixControlScript = path.join(repoRoot, 'bin/native/cpa-manager-plusctl.sh');
const tempDirs = [];

const findExecutable = (candidates) => candidates.find((candidate) => existsSync(candidate));

const runControl = (env, args, options = {}) =>
  execFileSync('bash', [unixControlScript, ...args], {
    env,
    encoding: 'utf8',
    ...options,
  });

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('native control scripts', () => {
  it('creates custom Unix PID/log parent directories with private runtime files', () => {
    if (process.platform === 'win32') {
      return;
    }

    const sleepBinary = findExecutable(['/bin/sleep', '/usr/bin/sleep']);
    if (!sleepBinary) {
      return;
    }

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cpamp-native-control-'));
    tempDirs.push(tempDir);

    const pidFile = path.join(tempDir, 'custom-run', 'nested', 'manager.pid');
    const logFile = path.join(tempDir, 'custom-logs', 'nested', 'manager.log');
    const env = {
      ...process.env,
      CPA_MANAGER_PLUS_BIN: sleepBinary,
      CPA_MANAGER_PLUS_RUN_DIR: path.join(tempDir, 'default-run'),
      CPA_MANAGER_PLUS_LOG_DIR: path.join(tempDir, 'default-logs'),
      CPA_MANAGER_PLUS_PID_FILE: pidFile,
      CPA_MANAGER_PLUS_LOG_FILE: logFile,
    };

    try {
      runControl(env, ['start', '30']);

      expect(existsSync(path.dirname(pidFile))).toBe(true);
      expect(existsSync(path.dirname(logFile))).toBe(true);
      expect(existsSync(pidFile)).toBe(true);
      expect(existsSync(logFile)).toBe(true);
      expect(statSync(pidFile).mode & 0o777).toBe(0o600);
      expect(statSync(logFile).mode & 0o777).toBe(0o600);

      const pidRecord = readFileSync(pidFile, 'utf8');
      expect(pidRecord).toContain('pid=');
      expect(pidRecord).toContain('start=');
      expect(pidRecord).toContain('binary=');
      expect(pidRecord).toContain('command=');

      expect(runControl(env, ['status'])).toContain('is running with PID');
      expect(runControl(env, ['stop'])).toContain('stopped');
      expect(existsSync(pidFile)).toBe(false);
    } finally {
      spawnSync('bash', [unixControlScript, 'stop'], { env, encoding: 'utf8' });
    }
  });

  it('refuses to stop a running process from an unverifiable legacy Unix PID file', () => {
    if (process.platform === 'win32') {
      return;
    }

    const sleepBinary = findExecutable(['/bin/sleep', '/usr/bin/sleep']);
    if (!sleepBinary) {
      return;
    }

    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'cpamp-native-conflict-'));
    tempDirs.push(tempDir);

    const pidFile = path.join(tempDir, 'run', 'manager.pid');
    const logFile = path.join(tempDir, 'logs', 'manager.log');
    const unrelatedProcess = spawn(sleepBinary, ['5'], {
      stdio: 'ignore',
    });
    const unrelatedPid = unrelatedProcess.pid;
    expect(unrelatedPid).toBeGreaterThan(0);

    const env = {
      ...process.env,
      CPA_MANAGER_PLUS_BIN: sleepBinary,
      CPA_MANAGER_PLUS_PID_FILE: pidFile,
      CPA_MANAGER_PLUS_LOG_FILE: logFile,
    };

    try {
      rmSync(path.dirname(pidFile), { force: true, recursive: true });
      mkdirSync(path.dirname(pidFile), { recursive: true });
      writeFileSync(pidFile, `${unrelatedPid}\n`);

      const stopResult = spawnSync('bash', [unixControlScript, 'stop'], {
        env,
        encoding: 'utf8',
      });

      expect(stopResult.status).not.toBe(0);
      expect(stopResult.stderr).toContain('Refusing to stop');
      expect(spawnSync('kill', ['-0', String(unrelatedPid)]).status).toBe(0);
    } finally {
      unrelatedProcess.kill();
    }
  });
});
