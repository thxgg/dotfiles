# Icons

**Follow repository-local icon conventions first.** If no local convention exists, use the configured `iconLibrary`: `lucide` → `@lucide/vue`, `tabler` → `@tabler/icons-vue`, etc. A project using Nuxt Icon may intentionally render `<Icon name="lucide:..." />` and prohibit direct icon imports even when `components.json` says `lucide`.

---

## Icons in Button use data-icon attribute

Add `data-icon="inline-start"` (prefix) or `data-icon="inline-end"` (suffix) to the icon. No sizing classes on the icon.

**Incorrect:**

```html
<Button>
  <SearchIcon class="mr-2 size-4" />
  Search
</Button>
```

**Correct:**

```html
<Button>
  <SearchIcon data-icon="inline-start"/>
  Search
</Button>

<Button>
  Next
  <ArrowRightIcon data-icon="inline-end"/>
</Button>
```

---

## No sizing classes on icons inside components

Components handle icon sizing via CSS. Don't add `size-4`, `w-4 h-4`, or other sizing classes to icons inside `Button`, `DropdownMenuItem`, `Alert`, `Sidebar*`, or other shadcn components. Unless the user explicitly asks for custom icon sizes.

**Incorrect:**

```html
<Button>
  <SearchIcon class="size-4" data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon class="mr-2 size-4" />
  Settings
</DropdownMenuItem>
```

**Correct:**

```html
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon />
  Settings
</DropdownMenuItem>
```

---

## Pass imported icons as component objects, not lookup strings

When using imported icon components, use `:icon="CheckIcon"`, not a string key to a lookup map. This does not override frameworks such as Nuxt Icon whose established API intentionally uses names like `lucide:check`.

**Incorrect:**

```js
<script setup lang="ts">
const iconMap = {
  check: CheckIcon,
  alert: AlertIcon,
}

defineProps({
  icon: String
})
</script>

<template>
  <component :is="iconMap[icon]" />
</template>
```

**Correct:**

```js
<script setup lang="ts">
// Import from the project's configured iconLibrary (e.g. @lucide/vue, @tabler/icons-vue).
import { CheckIcon } from "@lucide/vue"

defineProps({
  icon: Object // Or Component
})
</script>

<template>
  <component :is="icon" />
</template>

<!-- Usage -->
<StatusBadge :icon="CheckIcon" />
```
