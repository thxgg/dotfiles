# shadcn-vue Registry Authoring

Use this reference when creating, publishing, or consuming a Vue component registry. Read repository instructions first and use the project's package runner for every CLI command.

## Mental Model

A registry distributes source code, dependencies, CSS variables, and CSS rules. It is not an npm component library.

- `registry.json` is the source manifest used by `shadcn-vue build`.
- Each entry becomes an installable registry-item JSON payload.
- Consumers install a payload by configured registry name, direct URL, or local path.
- The CLI resolves aliases and destinations from the consumer's `components.json`.

## Root `registry.json`

Use the Vue schema:

```json
{
  "$schema": "https://shadcn-vue.com/schema/registry.json",
  "name": "acme",
  "homepage": "https://example.com",
  "items": [
    {
      "name": "hello-world",
      "type": "registry:component",
      "title": "Hello World",
      "description": "A reusable Vue greeting component.",
      "files": [
        {
          "path": "registry/new-york/hello-world/HelloWorld.vue",
          "type": "registry:component"
        }
      ]
    }
  ]
}
```

The manifest must validate against `https://shadcn-vue.com/schema/registry.json`; individual payloads use `https://shadcn-vue.com/schema/registry-item.json`.

## Item Types

Choose the narrowest appropriate type:

| Type | Use for |
|---|---|
| `registry:ui` | UI primitives and wrapper components |
| `registry:component` | Reusable components |
| `registry:block` | Multi-file features or composed sections |
| `registry:page` | Pages or file-based routes; requires a target |
| `registry:lib` | Libraries and utilities |
| `registry:composable` | Vue composables |
| `registry:hook` | Compatibility/legacy hook items |
| `registry:file` | Other files; requires a target |
| `registry:style` | Component/style presets |
| `registry:theme` | Theme variables |
| `registry:item` | Generic registry items that do not fit a narrower public type |
| `registry:base` | Base configuration items; may include a partial `config` object |
| `registry:font` | Font definitions; requires `font` metadata |

A `registry:font` item requires `font.family`, Google `font.provider`, `font.import`, and `font.variable`; optional fields include weights and subsets. A `registry:base` item may provide partial shadcn-vue configuration through `config`.

## Dependencies

Keep package and registry dependencies separate:

```json
{
  "dependencies": ["reka-ui", "zod@^4.0.0"],
  "registryDependencies": [
    "button",
    "input",
    "https://example.com/r/editor.json"
  ]
}
```

- `dependencies` contains npm packages, optionally versioned.
- `registryDependencies` contains registry item names or complete item URLs.
- List every dependency; do not rely on transitive installation.
- Never put credentials or long-lived tokens in a tracked registry URL.

## Files and Targets

Every file needs a source `path` and registry `type`. `registry:page` and `registry:file` also require `target`:

```json
{
  "files": [
    {
      "path": "registry/new-york/login/LoginForm.vue",
      "type": "registry:component"
    },
    {
      "path": "registry/new-york/login/page.vue",
      "type": "registry:page",
      "target": "pages/login/index.vue"
    }
  ]
}
```

Use `~/` in a target to refer to the consumer project root. Let normal component, composable, and library types resolve through `components.json` aliases rather than hardcoding consumer paths.

## Vue Authoring Rules

- Author Vue SFCs with `<script setup lang="ts">` unless the registry explicitly targets JavaScript.
- Keep source under a predictable `registry/[STYLE]/[NAME]/` tree.
- In registry source, use the registry's canonical imports (commonly `@/registry/...`) so the builder can transform them.
- Preserve consumer aliases and icon conventions after installation; third-party files may require an import review.
- Put reusable UI in components, Vue stateful helpers in composables, and framework-light helpers in lib.
- Use `cssVars.theme`, `cssVars.light`, and `cssVars.dark` for theme values. For Tailwind v4, prefer registry `css` and `cssVars` over the deprecated `tailwind` field.
- Use the `docs` field for required post-install steps such as environment variables, but never embed secret values.

## Build

From the registry project root:

```bash
pnpm dlx shadcn-vue@latest build
# Custom manifest/output:
pnpm dlx shadcn-vue@latest build ./registry.json --output ./public/r
```

The default output is `public/r/<item>.json`. Do not launch a development server when repository instructions say one is already running.

## Consume and Verify

Inspect the payload before installation:

```bash
pnpm dlx shadcn-vue@latest view https://example.com/r/hello-world.json
```

The current Vue CLI exposes `add --dry-run`, `--diff`, and `--view` in help but does not implement them. To inspect transformed output safely, install the item in a disposable scratch Vue project with equivalent `components.json` settings, never over a customized working tree.

Then verify:

1. Build the registry without schema errors.
2. Inspect generated payloads for expected files, dependencies, CSS, and documentation.
3. Test installation in a disposable Vue project or scratch worktree.
4. Confirm aliases and destinations resolve correctly.
5. Read every installed file and check imports, icon conventions, accessibility, and local component composition.
6. Run the consumer project's formatter, type checker, tests, and build as required by its repository instructions.

Never use `--overwrite` against customized consumer components without explicit approval.

## Official References

- `https://shadcn-vue.com/docs/registry/getting-started`
- `https://shadcn-vue.com/docs/registry/registry-json`
- `https://shadcn-vue.com/docs/registry/registry-item-json`
- `https://shadcn-vue.com/docs/registry/examples`
