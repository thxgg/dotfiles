---
name: frontend-design
description: Create distinctive, production-grade Vue/Nuxt interfaces with Tailwind CSS v4, shadcn-vue, and Vue transitions. Avoids generic AI aesthetics through intentional design direction.
---

# frontend-design

Create distinctive, production-grade interfaces. Vue/Nuxt + Tailwind CSS v4 + shadcn-vue + Vue transitions.

## When to Use

- Vue-based UI (Nuxt 4, Vite + Vue)
- Visually memorable, accessible components
- Advanced styling with Tailwind CSS v4
- Micro-interactions and animations
- Visual design materials (posters, branding)

---

## Pre-Flight: Fetch Current Documentation

**ALWAYS fetch latest docs before implementation.** Libraries change frequently. Search the web for current Tailwind CSS v4, shadcn-vue, and Nuxt 4 documentation before writing code.

---

## Design Direction (BEFORE Coding)

**Commit to intentional aesthetic BEFORE writing code.**

### Questions to Answer

1. **Purpose**: What emotion/action should this evoke?
2. **Tone**: Brutalist? Maximalist? Retro-futuristic? Minimalist? Playful?
3. **Differentiation**: What makes this NOT look AI-generated?

### Aesthetic Vocabularies

| Direction | Characteristics |
|-----------|-----------------|
| **Brutalist** | Raw typography, exposed structure, harsh contrasts, unconventional layouts |
| **Maximalist** | Dense information, layered textures, bold color clashes, ornamental details |
| **Retro-futuristic** | Y2K gradients, chrome effects, scan lines, terminal aesthetics |
| **Organic** | Soft curves, natural color palettes, hand-drawn elements, imperfection |
| **Swiss/Modernist** | Grid precision, Helvetica derivatives, negative space, functional beauty |
| **Neo-brutalist** | Chunky borders, drop shadows, raw HTML energy, anti-polish |

---

## Technology Stack

### Vue 3 + Nuxt 4

**ALWAYS use Composition API with `<script setup>`:**

```vue
<script setup lang="ts">
// Props with TypeScript
defineProps<{
  title: string
  description?: string
  loading?: boolean
}>()

// Events with typed payloads
const emit = defineEmits<{
  save: [data: FormData]
  delete: []
}>()

// Two-way binding with defineModel
const modelValue = defineModel<string>()

// Multiple v-models
const firstName = defineModel<string>('firstName')
const lastName = defineModel<string>('lastName')
</script>
```

**State management with `useState`:**

```typescript
// composables/useFeature.ts
export function useFeature() {
  const loading = useState('feature:loading', () => false)
  const items = useState<Item[]>('feature:items', () => [])
  const hasFetched = useState('feature:hasFetched', () => false)

  async function fetchItems(signal?: AbortSignal) {
    if (hasFetched.value) return
    loading.value = true
    try {
      items.value = await $fetch('/api/items', { signal })
    } finally {
      loading.value = false
      hasFetched.value = true
    }
  }

  return { loading, items, fetchItems }
}
```

**Key patterns:**
- ALWAYS `<script setup lang="ts">` - NEVER Options API
- Named exports preferred over default exports
- PascalCase for component filenames
- `interface` preferred over `type` for props
- AbortSignal support for all fetch operations

### Tailwind CSS v4

**CSS-first configuration** via `@theme`:

```css
@import "tailwindcss";

@theme {
  /* Custom design tokens */
  --color-brand: oklch(65% 0.25 30);
  --color-surface: oklch(98% 0.01 240);
  --font-display: "Space Grotesk", system-ui;
  --spacing-prose: clamp(1rem, 3vw, 2rem);

  /* Easing functions (weak to strong) */
  --ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
  --ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
  --ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
  --ease-out-circ: cubic-bezier(0.075, 0.82, 0.165, 1);

  --ease-in-out-quad: cubic-bezier(0.455, 0.03, 0.515, 0.955);
  --ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);
  --ease-in-out-quart: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-in-out-quint: cubic-bezier(0.86, 0, 0.07, 1);
  --ease-in-out-expo: cubic-bezier(1, 0, 0, 1);
}
```

**Key v4 features**:
- `@theme` directive for design tokens
- OKLCH color space (perceptually uniform)
- Container queries: `@container`, `@min-width`, `@max-width`
- No `tailwind.config.js` needed
- Native CSS cascade layers

