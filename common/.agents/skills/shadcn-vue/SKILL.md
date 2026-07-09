---
name: shadcn-vue
description: Manages shadcn-vue components and Vue/Nuxt projects — adding, searching, fixing, debugging, styling, composing UI, authoring registries, and using provided utilities. Load for shadcn-vue, Reka UI wrappers, Vue component registries, presets, or Vue/Nuxt projects with components.json.
user-invocable: false
allowed-tools: Bash(npx shadcn-vue@latest *), Bash(pnpm dlx shadcn-vue@latest *), Bash(bunx --bun shadcn-vue@latest *)
---

# shadcn-vue

A framework for building UI, components, and design systems. Components are added as source code to the user's project via the CLI.

> **IMPORTANT:** Run all CLI commands from the project root using the project's package runner: `npx shadcn-vue@latest`, `pnpm dlx shadcn-vue@latest`, or `bunx --bun shadcn-vue@latest` — based on `packageManager`. Examples below use `npx shadcn-vue@latest`; substitute the correct runner.

## Mandatory Preflight

Do not assume a harness expanded an inline shell expression in this file. Pi does not preprocess skill Markdown.

1. Read the nearest repository `AGENTS.md` files and inspect `components.json` and `package.json`. Repository instructions and existing component APIs override generic rules in this skill.
2. From the project root, run `<runner> shadcn-vue@latest info --json` (for pnpm: `pnpm dlx shadcn-vue@latest info --json`).
3. Inspect the resolved UI directory and existing wrappers. Legacy styles may not make `info` report the base or installed components, so do not infer that a component is absent from the JSON alone.
4. Run `<runner> shadcn-vue@latest docs <component>` before creating, fixing, or updating a component.

## Existing Project Precedence

Treat shadcn-vue as open code, not generated code that must match upstream. Preserve intentional wrapper APIs, styling, accessibility fixes, and framework conventions. Never replace a customized wrapper merely because it differs from the registry.

For the CODE Hospitality admin portal specifically:

- Use Vue 3 `<script setup>` and Nuxt conventions from its `AGENTS.md` files.
- Render Lucide icons with `<Icon name="lucide:..." />`; do not add direct icon-library imports in app code.
- Use the existing vee-validate `FormField`/`FormItem` abstractions for validated forms. Use `Field` primitives only where the local form conventions call for them.
- The customized `Button` supports `loading`; preserve and use that local API.
- Preserve the outline focus system, 32px control rhythm, Linear-like design language, and the blur-on-open workaround in portaled wrappers.
- Use existing `Callout` and `AlertBanner` components; do not import a nonexistent stock `Alert` wrapper.
- Do not import Reka UI components directly outside `@/components/ui`; Reka types and composables are allowed.
- Do not run the already-running development server.
- Do not use `apply`, `--overwrite`, or re-add an installed component without explicit approval. The current Vue CLI exposes but does not implement `add --dry-run`, `--diff`, or `--view`; use the non-mutating standalone `view` and `diff` commands, then merge manually.

## Principles

1. **Use existing components first.** Use `npx shadcn-vue@latest search` to check registries before writing custom UI. Check community registries too.
2. **Compose, don't reinvent.** Settings page = Tabs + Card + form controls. Dashboard = Sidebar + Card + Chart + Table.
3. **Use built-in variants before custom styles.** `variant="outline"`, `size="sm"`, etc.
4. **Use semantic colors.** `bg-primary`, `text-muted-foreground` — never raw values like `bg-blue-500`.

## Critical Rules

These rules are **always enforced**. Each links to a file with Incorrect/Correct code pairs.

### Styling & Tailwind → [styling.md](./rules/styling.md)

- **`class` for layout, not styling.** Never override component colors or typography.
- **No `space-x-*` or `space-y-*`.** Use `flex` with `gap-*`. For vertical stacks, `flex flex-col gap-*`.
- **Use `size-*` when width and height are equal.** `size-10` not `w-10 h-10`.
- **Use `truncate` shorthand.** Not `overflow-hidden text-ellipsis whitespace-nowrap`.
- **No manual `dark:` color overrides.** Use semantic tokens (`bg-background`, `text-muted-foreground`).
- **Use `cn()` for conditional classes.** Don't write manual template literal ternaries.
- **No manual `z-index` on overlay consumers.** Dialog, Sheet, Popover, etc. should normally use their wrapper's stacking. Existing wrapper implementations may intentionally define stacking.
- **Prefer provided utilities over custom animations.** Check local CSS and the selected Vue registry before writing keyframes; do not assume React or unreleased utilities exist. Preserve a project's existing utility, such as the admin portal's `text-shimmer`.

