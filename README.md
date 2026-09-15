# Turborepo affected workspaces

This GitHub Action reports which requested Turborepo workspaces are affected
between two Git revisions. It only performs detection; callers retain control
of installation, deployment, secrets, environments, and concurrency.

## Use

In the calling repository's workflow, check out the base revision and install
dependencies before invoking the action.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- run: pnpm install --frozen-lockfile

- uses: pixpilot/turbo-affected@v1
  id: affected
  with:
    base: ${{ github.event.before }}
    workspaces: |
      @app/web
      @app/chrome-extension
    turbo-path: ./node_modules/.bin/turbo
```

`workspaces` accepts actual package names, separated by new lines or commas.
`head` defaults to `HEAD`; provide it only when the comparison target differs.
`turbo-path` defaults to `turbo` on `PATH`.

Gate an app-specific deployment with the generic JSON map:

```yaml
- name: Deploy web
  if: ${{ fromJSON(steps.affected.outputs.affected)['@app/web'] }}
  run: ./scripts/deploy-web
```

The action also emits `affected-workspaces` as a JSON array and `any-affected`
as `true` or `false`.

## Detection

The action verifies `base` and `head` with `git rev-parse`, uses `turbo ls
--output=json` to validate requested package names, then runs:

```text
TURBO_SCM_BASE=<base> TURBO_SCM_HEAD=<head> turbo ls --affected --output=json
```

It filters Turbo's affected package list to the requested workspaces. Unknown
workspace names, unavailable Git history, malformed Turbo output, and Turbo
command failures fail the workflow; none are reported as unaffected.

Turbo 2.1 or newer is required because it introduced `turbo ls --affected`.
Turbo currently documents `--output=json` for `turbo ls --affected` as
experimental, so test upgrades of Turbo in your repositories before relying on
them for production deployment gating.

## Requirements

- Install dependencies and make the Turbo executable available before calling
  this action. Use `turbo-path` for a local executable when it is not on `PATH`.
- Fetch enough Git history for the supplied `base`; `fetch-depth: 0` is the
  safest default.
- Declare internal workspace dependencies in each package's `package.json`.
- Configure Turborepo's global dependencies so root lockfiles, TypeScript
  configuration, and build configuration that affect applications participate
  in its dependency graph.

## Verify

1. Change an application and confirm it appears in `affected-workspaces`.
2. Change a shared workspace and confirm every declared dependent application
   appears in `affected-workspaces`.
3. Change no files between `base` and `head` and confirm `any-affected` is
   `false`.

## Gotchas

- This action relies on the consuming repository's Turbo graph; undeclared
  dependencies or incomplete global dependency configuration can make results
  incomplete.
- Do not use a shallow checkout when the supplied `base` may not be present.