### shadcn-vue

**Install components via CLI:**

```bash
# Nuxt integration
npx nuxi@latest module add shadcn-nuxt

# Add components
npx shadcn-vue@latest add button card dialog form input select
```

**nuxt.config.ts setup:**

```typescript
export default defineNuxtConfig({
  modules: ['shadcn-nuxt'],
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui',
  },
})
```

---

## Animation Design

Based on Emil Kowalski's "Animations on the Web" course.

### Quick Start

Every animation decision starts with these questions:

1. **Is this element entering or exiting?** → Use `ease-out`
2. **Is an on-screen element moving?** → Use `ease-in-out`
3. **Is this a hover/color transition?** → Use `ease`
4. **Will users see this 100+ times daily?** → Don't animate it

### The Easing Blueprint

#### ease-out (Most Common)

Use for **user-initiated interactions**: dropdowns, modals, tooltips, any element entering or exiting.

```css
/* Sorted weak to strong */
--ease-out-quad: cubic-bezier(0.25, 0.46, 0.45, 0.94);
--ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
--ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1);
--ease-out-expo: cubic-bezier(0.19, 1, 0.22, 1);
```

Why it works: Fast start creates instant, responsive feeling. Element "jumps" toward destination then settles.

#### ease-in-out (For Movement)

Use when **elements already on screen need to move or morph**. Mimics natural motion like a car accelerating then braking.

```css
/* Sorted weak to strong */
--ease-in-out-quad: cubic-bezier(0.455, 0.03, 0.515, 0.955);
--ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);
--ease-in-out-quart: cubic-bezier(0.77, 0, 0.175, 1);
--ease-in-out-quint: cubic-bezier(0.86, 0, 0.07, 1);
```

#### ease (For Hover Effects)

Use for **hover states and color transitions**. The asymmetrical curve feels elegant for gentle animations.

```css
transition: background-color 150ms ease;
```

#### linear (Avoid in UI)

Only use for constant-speed animations (marquees, tickers) or time visualization (progress indicators). Linear feels robotic for interactive elements.

#### ease-in (Almost Never)

**Avoid for UI animations.** Slow start delays visual feedback, making interfaces feel sluggish.

### Duration Guidelines

| Element Type                      | Duration  |
|-----------------------------------|-----------|
| Micro-interactions (button press) | 100-150ms |
| Standard UI (tooltips, dropdowns) | 150-250ms |
| Modals, drawers                   | 200-300ms |
| Page transitions                  | 300-400ms |

**Rule:** UI animations should stay under 300ms. Larger elements animate slower than smaller ones.

### When to Animate

**Do animate:**
- Enter/exit transitions for spatial consistency
- State changes that benefit from visual continuity
- Responses to user actions (feedback)
- Rarely-used interactions where delight adds value

**Don't animate:**
- Keyboard-initiated actions (arrow keys, shortcuts)
- Hover effects on frequently-used elements
- Anything users interact with 100+ times daily
- When speed matters more than smoothness

### Animation Hierarchy

Prefer simpler options first:

1. **CSS transitions** (simplest): Tailwind `transition-*`, `hover:*`
2. **Vue `<Transition>`**: Enter/leave animations
3. **@vueuse/motion** (complex): Springs, gestures, orchestration

```vue
<!-- CSS transitions with Tailwind -->
<button class="transition-all duration-200 hover:scale-105 active:scale-[0.97]">
  Click me
</button>

<!-- Vue Transition for enter/leave -->
<Transition
  enter-active-class="transition-all duration-200 ease-[var(--ease-out-expo)]"
  enter-from-class="opacity-0 scale-95"
  enter-to-class="opacity-100 scale-100"
  leave-active-class="transition-all duration-150 ease-[var(--ease-out-quad)]"
  leave-from-class="opacity-100"
  leave-to-class="opacity-0"
>
  <div v-if="show">Content</div>
</Transition>

<!-- TransitionGroup for lists -->
<TransitionGroup
  tag="ul"
  enter-active-class="transition-all duration-300"
  enter-from-class="opacity-0 -translate-x-4"
  leave-active-class="transition-all duration-200"
  leave-to-class="opacity-0 translate-x-4"
>
  <li v-for="item in items" :key="item.id">{{ item.name }}</li>
</TransitionGroup>
```