### Forms & Inputs → [forms.md](./rules/forms.md)

- **Use the project's form abstraction.** Stock shadcn-vue forms use `FieldGroup` + `Field`; established vee-validate projects may use `FormField` + `FormItem`. Inspect local wrappers before choosing.
- **`InputGroup` uses `InputGroupInput`/`InputGroupTextarea`.** Never raw `Input`/`Textarea` inside `InputGroup`.
- **Buttons inside inputs use `InputGroup` + `InputGroupAddon`.**
- **Choose controls by semantics.** Use `ToggleGroup` for pressed-button or segmented controls and `RadioGroup` for a standard single-choice form field. Don't loop `Button` with manual active state.
- **`FieldSet` + `FieldLegend` for grouping related checkboxes/radios.** Don't use a `div` with a heading.
- **Field validation uses `data-invalid` + `aria-invalid`.** `data-invalid` on `Field`, `aria-invalid` on the control. For disabled: `data-disabled` on `Field`, `disabled` on the control.

### Component Structure → [composition.md](./rules/composition.md)

- **Use Group components for real groups.** Wrap labeled or visually separated item sections in their matching Group; direct items are valid when no semantic grouping is needed.
- **Dialog, Sheet, and Drawer always need a Title.** `DialogTitle`, `SheetTitle`, `DrawerTitle` required for accessibility. Use `class="sr-only"` if visually hidden.
- **Use full Card composition.** `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`. Don't dump everything in `CardContent`.
- **Inspect the local Button API.** Stock Button has no `isPending`/`isLoading`, so compose with `Spinner` + `data-icon` + `disabled`; preserve project extensions such as an existing `loading` prop.
- **`TabsTrigger` must be inside `TabsList`.** Never render triggers directly in `Tabs`.
- **`Avatar` always needs `AvatarFallback`.** For when the image fails to load.

### Use Components, Not Custom Markup → [composition.md](./rules/composition.md)

- **Use existing components before custom markup.** Check if a component exists before writing a styled `div`.
- **Use the project's callout component.** Stock projects may use `Alert`; the admin portal uses `Callout` and `AlertBanner`. Don't build ad hoc styled divs.
- **Empty states use `Empty`.** Don't build custom empty state markup.
- **Toast via `vue-sonner`.** Use `toast()` from `vue-sonner`.
- **Use `Separator`** instead of `<hr>` or `<div class="border-t">`.
- **Use `Skeleton`** for loading placeholders. No custom `animate-pulse` divs.
- **Use `Badge`** instead of custom styled spans.

### Icons → [icons.md](./rules/icons.md)

- **Follow the repository's icon policy first.** Otherwise use the configured `iconLibrary`.
- **Icons in `Button` use `data-icon` when the wrapper expects it.** Use `data-icon="inline-start"` or `data-icon="inline-end"`.
- **No sizing classes on icons inside components.** Components handle icon sizing via CSS unless the local wrapper says otherwise.
- **Pass imported icons as component objects, not lookup strings.** Projects using Nuxt Icon should follow their established `<Icon name="..." />` convention instead.

### CLI

- **Apply preset codes only with explicit approval.** `apply` can reinstall components and overwrite local design-system work. Use it for an existing project only after reviewing the impact; use `init --preset <code>` when initializing a new project.

## Key Patterns

These are the most common patterns that differentiate correct shadcn-vue code. For edge cases, see the linked rule files above.

```html
<!-- Form layout: FieldGroup + Field, not div + Label. -->
<FieldGroup>
  <Field>
    <FieldLabel for="email">Email</FieldLabel>
    <Input id="email" />
  </Field>
</FieldGroup>

<!-- Validation: data-invalid on Field, aria-invalid on the control. -->
<Field data-invalid>
  <FieldLabel>Email</FieldLabel>
  <Input aria-invalid />
  <FieldError>Invalid email.</FieldError>
</Field>

<!-- Icons in buttons: data-icon, no sizing classes. -->
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

<!-- Spacing: gap-*, not space-y-*. -->
<div class="flex flex-col gap-4">  <!-- correct -->
<div class="space-y-4">           <!-- wrong -->

<!-- Equal dimensions: size-*, not w-* h-*. -->
<Avatar class="size-10">   <!-- correct -->
<Avatar class="w-10 h-10"> <!-- wrong -->

<!-- Status colors: Badge variants or semantic tokens, not raw colors. -->
<Badge variant="secondary">+20.1%</Badge>    <!-- correct -->
<span class="text-emerald-600">+20.1%</span> <!-- wrong -->
```

