import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAffectedWorkspacesMock = vi.fn();
const parseWorkspaceNamesMock = vi.fn();

vi.mock('@actions/core');
vi.mock('../src/get-affected-workspaces', () => ({
  getAffectedWorkspaces: getAffectedWorkspacesMock,
  parseWorkspaceNames: parseWorkspaceNamesMock,
}));

const { run } = await import('../src/main');

describe('run', () => {
  beforeEach(() => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        base: 'before-sha',
        head: 'after-sha',
        'turbo-path': 'turbo',
        workspaces: '@app/web\n@app/chrome-extension',
      };

      return inputs[name] ?? '';
    });
    parseWorkspaceNamesMock.mockReturnValue(['@app/web', '@app/chrome-extension']);
    getAffectedWorkspacesMock.mockResolvedValue({
      affected: { '@app/chrome-extension': false, '@app/web': true },
      affectedWorkspaces: ['@app/web'],
      anyAffected: true,
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('publishes generic affected-workspace outputs', async () => {
    await run();

    expect(getAffectedWorkspacesMock).toHaveBeenCalledWith({
      base: 'before-sha',
      head: 'after-sha',
      turboPath: 'turbo',
      workspaces: ['@app/web', '@app/chrome-extension'],
    });
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith(
      'affected',
      '{"@app/chrome-extension":false,"@app/web":true}',
    );
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith(
      'affected-workspaces',
      '["@app/web"]',
    );
    expect(vi.mocked(core.setOutput)).toHaveBeenCalledWith('any-affected', 'true');
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      'Affected requested workspaces: @app/web',
    );
  });

  it('fails the action when detection fails', async () => {
    getAffectedWorkspacesMock.mockRejectedValueOnce(
      new Error('base revision is unavailable'),
    );

    await run();

    expect(vi.mocked(core.error)).toHaveBeenCalledWith(
      'Action failed: base revision is unavailable',
    );
    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
      'base revision is unavailable',
    );
  });

  it('uses defaults and reports no matches', async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'base') return 'before-sha';
      if (name === 'workspaces') return '@app/web';
      return '';
    });
    parseWorkspaceNamesMock.mockReturnValue(['@app/web']);
    getAffectedWorkspacesMock.mockResolvedValueOnce({
      affected: { '@app/web': false },
      affectedWorkspaces: [],
      anyAffected: false,
    });

    await run();

    expect(getAffectedWorkspacesMock).toHaveBeenCalledWith({
      base: 'before-sha',
      head: 'HEAD',
      turboPath: 'turbo',
      workspaces: ['@app/web'],
    });
    expect(vi.mocked(core.info)).toHaveBeenCalledWith(
      'Affected requested workspaces: none',
    );
  });

  it('fails the action for non-Error failures', async () => {
    getAffectedWorkspacesMock.mockRejectedValueOnce('unexpected failure');

    await run();

    expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('unexpected failure');
  });
});
