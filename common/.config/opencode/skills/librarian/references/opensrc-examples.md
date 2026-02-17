# opensrc Code Examples

## Workflow: Fetch -> Explore

### Basic Fetch and Explore with tree()

```javascript
async () => {
  const [{ source }] = await opensrc.fetch("vercel/ai");
  const tree = await opensrc.tree(source.name, { depth: 2 });
  return tree;
}
```

### Fetch and Read Key Files

```javascript
async () => {
  const [{ source }] = await opensrc.fetch("vercel/ai");
  const sourceName = source.name;
  
  const files = await opensrc.readMany(sourceName, [
    "package.json",
    "README.md", 
    "src/index.ts"
  ]);
  
  return { sourceName, files };
}
```

### readMany with Globs

```javascript
async () => {
  const [{ source }] = await opensrc.fetch("zod");
  const files = await opensrc.readMany(source.name, [
    "packages/*/package.json"
  ]);
  return Object.keys(files);
}
```

### Batch Fetch Multiple Packages

```javascript
async () => {
  const results = await opensrc.fetch(["zod", "valibot", "yup"]);
  const names = results.map(r => r.source.name);
  
  const comparisons = {};
  for (const name of names) {
    const matches = await opensrc.grep("string.*validate|validateString", { 
      sources: [name], 
      include: "*.ts",
      maxResults: 10 
    });
    comparisons[name] = matches.map(m => `${m.file}:${m.line}`);
  }
  return comparisons;
}
```

## Search Patterns

### Grep -> Read Context

```javascript
async () => {
  const matches = await opensrc.grep("export function parse\\(", { 
    sources: ["zod"], 
    include: "*.ts" 
  });
  
  if (matches.length === 0) return "No matches";
  
  const match = matches[0];
  const content = await opensrc.read(match.source, match.file);
  const lines = content.split("\n");
  
  return {
    file: match.file,
    code: lines.slice(match.line - 1, match.line + 39).join("\n")
  };
}
```

## AST-Based Search

### Find Function Declarations

```javascript
async () => {
  const [{ source }] = await opensrc.fetch("lodash");
  
  const fns = await opensrc.astGrep(source.name, "function $NAME($$$ARGS) { $$$BODY }", {
    lang: "js",
    limit: 20
  });
  
  return fns.map(m => ({
    file: m.file,
    line: m.line,
    name: m.metavars.NAME
  }));
}
```

### Find React Hooks Usage

```javascript
async () => {
  const [{ source }] = await opensrc.fetch("vercel/ai");
  
  const stateHooks = await opensrc.astGrep(
    source.name,
    "const [$STATE, $SETTER] = useState($$$INIT)",
    { lang: ["ts", "tsx"], limit: 50 }
  );
  
  return stateHooks.map(m => ({
    file: m.file,
    state: m.metavars.STATE,
    setter: m.metavars.SETTER
  }));
}
```

### grep vs astGrep

| Use Case              | Tool                                       |
| --------------------- | ------------------------------------------ |
| Text/regex pattern    | `grep`                                       |
| Function declarations | `astGrep`: `function $NAME($$$) { $$$ }`       |
| Arrow functions       | `astGrep`: `const $N = ($$$) => $_`            |
| Class definitions     | `astGrep`: `class $NAME extends $PARENT`       |
| Import statements     | `astGrep`: `import { $$$IMPORTS } from "$MOD"` |
| JSX components        | `astGrep`: `<$COMP $$$PROPS />`                |

## Repository Exploration

### Find Entry Points

```javascript
async () => {
  const name = "github.com/vercel/ai";
  
  const allFiles = await opensrc.files(name, "**/*.{ts,js}");
  const entryPoints = allFiles.filter(f => 
    f.path.match(/^(src\/)?(index|main|mod)\.(ts|js)$/) ||
    f.path.includes("/index.ts")
  );
  
  const contents = {};
  for (const ep of entryPoints.slice(0, 5)) {
    contents[ep.path] = await opensrc.read(name, ep.path);
  }
  
  return { 
    totalFiles: allFiles.length,
    entryPoints: entryPoints.map(f => f.path),
    contents 
  };
}
```

## Batch Operations

### Read Many with Error Handling

```javascript
async () => {
  const files = await opensrc.readMany("zod", [
    "src/index.ts",
    "src/types.ts",
    "src/ZodError.ts",
    "src/helpers/parseUtil.ts"
  ]);
  
  const successful = Object.entries(files)
    .filter(([_, content]) => !content.startsWith("[Error:"))
    .map(([path, content]) => ({ path, lines: content.split("\n").length }));
  
  return successful;
}
```