## Component Selection

| Need                       | Use                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Button/action              | `Button` with appropriate variant                                                                   |
| Form inputs                | `Input`, `Select`, `Combobox`, `Switch`, `Checkbox`, `RadioGroup`, `Textarea`, `InputOTP`, `Slider` |
| Toggle between 2–7 options | `ToggleGroup` + `ToggleGroupItem`                                                                   |
| Data display               | `Table`, `Card`, `Badge`, `Avatar`                                                                  |
| Navigation                 | `Sidebar`, `NavigationMenu`, `Breadcrumb`, `Tabs`, `Pagination`                                     |
| Overlays                   | `Dialog` (modal), `Sheet` (side panel), `Drawer` (bottom sheet), `AlertDialog` (confirmation)       |
| Feedback                   | `vue-sonner` (toast), `Alert`, `Progress`, `Skeleton`, `Spinner`                                   |
| Command palette            | `Command` inside `Dialog`                                                                           |
| Charts                     | `Chart` (wraps Unovis)                                                                              |
| Layout                     | `Card`, `Separator`, `Resizable`, `ScrollArea`, `Accordion`, `Collapsible`                          |
| Empty states               | `Empty`                                                                                             |
| Menus                      | `DropdownMenu`, `ContextMenu`, `Menubar`                                                            |
| Tooltips/info              | `Tooltip`, `HoverCard`, `Popover`                                                                   |

## Key Fields

The injected project context contains these key fields:

- **`aliases`** → use the actual alias prefix for imports (e.g. `@/`, `~/`), never hardcode.
- **`tailwindVersion`** → `"v4"` uses `@theme inline` blocks; `"v3"` uses `tailwind.config.js`.
- **`tailwindCssFile`** → the global CSS file where custom CSS variables are defined. Always edit this file, never create a new one.
- **`style`** → complete registry style identifier, such as legacy `new-york`/`new-york-v4` or composed `reka-nova`/`reka-vega`. shadcn-vue 2.7.4 does not store a separate `base` field in `components.json`.
- **`iconLibrary`** → determines generated registry imports. Repository icon conventions still take precedence (for example, Nuxt Icon may intentionally replace direct imports).
- **`resolvedPaths`** → exact file-system destinations for components, utils, hooks, etc.
- **`framework`** → routing and file conventions (e.g. Nuxt vs Vite SPA).
- **`packageManager`** → use this for any non-shadcn-vue dependency installs (e.g. `pnpm add date-fns` vs `npm install date-fns`).

See [cli.md — `info` command](./cli.md) for the full field reference.

## Component Docs, Examples, and Usage

Run `npx shadcn-vue@latest docs <component>` to get the URLs for a component's documentation, examples, and API reference. Fetch these URLs to get the actual content.

```bash
npx shadcn-vue@latest docs button dialog select
```

**When creating, fixing, debugging, or using a component, always run `npx shadcn-vue@latest docs` and fetch the URLs first.** This ensures you're working with the correct API and usage patterns rather than guessing.

## Workflow

