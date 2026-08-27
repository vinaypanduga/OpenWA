import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeSecretFile } from './secret-file';

describe('writeSecretFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owa-secret-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const mode = (p: string): number => statSync(p).mode & 0o777;
  const expectOwnerOnly = (p: string): void => {
    expect(existsSync(p)).toBe(true);
    if (process.platform !== 'win32') {
      expect(mode(p) & 0o077).toBe(0);
    }
  };

  it('writes a new secret file owner-only (no group/other access)', () => {
    const p = join(dir, 'secret');
    writeSecretFile(p, 'topsecret');
    expectOwnerOnly(p);
    expect(readFileSync(p, 'utf8')).toBe('topsecret');
  });

  it('tightens an already-existing world-readable file (writeFileSync mode only applies on create)', () => {
    const p = join(dir, 'legacy');
    writeFileSync(p, 'old', { mode: 0o644 });
    if (process.platform !== 'win32') {
      expect(mode(p) & 0o077).not.toBe(0); // precondition: loose
    }

    writeSecretFile(p, 'new');
    expectOwnerOnly(p);
    expect(readFileSync(p, 'utf8')).toBe('new');
  });

  it('does not warn when the pre-write chmod finds no file on a normal first write', () => {
    const p = join(dir, 'ghost');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // chmod sees ENOENT before writeFileSync creates the file. This is expected, and create-mode
    // still guarantees owner-only permissions without producing a misleading deployment warning.
    writeSecretFile(p, 'secret');

    expect(warnSpy).not.toHaveBeenCalled();
    expectOwnerOnly(p);
    expect(readFileSync(p, 'utf8')).toBe('secret');

    warnSpy.mockRestore();
  });
});
