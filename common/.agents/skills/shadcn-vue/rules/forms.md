# Forms & Inputs

Repository-local form conventions and existing wrappers take precedence. In established vee-validate projects, inspect and reuse their `FormField`/`FormItem` abstractions rather than replacing them with newer stock primitives.

## Contents

- Forms use FieldGroup + Field
- InputGroup requires InputGroupInput/InputGroupTextarea
- Buttons inside inputs use InputGroup + InputGroupAddon
- Choose ToggleGroup or RadioGroup by interaction semantics
- FieldSet + FieldLegend for grouping related fields
- Field validation and disabled states

---

## Stock forms use FieldGroup + Field

For stock shadcn-vue forms without an established form abstraction, use `FieldGroup` + `Field` rather than a raw `div` with `space-y-*`:

```vue
<FieldGroup>
  <Field>
    <FieldLabel for="email">Email</FieldLabel>
    <Input id="email" type="email" />
  </Field>
  <Field>
    <FieldLabel for="password">Password</FieldLabel>
    <Input id="password" type="password" />
  </Field>
</FieldGroup>
```

Use `Field orientation="horizontal"` for settings pages. Use `FieldLabel class="sr-only"` for visually hidden labels.

**Choosing form controls:**

- Simple text input → `Input`
- Dropdown with predefined options → `Select`
- Searchable dropdown → `Combobox`
- Native HTML select (no JS) → `native-select`
- Boolean toggle → `Switch` (for settings) or `Checkbox` (for forms)
- Single choice from few options → `RadioGroup`
- Toggle between 2–7 options → `ToggleGroup` + `ToggleGroupItem`
- OTP/verification code → `InputOTP`
- Multi-line text → `Textarea`

---

## InputGroup requires InputGroupInput/InputGroupTextarea

Never use raw `Input` or `Textarea` inside an `InputGroup`.

**Incorrect:**

```html
<InputGroup>
  <Input placeholder="Search..." />
</InputGroup>
```

**Correct:**

```js
<script setup lang="ts">
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
</script>

<template>
  <InputGroup>
    <InputGroupInput placeholder="Search..." />
  </InputGroup>
</template>
```

---

## Buttons inside inputs use InputGroup + InputGroupAddon

Never place a `Button` directly inside or adjacent to an `Input` with custom positioning.

**Incorrect:**

```html
<div class="relative">
  <Input placeholder="Search..." class="pr-10" />
  <Button class="absolute right-0 top-0" size="icon">
    <SearchIcon />
  </Button>
</div>
```

**Correct:**

```js
<script setup lang="ts">
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
</script>

<template>
  <InputGroup>
    <InputGroupInput placeholder="Search..." />
    <InputGroupAddon>
      <InputGroupButton size="icon-xs">
        <SearchIcon />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
```

---

## Choose ToggleGroup or RadioGroup by interaction semantics

Use `ToggleGroup` for a pressed-button or segmented control. Use `RadioGroup` when the user is choosing one value in a conventional form. Do not choose by option count alone, and don't manually loop `Button` components with active state.

**Incorrect:**

```js
<script setup lang="ts">
const selected = ref("daily")
const options = ["daily", "weekly", "monthly"]
</script>

<template>
  <div class="flex gap-2">
    <Button
      v-for="option in options"
      :key="option"
      :variant="selected === option ? 'default' : 'outline'"
      @click="selected = option"
    >
      {{ option }}
    </Button>
  </div>
</template>
```

**Correct:**

```js
<script setup lang="ts">
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
</script>

<template>
  <ToggleGroup type="single">
    <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
    <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
    <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
  </ToggleGroup>
</template>
```

Combine with `Field` for labelled toggle groups:

```html
<Field orientation="horizontal">
  <FieldTitle id="theme-label">Theme</FieldTitle>
  <ToggleGroup type="single" aria-labelledby="theme-label">
    <ToggleGroupItem value="light">Light</ToggleGroupItem>
    <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
    <ToggleGroupItem value="system">System</ToggleGroupItem>
  </ToggleGroup>
</Field>
```


---

## FieldSet + FieldLegend for grouping related fields

Use `FieldSet` + `FieldLegend` for related checkboxes, radios, or switches — not `div` with a heading:

```html
<FieldSet>
  <FieldLegend variant="label">Preferences</FieldLegend>
  <FieldDescription>Select all that apply.</FieldDescription>
  <FieldGroup class="gap-3">
    <Field orientation="horizontal">
      <Checkbox id="dark" />
      <FieldLabel for="dark" class="font-normal">Dark mode</FieldLabel>
    </Field>
  </FieldGroup>
</FieldSet>
```

---

## Field validation and disabled states

Both attributes are needed — `data-invalid`/`data-disabled` styles the field (label, description), while `aria-invalid`/`disabled` styles the control.

```html
<!-- Invalid. -->
<Field data-invalid>
  <FieldLabel for="email">Email</FieldLabel>
  <Input id="email" aria-invalid />
  <FieldError>Invalid email address.</FieldError>
</Field>

<!-- Disabled. -->
<Field data-disabled>
  <FieldLabel for="email">Email</FieldLabel>
  <Input id="email" disabled />
</Field>
```

Works for all controls: `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroupItem`, `Switch`, `Slider`, `NativeSelect`, `InputOTP`.
