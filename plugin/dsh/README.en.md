# Comet DeepSeek Harness plugin

Comet is a resumable long-running workflow and Skill platform for agents. It helps you move
from requirements through implementation, verification and archiving. Task state stays in
the project, so work can continue in a new session or after an interruption.

- **Native and Classic**: Native lets the agent choose planning, implementation, testing and review methods while the Runtime checks state, verifies results and archives the work. Classic retains the complete OpenSpec and Superpowers phase workflow.
- **Comet Any and SDK**: Combine Skills, tools, user confirmations and acceptance steps into runnable, resumable workflows.
- **Personal memory and project knowledge**: Retain collaboration preferences, project structure and verified experience to reduce repeated explanations and exploration.
- **Comet Eval**: Use Rubric, Pass@k and Pass^k to record evaluation evidence and compare Skills or complete workflows. Evaluations start only when the user explicitly requests them.
- **Dashboard**: Open Comet from the DSH sidebar to view the current project, workflow progress, change details, artifacts and evaluation records. The Dashboard can also open in the right sidebar.

The plugin includes Comet Skill, workflow guards, the local Dashboard and a matching CLI.
It registers Comet Skill in DeepSeek Harness and adds a Comet sidebar entry that opens the
current session workspace's Dashboard in the main column. An npm or private-registry
install brings the matching Comet CLI and exposes `comet` in the current DSH process;
without a bundled copy, it uses the CLI on PATH. Activation mounts the official Hook
bridge without requiring a manual `comet init`. Classic dependencies follow the project
configuration.

