import { execFile } from 'node:child_process';
import process from 'node:process';

/** Options passed to a command used for affected-workspace detection. */
export interface CommandOptions {
  readonly env?: NodeJS.ProcessEnv;
}

/** Executes a command without using a shell. */
export type CommandRunner = (
  command: string,
  arguments_: readonly string[],
  options: CommandOptions,
) => Promise<string>;

/** Parameters used to find affected Turborepo workspaces. */
export interface GetAffectedWorkspacesInput {
  readonly base: string;
  readonly head: string;
  readonly turboPath: string;
  readonly workspaces: readonly string[];
}

/** The generic result exposed by the GitHub Action outputs. */
export interface AffectedWorkspaceResult {
  readonly affected: Readonly<Record<string, boolean>>;
  readonly affectedWorkspaces: readonly string[];
  readonly anyAffected: boolean;
}

interface TurboPackage {
  readonly name: string;
}

interface TurboPackageOutput {
  readonly packages: {
    readonly items: readonly TurboPackage[];
  };
}

/** Splits the action input into distinct, non-empty workspace package names. */
export function parseWorkspaceNames(value: string): string[] {
  const workspaces = value
    .split(/[\n,]/u)
    .map((workspace) => workspace.trim())
    .filter(Boolean);

  if (workspaces.length === 0) {
    throw new Error('The "workspaces" input must contain at least one package name.');
  }

  return [...new Set(workspaces)];
}

/** Finds requested workspaces affected between two Git revisions through Turbo. */
export async function getAffectedWorkspaces(
  input: GetAffectedWorkspacesInput,
  commandRunner: CommandRunner = executeCommand,
): Promise<AffectedWorkspaceResult> {
  const base = ensureRevisionInput(input.base, 'base');
  const head = ensureRevisionInput(input.head, 'head');
  const turboPath = input.turboPath.trim() || 'turbo';

  await ensureGitRevision(commandRunner, base, 'base');
  await ensureGitRevision(commandRunner, head, 'head');

  const availableWorkspaces = await listTurboPackages(
    commandRunner,
    turboPath,
    'workspace listing',
  );
  const unknownWorkspaces = input.workspaces.filter(
    (workspace) => !availableWorkspaces.has(workspace),
  );

  if (unknownWorkspaces.length > 0) {
    throw new Error(
      `Requested Turborepo workspace(s) do not exist: ${unknownWorkspaces.join(', ')}`,
    );
  }

  const affectedPackages = await listTurboPackages(
    commandRunner,
    turboPath,
    'affected-workspace detection',
    {
      ...process.env,
      TURBO_SCM_BASE: base,
      TURBO_SCM_HEAD: head,
    },
    ['--affected'],
  );
  const affectedWorkspaces = input.workspaces.filter((workspace) =>
    affectedPackages.has(workspace),
  );
  const affected = Object.fromEntries(
    input.workspaces.map((workspace) => [workspace, affectedPackages.has(workspace)]),
  );

  return {
    affected,
    affectedWorkspaces,
    anyAffected: affectedWorkspaces.length > 0,
  };
}

function ensureRevisionInput(revision: string, inputName: 'base' | 'head'): string {
  const trimmedRevision = revision.trim();

  if (!trimmedRevision) {
    throw new Error(`The "${inputName}" input must contain a Git revision.`);
  }

  return trimmedRevision;
}

async function ensureGitRevision(
  commandRunner: CommandRunner,
  revision: string,
  inputName: 'base' | 'head',
): Promise<void> {
  try {
    await commandRunner(
      'git',
      ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`],
      {},
    );
  } catch {
    throw new Error(
      `The ${inputName} revision "${revision}" is unavailable locally. Check out sufficient Git history, such as actions/checkout with fetch-depth: 0.`,
    );
  }
}

async function listTurboPackages(
  commandRunner: CommandRunner,
  turboPath: string,
  purpose: string,
  env: NodeJS.ProcessEnv | undefined = undefined,
  flags: readonly string[] = [],
): Promise<Set<string>> {
  try {
    const output = await commandRunner(turboPath, ['ls', ...flags, '--output=json'], {
      env,
    });
    return parseTurboPackageNames(output, purpose);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Turbo returned malformed JSON')
    ) {
      throw error;
    }

    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Turborepo ${purpose} failed: ${details}`);
  }
}

function parseTurboPackageNames(output: string, purpose: string): Set<string> {
  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(output);
  } catch {
    throw new Error(`Turbo returned malformed JSON during ${purpose}.`);
  }

  if (!isTurboPackageOutput(parsedOutput)) {
    throw new Error(`Turbo returned malformed JSON during ${purpose}.`);
  }

  return new Set(parsedOutput.packages.items.map((item) => item.name));
}

function isTurboPackageOutput(value: unknown): value is TurboPackageOutput {
  if (
    !isRecord(value) ||
    !isRecord(value.packages) ||
    !Array.isArray(value.packages.items)
  ) {
    return false;
  }

  return value.packages.items.every(
    (item): item is TurboPackage => isRecord(item) && typeof item.name === 'string',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function executeCommand(
  command: string,
  arguments_: readonly string[],
  options: CommandOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      arguments_,
      { cwd: process.cwd(), encoding: 'utf8', env: options.env },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });
}