1. **Get project context** — perform the mandatory preflight above. Never assume context was injected automatically.
2. **Check installed components first** — list `resolvedPaths.ui` and inspect the actual wrapper exports. Don't import components that haven't been added, and don't re-add installed components merely to match upstream.
3. **Find components** — `npx shadcn-vue@latest search`.
4. **Get docs and examples** — run `npx shadcn-vue@latest docs <component>` to get URLs, then fetch them. Use the standalone `npx shadcn-vue@latest view <item>` command to inspect registry payloads without installation.
5. **Install or update** — use `npx shadcn-vue@latest add` only for absent components. For installed components, run the non-mutating standalone `diff <component>`, inspect with `view`, and merge intentionally (see [Updating Components](#updating-components) below).
6. **Fix imports in third-party components** — After adding components from community registries, check the added non-UI files for hardcoded import paths like `@/components/ui/...`. These won't match the project's actual aliases. Use `npx shadcn-vue@latest info` to get the correct `ui` alias (e.g. `@workspace/ui/components`) and rewrite the imports accordingly. The CLI rewrites imports for its own UI files, but third-party registry components may use default paths that don't match the project.
7. **Review added components** — After adding a component or block from any registry, **always read the added files and verify they are correct**. Check for missing imports, incorrect composition, and violations of repository rules. Apply the repository's icon policy first; only fall back to `components.json.iconLibrary` when no local convention exists. For example, convert generated direct Lucide imports to Nuxt `<Icon name="lucide:..." />` in the admin portal. Fix all issues before moving on.
8. **Registry must be explicit** — When the user asks to add a block or component, **do not guess the registry**. If no registry is specified (e.g. user says "add a login block" without specifying `@shadcn`, etc.), ask which registry to use. Never default to a registry on behalf of the user.
9. **Switching presets** — Ask the user first: **overwrite**, **merge**, or **skip**?
   - **Overwrite**: `npx shadcn-vue@latest apply <code>`. Overwrites detected components, fonts, and CSS variables.
   - **Merge**: `npx shadcn-vue@latest init --preset <code> --force --no-reinstall`, inspect installed wrappers from the resolved UI directory, run standalone `diff` for registry components, and merge each change manually.
   - **Skip**: `npx shadcn-vue@latest init --preset <code> --force --no-reinstall`. Only updates config and CSS, leaves components as-is.
   - **Important**: Always run preset commands inside the user's project directory. `apply` only works in an existing project with a `components.json` file and may reinstall wrappers. Do not use it in a customized project without explicit approval. Preset codes include a base for initialization; `apply` preserves the existing project's base.

## Updating Components

The current shadcn-vue CLI exposes `add --dry-run`, `--diff`, and `--view` in help but exits because they are not implemented. Do not rely on them and do not run `add` against an installed customized wrapper merely to inspect an update.

1. Run the non-mutating `npx shadcn-vue@latest diff <component>` to compare the transformed registry version with local files.
2. Run `npx shadcn-vue@latest view @shadcn/<component>` (or the explicit requested registry item) to inspect its source payload and dependencies.
3. If a complete generated tree is still needed, reproduce the relevant `components.json` settings in a disposable temporary project and install the item there. Do not use a git worktree unless repository policy and the user permit git operations.
4. Compare every affected file with local wrapper and consumer APIs.
5. Apply upstream changes manually while preserving local variants, styling, icon conventions, focus behavior, portal workarounds, and tests.
6. Validate with the repository's required formatter, type checker, tests, and build.
7. Use `--overwrite` only with explicit approval when the user intentionally wants to discard local changes.

## Quick Reference

```bash
# Create a new project.
npx shadcn-vue@latest init --name my-app --preset nova
npx shadcn-vue@latest init --name my-app --preset a2r6bw --template vite

# Initialize existing project.
npx shadcn-vue@latest init --preset nova
npx shadcn-vue@latest init --defaults  # shortcut: --template=nuxt --preset=nova (base style implied)

# Apply a preset to an existing project.
npx shadcn-vue@latest apply a2r6bw

# Add components.
npx shadcn-vue@latest add button card dialog
npx shadcn-vue@latest add --all

# Search registries.
npx shadcn-vue@latest search @shadcn -q "sidebar"

# Get component docs and example URLs.
npx shadcn-vue@latest docs button dialog select

# View registry item details (for items not yet installed).
npx shadcn-vue@latest view @shadcn/button
```

**Named presets:** `nova`, `vega`, `maia`, `lyra`, `mira`, `luma`, `sera`
**Templates:** `nuxt`, `vite`, `astro` and `laravel`
**Preset codes:** Version-prefixed base62 strings (e.g. `a2r6bw`), from [shadcn-vue.com](https://shadcn-vue.com).

## Detailed References

- [rules/forms.md](./rules/forms.md) — FieldGroup, Field, InputGroup, ToggleGroup, FieldSet, validation states
- [rules/composition.md](./rules/composition.md) — Groups, overlays, Card, Tabs, Avatar, Alert, Empty, Toast, Separator, Skeleton, Badge, Button loading
- [rules/icons.md](./rules/icons.md) — data-icon, icon sizing, passing icons as objects
- [rules/styling.md](./rules/styling.md) — Semantic colors, variants, class, spacing, size, truncate, dark mode, cn(), z-index, provided utilities
- [cli.md](./cli.md) — Commands, flags, presets, templates
- [customization.md](./customization.md) — Theming, CSS variables, extending components
- [registry.md](./registry.md) — Vue registry schemas, dependencies, building, installation, and verification