Source, documentation and issue tracker: [https://github.com/rpamis/comet](https://github.com/rpamis/comet)

## Prepare the execution environment

Installing the plugin from npm or a private registry installs `@rpamis/comet` as a plugin
dependency at the same version, so no global CLI install is needed:

```text
dsh plugin --profile <profile> add <package name or directory>
```

On activation the plugin adds its bundled CLI's temporary entry to the current DSH
process's PATH. Skills run `comet` directly, without rewriting commands or changing the
system or user's permanent PATH. Disabling the plugin removes only its own entry and
preserves other PATH entries. Persistent shells opened before activation need a new
session or restart to inherit the environment. Without a bundled copy — a
development install that uses `link:` to a local build directory, where pnpm does not
install the linked package's dependencies — the plugin keeps using `comet` from PATH:

```text
npm install -g @rpamis/comet
comet --version
```

The CLI version must match the plugin. If that version is not published yet, run
`pnpm build` on the source branch and install it with
`npm install -g <absolute source repository path>`; never describe an older npm install as
the matching version.

## Build

From the source repository:

```text
pnpm build:dsh-plugin
```

The command prints the plugin directory, archive and version; the default output is
`dist/dsh-plugin/<version>-zh/comet-dsh-plugin/`. Use `--output-root <directory>` for
another location; existing output is never overwritten. `--language en` packages the
English Skills. `--cli-spec <pnpm spec>` overrides the CLI version or source in the
dependency and defaults to the plugin version; for local checks it can point at a
published version or a `file:` path.

## Publish to npm

`comet-dsh-plugin` and `@rpamis/comet` are separate npm packages and must be published
separately. Confirm that the matching `@rpamis/comet` version exists on public npm,
then run `pnpm build:dsh-plugin`. The source template keeps `private: true` to prevent
publishing placeholder metadata; the built package removes that flag and targets public
npm. After package tests and release-file checks pass, publish the build directory,
not the source template:

```text
npm publish dist/dsh-plugin/<version>-zh/comet-dsh-plugin --access public --dry-run
npm publish dist/dsh-plugin/<version>-zh/comet-dsh-plugin --access public
npm view comet-dsh-plugin@<version> version --registry=https://registry.npmjs.org/
```

Use `npm pack comet-dsh-plugin@<version>` afterward to confirm it can be downloaded.
A package version can only be published once. Local and private builds can still be
installed from their directory as described below.

## Install and uninstall

The plugin is an npm/Cordis bundle, so installing it makes it a bundle of that profile and
affects every session in the profile. Install the plugin directory by its absolute path
through the DSH Plugin Manager, or with the DSH CLI:

```text
dsh plugin --profile <profile> add comet-dsh-plugin --ignore-scripts
```

For local build checks, replace the package name with the absolute plugin directory.
Use `comet-dsh-plugin@<version>` to install a specific version. The public npm package
includes Chinese Skills by default.

The desktop app owns its own profile (`desktop` by default). Manage that profile with the
Desktop's own `dsh plugin` or the desktop Plugins page; a successful `--profile web`
install does not prove the desktop profile changed. Confirm Comet on the Plugins page and
select the Comet entry in the sidebar from an open conversation. Without HMR, a restart
may be needed before it appears.

Uninstalling removes only the plugin; it keeps Comet changes, Runs, Specs, knowledge and
personal memory in projects:

```text
dsh plugin --profile <profile> remove comet-dsh-plugin
```

## Dashboard startup and ownership

Selecting the sidebar Comet entry makes the Host run the resolved Comet CLI (the bundled
copy first, then PATH) for the current session's workspace:

```text
comet dashboard <absolute workspace path> --no-open
```

The plugin reads the actual address from the command output (default
`http://localhost:4321`, changing when the port is taken), starts a loopback reverse proxy
that belongs to this plugin only, and shows that proxy address in an iframe in the main
column. The proxy fills in the Host the Dashboard requires and drops the browser's Origin
and Sec-Fetch-* headers, so the Dashboard's own same-origin checks are not loosened; pages,
static assets and `/api/dashboard/...` requests all go through the same proxy. The
toolbar's **Refresh** reloads the current Dashboard, and **Open in sidebar** switches to
the Harness right Sidebar browser tab for the same service and URL.

One workspace reuses its service and proxy within one Harness process; different
workspaces start their own. Stopping or uninstalling the plugin terminates the Dashboard
processes it started and closes the proxies, so the next open starts them again; a Harness
restart does not adopt old processes and may start a new service. Refreshing, navigating
and closing a right Sidebar browser tab belong to the Harness Browser panel, and closing
the tab does not stop the service. Without an open conversation the entry reports that a
conversation is required.

A missing CLI, an unavailable workspace or a failed Dashboard start is reported in the
main column instead of failing silently. Viewing the Dashboard grants no Eval run.

## Existing file-based installs

Installation also brings the official `@deepseek-ai/dsh-hooks-claude-code` bridge and
its runtime dependencies. Activation mounts `SessionStart` and `PreToolUse` for this
profile: new sessions receive the workflow rules and writes use the existing Comet
Router. No manual `comet init` is required. Private configuration lives under
`DSH_HOME/comet-plugin/` (default `~/.dsh/comet-plugin/`); the plugin does not rewrite
profile patches or copy project rules. Disabling or uninstalling it disposes the bridge.
The `integration` field in `/comet-plugin/status` reports preparation failures.

Only after the new Hook actually executes does it remove old Comet-owned Router/Guard
definitions from the current Git project's Hook file, preserving other user Hooks.
An existing session snapshot may run an old definition once more; start a new session
to receive updated rules.

`comet init` installs Skills into the project's `.dsh/skills` or the user directory. The
plugin registers runtime Skills; under the DSH precedence rules, same-name Skills in the
project directory win. When the new Hook executes, it backs up and removes recognized
legacy `SKILL.md` entry points from discovery so the plugin can take over. Content hashes
cover unmodified known releases from 0.4.0 through 0.5.2 and current-build definitions. Runtime, references, shared
Skills, project data and other platforms remain. Customized or unknown entries are kept
and reported. Only Comet-owned Hook definitions and matching `COMET:DSH` rule blocks are
migrated; user content outside them remains. Repeated migration is safe and no global CLI
uninstall is needed.

Backups and reports live under `DSH_HOME/comet-plugin/migration-backups/` and
`migration-reports/`. Use a new session or restart to load the updated Skill inventory.
For rollback, disable the plugin, review each receipt's `source` and `backup`, then restore
the entry. Merge Comet portions of mixed configuration instead of overwriting later edits.

## Updates

Update the plugin through its current installation channel and reinstall the built output;
a bundled CLI updates with the plugin version, while a PATH CLI is updated through its own
npm channel. Rebuild into a new directory and install the new package through the same
channel; restart DSH if the page does not update. Check Skills, CLI versions and bridge
status in a new session. Updates preserve file-based Skills and the user's profile patch.
