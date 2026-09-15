import * as core from '@actions/core';

import { getAffectedWorkspaces, parseWorkspaceNames } from './get-affected-workspaces';

/**
 * Runs affected-workspace detection and publishes the GitHub Actions outputs.
 */
export async function run(): Promise<void> {
  try {
    const result = await getAffectedWorkspaces({
      base: core.getInput('base', { required: true }),
      head: core.getInput('head') || 'HEAD',
      workspaces: parseWorkspaceNames(core.getInput('workspaces', { required: true })),
      turboPath: core.getInput('turbo-path') || 'turbo',
    });

    core.setOutput('affected', JSON.stringify(result.affected));
    core.setOutput('affected-workspaces', JSON.stringify(result.affectedWorkspaces));
    core.setOutput('any-affected', String(result.anyAffected));
    core.info(
      `Affected requested workspaces: ${result.affectedWorkspaces.join(', ') || 'none'}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.error(`Action failed: ${errorMessage}`);
    core.setFailed(errorMessage);
  }
}
