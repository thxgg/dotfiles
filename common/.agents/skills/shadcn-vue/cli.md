# shadcn-vue CLI Reference

Configuration is read from `components.json`.

> **IMPORTANT:** Always run commands using the project's package runner: `npx shadcn-vue@latest`, `pnpm dlx shadcn-vue@latest`, or `bunx --bun shadcn-vue@latest`. Check `packageManager` from project context to choose the right one. Examples below use `npx shadcn-vue@latest` but substitute the correct runner for the project.
> **IMPORTANT:** Do not invent flags. Treat this as a workflow reference, not an exhaustive substitute for `<command> --help`; verify the installed/latest CLI before acting. The CLI auto-detects the package manager from the project's lockfile; there is no `--package-manager` flag.

## Contents

- Commands: init, apply, add, search, view, docs, info, build
- Templates: nuxt, vite, astro, laravel
- Presets: named, code, URL formats and fields
- Switching presets

---

## Commands

### `init` — Initialize or create a project

```bash
npx shadcn-vue@latest init [components...] [options]
```

Initializes shadcn-vue in an existing project or creates a new project (when `--name` is provided). Optionally installs components in the same step.

| Flag                    | Short | Description                                         | Default |
| ----------------------- | ----- | --------------------------------------------------- | ------- |
| `--template <template>` | `-t`  | Template (nuxt, vite, astro, laravel)               | —       |
| `--preset [name]`       | `-p`  | Preset configuration (named, code, or URL)          | —       |
| `--yes`                 | `-y`  | Skip confirmation prompt                            | `true`  |
| `--defaults`            | `-d`  | Use defaults (`--template=nuxt --preset=nova`) | `false` |
| `--force`               | `-f`  | Force overwrite existing configuration              | `false` |
| `--cwd <cwd>`           | `-c`  | Working directory                                   | current |
| `--name <name>`         | `-n`  | Name for new project                                | —       |
| `--silent`              | `-s`  | Mute output                                         | `false` |
| `--rtl`                 |       | Enable RTL support                                  | —       |
| `--reinstall`           |       | Re-install existing UI components                   | `false` |

`npx shadcn-vue@latest create` is an alias for `npx shadcn-vue@latest init`.

### `apply` — Apply a preset to an existing project

```bash
npx shadcn-vue@latest apply [preset] [options]
```

Applies a preset to an existing project, overwriting preset-driven config, fonts, CSS variables, and detected UI components. In a customized project, do not run this command without explicit approval.

| Flag                | Short | Description                                | Default |
| ------------------- | ----- | ------------------------------------------ | ------- |
| `--preset <preset>` | —     | Preset configuration (named, code, or URL) | —       |
| `--yes`             | `-y`  | Skip confirmation prompt                   | `false` |
| `--cwd <cwd>`       | `-c`  | Working directory                          | current |
| `--silent`          | `-s`  | Mute output                                | `false` |

`[preset]` is a shorthand for `--preset <preset>`. If both are provided, they must match.
A preset is required. If none is provided, the CLI exits and lists the available named presets.

### `add` — Add components

> **IMPORTANT:** NEVER fetch raw files from GitHub or other sources manually. The CLI handles registry resolution, file paths, and CSS diffing automatically.

```bash
npx shadcn-vue@latest add [components...] [options]
```

Accepts component names, registry-prefixed names (`@magicui/shimmer-button`), URLs, or local paths.

| Flag            | Short | Description                                                                                                          | Default |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| `--yes`         | `-y`  | Skip confirmation prompt                                                                                             | `false` |
| `--overwrite`   | `-o`  | Overwrite existing files                                                                                             | `false` |
| `--cwd <cwd>`   | `-c`  | Working directory                                                                                                    | current |
| `--all`         | `-a`  | Add all available components                                                                                         | `false` |
| `--path <path>` | `-p`  | Target path for the component                                                                                        | —       |
| `--silent`      | `-s`  | Mute output                                                                                                          | `false` |
| `--css-variables` / `--no-css-variables` | — | Control CSS-variable use when applicable                                                | enabled |

#### Inspecting Updates Safely

