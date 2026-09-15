import type { CommandRunner } from '../src/get-affected-workspaces';
import { describe, expect, it, vi } from 'vitest';
import {
  getAffectedWorkspaces,
  parseWorkspaceNames,
} from '../src/get-affected-workspaces';

const availablePackages = JSON.stringify({
  packages: {
    items: [
      { name: '@app/web' },
      { name: '@app/chrome-extension' },
      { name: '@repo/ui' },
    ],
  },
});

function createCommandRunner(affectedPackages: readonly string[] = []): CommandRunner {
  return vi.fn(async (command, arguments_) => {
    if (command === 'git') return '';
    if (arguments_.includes('--affected')) {
      return JSON.stringify({
        packages: { items: affectedPackages.map((name) => ({ name })) },
      });
    }

    return availablePackages;
  });
}

describe('parseWorkspaceNames', () => {
  it('keeps scoped names and removes duplicates', () => {
    expect(parseWorkspaceNames('@app/web\n@scope/extension, @app/web')).toEqual([
      '@app/web',
      '@scope/extension',
    ]);
  });

  it('rejects an empty workspace input', () => {
    expect(() => parseWorkspaceNames(' \n , ')).toThrow(
      'must contain at least one package name',
    );
  });
});

describe('getAffectedWorkspaces', () => {
  it('reports only requested workspaces affected through shared dependencies', async () => {
    const commandRunner = createCommandRunner(['@repo/ui', '@app/web']);

    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/web', '@app/chrome-extension'],
        },
        commandRunner,
      ),
    ).resolves.toEqual({
      affected: { '@app/chrome-extension': false, '@app/web': true },
      affectedWorkspaces: ['@app/web'],
      anyAffected: true,
    });
    expect(commandRunner).toHaveBeenLastCalledWith(
      'turbo',
      ['ls', '--affected', '--output=json'],
      expect.objectContaining({
        env: expect.objectContaining({
          TURBO_SCM_BASE: 'base-sha',
          TURBO_SCM_HEAD: 'head-sha',
        }),
      }),
    );
  });

  it('reports no affected workspaces when base and head are equal', async () => {
    const commandRunner = createCommandRunner();

    await expect(
      getAffectedWorkspaces(
        {
          base: 'same-sha',
          head: 'same-sha',
          turboPath: ' ',
          workspaces: ['@app/web'],
        },
        commandRunner,
      ),
    ).resolves.toEqual({
      affected: { '@app/web': false },
      affectedWorkspaces: [],
      anyAffected: false,
    });
  });

  it('rejects a blank revision before running commands', async () => {
    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: ' ',
          turboPath: 'turbo',
          workspaces: ['@app/web'],
        },
        createCommandRunner(),
      ),
    ).rejects.toThrow('The "head" input must contain a Git revision');
  });

  it('fails instead of treating an unknown workspace as unaffected', async () => {
    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/missing'],
        },
        createCommandRunner(),
      ),
    ).rejects.toThrow('Requested Turborepo workspace(s) do not exist: @app/missing');
  });

  it('fails clearly when the base revision is unavailable', async () => {
    const commandRunner = vi.fn(async (command: string) => {
      if (command === 'git') throw new Error('unknown revision');
      return availablePackages;
    }) as CommandRunner;

    await expect(
      getAffectedWorkspaces(
        {
          base: 'missing-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/web'],
        },
        commandRunner,
      ),
    ).rejects.toThrow('The base revision "missing-sha" is unavailable locally');
  });

  it('fails when Turbo returns malformed output', async () => {
    const commandRunner = vi.fn(async (command: string) => {
      if (command === 'git') return '';
      return 'not json';
    }) as CommandRunner;

    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/web'],
        },
        commandRunner,
      ),
    ).rejects.toThrow('Turbo returned malformed JSON during workspace listing');
  });

  it('fails when Turbo output does not contain package names', async () => {
    const commandRunner = vi.fn(async (command: string) => {
      if (command === 'git') return '';
      return JSON.stringify({ packages: {} });
    }) as CommandRunner;

    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/web'],
        },
        commandRunner,
      ),
    ).rejects.toThrow('Turbo returned malformed JSON during workspace listing');
  });

  it('fails when Turbo affected detection exits unsuccessfully', async () => {
    const commandRunner = vi.fn(
      async (command: string, arguments_: readonly string[]) => {
        if (command === 'git') return '';
        if (arguments_.includes('--affected')) throw new Error('Turbo command failed');
        return availablePackages;
      },
    ) as CommandRunner;

    await expect(
      getAffectedWorkspaces(
        {
          base: 'base-sha',
          head: 'head-sha',
          turboPath: 'turbo',
          workspaces: ['@app/web'],
        },
        commandRunner,
      ),
    ).rejects.toThrow(
      'Turborepo affected-workspace detection failed: Turbo command failed',
    );
  });
});
