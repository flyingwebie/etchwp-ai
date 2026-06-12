import * as csstree from "css-tree";
import type { ChildNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";
import { toolError } from "../errors.ts";

export interface PlannedStyle {
  selector: string;
  css: string;
}

export interface PlannedAttachment {
  /** Index path into plan.blocks (children indices), resolved to a blockId at orchestration time. */
  blockPath: number[];
  className: string;
}

export interface SkippedNode {
  node: string;
  reason: string;
}

export interface InsertionPlan {
  blocks: Record<string, unknown>[];
  styles: PlannedStyle[];
  attachments: PlannedAttachment[];
  skipped: SkippedNode[];
}

const SKIP_TAGS = new Set(["script", "style", "svg", "iframe", "object", "embed"]);

function textBlock(text: string): Record<string, unknown> {
  return { type: "etch/text", version: 1, context: {}, children: [], text };
}

function transformElement(
  el: Element,
  path: number[],
  attachments: PlannedAttachment[],
  skipped: SkippedNode[],
): Record<string, unknown> | null {
  const tag = el.name.toLowerCase();
  if (SKIP_TAGS.has(tag)) {
    skipped.push({
      node: tag,
      reason: `<${tag}> cannot be represented as a safe Etch block and was dropped`,
    });
    return null;
  }
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.attribs ?? {})) {
    if (k === "class") continue; // classes route through styles.create + add_class
    attributes[k] = v;
  }
  const classNames = (el.attribs?.class ?? "").split(/\s+/).filter(Boolean);
  for (const className of classNames) {
    attachments.push({ blockPath: [...path], className });
  }
  const children: Record<string, unknown>[] = [];
  for (const child of el.children as ChildNode[]) {
    const built = transformNode(child, [...path, children.length], attachments, skipped);
    if (built) children.push(built);
  }
  return {
    type: "etch/element",
    version: 1,
    context: classNames.length ? { name: `${tag}.${classNames[0]}` } : { name: tag },
    tag,
    attributes,
    children,
  };
}

function transformNode(
  node: ChildNode,
  path: number[],
  attachments: PlannedAttachment[],
  skipped: SkippedNode[],
): Record<string, unknown> | null {
  if (node.type === "text") {
    const text = (node as unknown as { data: string }).data.replace(/\s+/g, " ").trim();
    return text ? textBlock(text) : null;
  }
  if (node.type === "comment") {
    skipped.push({ node: "comment", reason: "comments are dropped" });
    return null;
  }
  if (node.type === "tag" || node.type === "script" || node.type === "style") {
    return transformElement(node as Element, path, attachments, skipped);
  }
  return null;
}

function transformCss(css: string): PlannedStyle[] {
  if (!css.trim()) return [];
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, {
      positions: true,
      onParseError: (e) => {
        throw e;
      },
    });
  } catch (e) {
    throw toolError(
      "E_VALIDATION",
      `CSS did not parse: ${(e as Error).message}. Fix the stylesheet — no mutations were issued.`,
    );
  }
  const bySelector = new Map<string, string[]>();
  csstree.walk(ast, {
    visit: "Rule",
    enter(rule) {
      if (rule.prelude.type !== "SelectorList") return;
      const selector = csstree.generate(rule.prelude);
      const declarations: string[] = [];
      rule.block.children.forEach((d) => {
        if (d.type !== "Declaration") return;
        const generated = csstree.generate(d);
        const value = generated.slice(generated.indexOf(":") + 1).trim();
        if (!value) {
          throw toolError(
            "E_VALIDATION",
            `CSS declaration '${d.property}' in '${selector}' has no value. Fix the stylesheet — no mutations were issued.`,
          );
        }
        declarations.push(generated);
      });
      const existing = bySelector.get(selector) ?? [];
      bySelector.set(selector, [...existing, ...declarations]);
    },
  });
  return [...bySelector.entries()].map(([selector, decls]) => ({
    selector,
    css: decls.join(";"),
  }));
}

/**
 * Pure transform: HTML + CSS → InsertionPlan (F13a). No bridge calls, no side
 * effects — unparseable input throws E_VALIDATION before anything mutates.
 * etch/raw-html is never emitted; classes are stripped from markup and routed
 * through planned styles + attachments (the styles array is read-only upstream).
 */
export function transformPattern(html: string, css: string): InsertionPlan {
  const attachments: PlannedAttachment[] = [];
  const skipped: SkippedNode[] = [];
  const doc = parseDocument(html ?? "", { lowerCaseTags: true });
  const blocks: Record<string, unknown>[] = [];
  for (const child of doc.children as ChildNode[]) {
    const built = transformNode(child, [blocks.length], attachments, skipped);
    if (built) blocks.push(built);
  }
  if (!blocks.length) {
    throw toolError(
      "E_VALIDATION",
      "No representable elements found in the HTML — nothing to insert (text-only or empty input).",
    );
  }
  return { blocks, styles: transformCss(css ?? ""), attachments, skipped };
}