The CLI currently exposes `add --dry-run`, `--diff`, and `--view` in help but exits because these options are not implemented. Use the standalone `view` command and the manual scratch-project workflow in [Updating Components in SKILL.md](./SKILL.md#updating-components).

### `search` — Search registries

```bash
npx shadcn-vue@latest search <registries...> [options]
```

Fuzzy search across registries. Also aliased as `npx shadcn-vue@latest list`. Without `-q`, lists all items.

| Flag                | Short | Description            | Default |
| ------------------- | ----- | ---------------------- | ------- |
| `--query <query>`   | `-q`  | Search query           | —       |
| `--limit <number>`  | `-l`  | Max items per registry | `100`   |
| `--offset <number>` | `-o`  | Items to skip          | `0`     |
| `--cwd <cwd>`       | `-c`  | Working directory      | current |

### `view` — View item details

```bash
npx shadcn-vue@latest view <items...> [options]
```

Displays item info including file contents. Example: `npx shadcn-vue@latest view @shadcn/button`.

### `docs` — Get component documentation URLs

```bash
npx shadcn-vue@latest docs <components...> [options]
```

Outputs resolved URLs for component documentation, examples, and API references. Accepts one or more component names. Fetch the URLs to get the actual content.

Example output for `npx shadcn-vue@latest docs input button`:

```text
input
  docs      https://shadcn-vue.com/docs/components/input
  examples  https://raw.githubusercontent.com/.../examples/InputExample.vue

button
  docs      https://shadcn-vue.com/docs/components/button
  examples  https://raw.githubusercontent.com/.../examples/ButtonExample.vue
```

Some components include an `api` link to the underlying library (e.g. `reka-ui` for the primitive components).

### `diff` — Check for updates

```bash
npx shadcn-vue@latest diff [component]
```

This standalone command is implemented and non-mutating. With no component it lists installed registry components that have updates; with a component it prints transformed file diffs. Use it as a comparison aid, then review customized wrappers manually. This is distinct from the unsupported `add --diff` option.

### `info` — Project information

```bash
npx shadcn-vue@latest info [options]
```

Displays project info and `components.json` configuration. Run this first to discover the project's framework, aliases, Tailwind version, and resolved paths. Some legacy configurations do not report a separate base or installed-component list; inspect `package.json`, `components.json`, and `resolvedPaths.ui` rather than guessing.

| Flag          | Short | Description       | Default |
| ------------- | ----- | ----------------- | ------- |
| `--cwd <cwd>` | `-c`  | Working directory | current |
| `--json`      | —     | Output JSON       | `false` |

**Project Info fields:**

| Field                | Type      | Meaning                                                 |
| -------------------- | --------- | ------------------------------------------------------- |
| `framework`          | `object`  | Detected framework metadata, including name and documentation links |
| `typescript`         | `boolean` | Whether the project uses TypeScript                     |
| `isSrcDir`           | `boolean` | Whether the project uses a `src/` directory             |
| `tailwindVersion`    | `string`  | `"v3"` or `"v4"`                                        |
| `tailwindConfigFile` | `string`  | Path to the Tailwind config file                        |
| `tailwindCssFile`    | `string`  | Path to the global CSS file                             |
| `aliasPrefix`        | `string`  | Import alias prefix (e.g. `@`, `~`, `@/`)               |
| `packageManager`     | `string`  | Detected package manager (`npm`, `pnpm`, `yarn`, `bun`) |

**Components.json fields:**

| Field                | Type      | Meaning                                                                                     |
| -------------------- | --------- | --------------------------------------------------------------------------------------------|
| `style`              | `string`  | Complete registry style identifier, e.g. `new-york`, `new-york-v4`, or `reka-nova`; 2.7.4 has no separate config `base` field |
| `typescript`         | `boolean` | TypeScript flag                                                                             |
| `tailwind.config`    | `string`  | Tailwind config path                                                                        |
| `tailwind.css`       | `string`  | Global CSS path — this is where custom CSS variables go                                     |
| `iconLibrary`        | `string`  | Icon library — determines icon import package (e.g. `@lucide/vue`, `@tabler/icons-vue`) |
| `aliases.components` | `string`  | Component import alias (e.g. `@/components`)                                                |
| `aliases.utils`      | `string`  | Utils import alias (e.g. `@/lib/utils`)                                                     |
| `aliases.ui`         | `string`  | UI component alias (e.g. `@/components/ui`)                                                 |
| `aliases.lib`        | `string`  | Lib alias (e.g. `@/lib`)                                                                    |
| `aliases.composables`| `string`  | Composables/Hooks alias (e.g. `@/composables`)                                              |
| `resolvedPaths`      | `object`  | Absolute file-system paths for each alias                                                   |
| `registries`         | `object`  | Configured custom registries                                                                |

**Links fields:**

The `info` output includes a **Links** section with templated URLs for component docs, source, and examples. For resolved URLs, use `npx shadcn-vue@latest docs <component>` instead.

### `build` — Build a custom registry

```bash
npx shadcn-vue@latest build [registry] [options]
```

Builds `registry.json` into individual JSON files for distribution. Default input: `./registry.json`, default output: `./public/r`.

| Flag              | Short | Description       | Default      |
| ----------------- | ----- | ----------------- | ------------ |
| `--output <path>` | `-o`  | Output directory  | `./public/r` |
| `--cwd <cwd>`     | `-c`  | Working directory | current      |

---

## Templates

| Value   | Framework |
| ------- | --------- |
| `nuxt`  | Nuxt      |
| `vite`  | Vite      |
| `astro` | Astro     |
| `laravel` | Laravel |

---

## Presets

Three ways to specify a preset via `--preset`:

1. **Named:** `--preset nova` or `--preset lyra`
2. **Code:** `--preset a2r6bw` (version-prefixed base62 string, e.g. `a2r6bw`)
3. **URL:** `--preset "https://shadcn-vue.com/init?base=reka&style=nova&..."`

> **IMPORTANT:** Never try to decode, fetch, or resolve preset codes manually. Preset codes are opaque — pass them directly to `npx shadcn-vue@latest init --preset <code>` and let the CLI handle resolution.
> Use `npx shadcn-vue@latest apply --preset <code>` only when the user explicitly approves overwriting an existing project's preset and detected wrappers.

## Switching Presets

Ask the user first: **overwrite**, **merge**, or **skip** existing components?

- **Overwrite / Re-install** → `npx shadcn-vue@latest apply --preset <code>`. Overwrites all detected component files with the new preset styles. Use only with explicit approval when components are not customized.
- **Merge** → `npx shadcn-vue@latest init --preset <code> --force --no-reinstall`, inspect wrappers in the resolved UI directory, and use the [manual update workflow](./SKILL.md#updating-components) one component at a time. Use when the user has customized components.
- **Skip** → `npx shadcn-vue@latest init --preset <code> --force --no-reinstall`. Only updates config and CSS variables, leaves existing components as-is.

Always run preset commands inside the user's project directory. `apply` only works in an existing project with a `components.json` file and can reinstall wrappers. The CLI currently supports the Reka base. Preset codes include a base for initialization, while `apply` deliberately preserves the current project's base. If a legacy configuration does not report a separate base, do not invent one; inspect the resolved registry style and dependencies.
