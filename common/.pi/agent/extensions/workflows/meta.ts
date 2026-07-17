import { parse, type Expression, type ObjectExpression, type Program, type Property } from "acorn";

export interface WorkflowMeta { name?: string; description?: string; phases: Array<{ title: string; detail?: string }>; }

function propertyName(property: Property): string | undefined {
  if (property.computed || property.kind !== "init" || property.method) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") return property.key.value;
  return undefined;
}
function literal(node: Expression, depth = 0): unknown {
  if (depth > 8) throw new Error("Workflow metadata is nested too deeply.");
  if (node.type === "Literal") return node.value;
  if (node.type === "ArrayExpression") return node.elements.map((item) => {
    if (!item || item.type === "SpreadElement") throw new Error("Workflow metadata cannot contain holes or spreads.");
    return literal(item, depth + 1);
  });
  if (node.type === "ObjectExpression") {
    const output: Record<string, unknown> = Object.create(null);
    for (const item of (node as ObjectExpression).properties) {
      if (item.type !== "Property") throw new Error("Workflow metadata cannot contain spreads.");
      const key = propertyName(item);
      if (!key || item.shorthand) throw new Error("Workflow metadata must use plain literal keys and values.");
      output[key] = literal(item.value, depth + 1);
    }
    return output;
  }
  throw new Error("Workflow metadata must contain only static literals.");
}
function sanitize(value: unknown): WorkflowMeta {
  const output: WorkflowMeta = { phases: [] };
  if (!value || typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") output.name = record.name.slice(0, 160);
  if (typeof record.description === "string") output.description = record.description.slice(0, 2000);
  if (Array.isArray(record.phases)) for (const value of record.phases.slice(0, 64)) {
    if (!value || typeof value !== "object") continue;
    const phase = value as Record<string, unknown>;
    if (typeof phase.title === "string" && phase.title.trim()) output.phases.push({ title: phase.title.slice(0, 160), ...(typeof phase.detail === "string" ? { detail: phase.detail.slice(0, 2000) } : {}) });
  }
  return output;
}
export function prepareWorkflowScript(source: string): { source: string; meta: WorkflowMeta } {
  const program = parse(source, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true }) as Program;
  let meta: WorkflowMeta = { phases: [] };
  let range: { start: number; end: number } | undefined;
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration" || statement.type === "ExportDefaultDeclaration" || statement.type === "ExportAllDeclaration") throw new Error("Workflow scripts cannot import modules or export executable values.");
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (range || statement.source || statement.specifiers.length || declaration?.type !== "VariableDeclaration" || declaration.kind !== "const" || declaration.declarations.length !== 1) throw new Error("Workflow scripts may only export one static `const meta = {...}` declaration.");
    const variable = declaration.declarations[0];
    if (variable.id.type !== "Identifier" || variable.id.name !== "meta" || !variable.init) throw new Error("Workflow metadata must be `export const meta = {...}`.");
    meta = sanitize(literal(variable.init));
    range = { start: statement.start, end: statement.end };
  }
  if (!range) return { source, meta };
  const removed = source.slice(range.start, range.end);
  const replacement = `;${removed.slice(1).replace(/[^\n\r]/g, " ")}`;
  return { source: source.slice(0, range.start) + replacement + source.slice(range.end), meta };
}
export function extractMeta(source: string): WorkflowMeta { try { return prepareWorkflowScript(source).meta; } catch { return { phases: [] }; } }
