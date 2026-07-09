# Component Composition

Inspect existing wrappers before applying stock API assumptions. Repository-local extensions and accessibility workarounds are authoritative.

## Contents

- Use Group components for semantic groups
- Use the project's callout component
- Empty states use Empty component
- Toast notifications use vue-sonner
- Choosing between overlay components
- Dialog, Sheet, and Drawer always need a Title
- Card structure
- Button has no isPending or isLoading prop
- TabsTrigger must be inside TabsList
- Avatar always needs AvatarFallback
- Use Separator instead of raw hr or border divs
- Use Skeleton for loading placeholders
- Use Badge instead of custom styled spans

---

## Use Group components for semantic groups

Direct items are valid when a list has no labeled or visually distinct sections. Use the matching Group when items form a real section, especially when a label is present:

```html
<SelectContent>
  <SelectGroup>
    <SelectLabel>Fruit</SelectLabel>
    <SelectItem value="apple">Apple</SelectItem>
    <SelectItem value="banana">Banana</SelectItem>
  </SelectGroup>
  <SelectItem value="water">Water</SelectItem>
</SelectContent>
```

Common semantic pairs:

| Item/label | Group |
|---|---|
| `SelectItem`, `SelectLabel` | `SelectGroup` |
| `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSub` | `DropdownMenuGroup` |
| `MenubarItem` | `MenubarGroup` |
| `ContextMenuItem` | `ContextMenuGroup` |
| `CommandItem` | `CommandGroup` |

Do not add empty or synthetic groups solely to satisfy a structural rule.

---

## Use the project's callout component

Use an existing project abstraction instead of a custom styled div. In a stock project with `Alert` installed:

```html
<Alert>
  <AlertTitle>Warning</AlertTitle>
  <AlertDescription>Something needs attention.</AlertDescription>
</Alert>
```

The CODE Hospitality admin portal uses `Callout` and `AlertBanner`; do not import a nonexistent stock `Alert` wrapper there.

---

## Empty states use Empty component

```html
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon"><FolderIcon /></EmptyMedia>
    <EmptyTitle>No projects yet</EmptyTitle>
    <EmptyDescription>Get started by creating a new project.</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button>Create Project</Button>
  </EmptyContent>
</Empty>
```

---

## Toast notifications use vue-sonner

```js
<script setup lang="ts">
import { toast } from "vue-sonner"

toast.success("Changes saved.")
toast.error("Something went wrong.")
toast("File deleted.", {
  action: { label: "Undo", onClick: () => undoDelete() },
})
</script>
```

---

## Choosing between overlay components

| Use case | Component |
|----------|-----------|
| Focused task that requires input | `Dialog` |
| Destructive action confirmation | `AlertDialog` |
| Side panel with details or filters | `Sheet` |
| Mobile-first bottom panel | `Drawer` |
| Quick info on hover | `HoverCard` |
| Small contextual content on click | `Popover` |

---

## Dialog, Sheet, and Drawer always need a Title

`DialogTitle`, `SheetTitle`, `DrawerTitle` are required for accessibility. Use `class="sr-only"` if visually hidden.

```vue
<DialogContent>
  <DialogHeader>
    <DialogTitle>Edit Profile</DialogTitle>
    <DialogDescription>Update your profile.</DialogDescription>
  </DialogHeader>
  ...
</DialogContent>
```

---

## Card structure

Use full composition — don't dump everything into `CardContent`:

```html
<Card>
  <CardHeader>
    <CardTitle>Team Members</CardTitle>
    <CardDescription>Manage your team.</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>
    <Button>Invite</Button>
  </CardFooter>
</Card>
```

---

## Stock Button has no isPending or isLoading prop

For an unmodified stock Button, compose with `Spinner` + `data-icon` + `disabled`. If the local wrapper already exposes a typed loading API, preserve and use it instead:

```html
<Button disabled>
  <Spinner data-icon="inline-start" />
  Saving...
</Button>
```

---

## TabsTrigger must be inside TabsList

Never render `TabsTrigger` directly inside `Tabs` — always wrap in `TabsList`:

```html
<Tabs default-value="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">...</TabsContent>
</Tabs>
```

---

## Avatar always needs AvatarFallback

Always include `AvatarFallback` for when the image fails to load:

```html
<Avatar>
  <AvatarImage src="/avatar.png" alt="User" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
```

---

## Use existing components instead of custom markup

| Instead of | Use |
|---|---|
| `<hr>` or `<div class="border-t">` | `<Separator />` |
| `<div class="animate-pulse">` with styled divs | `<Skeleton class="h-4 w-3/4" />` |
| `<span class="rounded-full bg-green-100 ...">` | `<Badge variant="secondary">` |