### Animation Performance

Only animate `transform` and `opacity`. These skip layout and paint stages, running entirely on the GPU.

**Avoid animating:**
- `padding`, `margin`, `height`, `width` (trigger layout)
- `blur` filters above 20px (expensive, especially Safari)
- CSS variables in deep component trees

---

## Implementation Patterns

### Component Structure

```vue
<!-- components/ui/FeatureCard.vue -->
<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  title: string
  description: string
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <Transition
    appear
    enter-active-class="transition-all duration-500 ease-[var(--ease-out-expo)]"
    enter-from-class="opacity-0 translate-y-5"
  >
    <article
      :class="cn(
        'rounded-2xl border border-border bg-card p-6',
        'transition-shadow hover:shadow-lg',
        props.class
      )"
    >
      <h3 class="font-display text-xl font-semibold">{{ title }}</h3>
      <p class="mt-2 text-muted-foreground">{{ description }}</p>
    </article>
  </Transition>
</template>
```

### Dark Mode

```css
@import "tailwindcss";

@theme {
  --color-background: oklch(99% 0.01 240);
  --color-foreground: oklch(15% 0.02 240);
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(12% 0.02 240);
    --color-foreground: oklch(95% 0.01 240);
  }
}
```

---

## Project Standards

### File Organization

```
app/
├── assets/css/         # Tailwind CSS
├── components/
│   ├── ui/             # shadcn-vue primitives
│   └── [domain]/       # Domain-specific components
├── composables/        # Composition functions
├── layouts/            # Layout components
├── lib/
│   ├── api/            # Typed API client factories
│   └── utils.ts        # cn() utility, helpers
├── middleware/         # Route guards
├── pages/              # File-based routes
└── plugins/            # Vue plugins
```

### Utility Function

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### Enforced Rules

| Rule | Rationale |
|------|-----------|
| Composition API only | Modern, tree-shakeable, better TypeScript |
| Named exports | Easier refactoring and tree-shaking |
| `interface` over `type` | Better error messages, extendable |
| NEVER use `any` | Type safety throughout |
| Tailwind classes only | Consistent styling, no manual CSS |
| Semantic colors | Use `--color-*` variables, never hardcode |

---

## Anti-Patterns (AVOID)

These create "AI slop" - instantly recognizable generic output.

| Anti-Pattern | Why It's Bad | Alternative |
|--------------|--------------|-------------|
| Inter/Roboto everywhere | Overused, signals laziness | Space Grotesk, Instrument Sans, custom fonts |
| Purple-white gradients | AI cliche | Intentional color theory, OKLCH palettes |
| Perfectly centered hero | Predictable | Asymmetric layouts, editorial composition |
| Generic stock illustrations | Soulless | Custom graphics, photography, abstract shapes |
| Rounded-full everything | Childish, dated | Mixed radii, sharp + soft contrast |
| Blue primary buttons | Default Bootstrap energy | Brand-appropriate color decisions |
| `shadow-lg` on everything | Flat design hangover | Intentional depth hierarchy |
| Card soup | Monotonous | Varied content containers, editorial layouts |
| `scale(0)` animations | Unnatural appearance | Start from `scale(0.95)` with opacity |
| `ease-in` for UI | Feels sluggish | Use `ease-out` for enter/exit |

---

## Accessibility Checklist

- [ ] Semantic HTML (`<article>`, `<nav>`, `<main>`, `<aside>`)
- [ ] Color contrast ratio >= 4.5:1 (text), >= 3:1 (UI)
- [ ] Focus indicators visible (`:focus-visible`)
- [ ] Motion respects `prefers-reduced-motion`
- [ ] Touch targets >= 44x44px
- [ ] Form labels associated with inputs
- [ ] ARIA attributes where semantic HTML insufficient

---

## Workflow

1. **Define aesthetic direction** (brutalist, maximalist, etc.)
2. **Fetch current docs** via web search
3. **Set up design tokens** in `@theme` (colors, fonts, easing)
4. **Build atomic components** with accessibility
5. **Add interactions** (CSS first, Vue Transition for complex)
6. **Test responsive behavior** (viewport + container)
7. **Verify accessibility** (contrast, focus, motion)
8. **Review animations** - step away and return with fresh eyes
