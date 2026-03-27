// Custom JSX runtime — renders TSX to HTML strings (no virtual DOM, no hydration)

type Child = string | number | boolean | null | undefined | Child[];
type Props = Record<string, unknown> & { children?: Child };

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function renderChildren(children: Child): string {
  if (children == null || children === false || children === true) return "";
  if (Array.isArray(children)) return children.map(renderChildren).join("");
  return String(children);
}

function renderProps(props: Props): string {
  const attrs: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || value == null || value === false) continue;
    const attrName = key === "className" ? "class" : key;
    if (key === "style" && typeof value === "object") {
      const s = Object.entries(value as Record<string, string | number>)
        .map(([k, v]) => `${k.replace(/([A-Z])/g, "-$1").toLowerCase()}: ${v}`)
        .join("; ");
      attrs.push(`style="${Bun.escapeHTML(s)}"`);
      continue;
    }
    if (value === true) { attrs.push(attrName); continue; }
    attrs.push(`${attrName}="${Bun.escapeHTML(String(value))}"`);
  }
  return attrs.length > 0 ? " " + attrs.join(" ") : "";
}

export function jsx(
  tag: string | ((props: Props) => string),
  props: Props,
): string {
  if (typeof tag === "function") return tag(props);
  const { children, dangerouslySetInnerHTML, ...rest } = props as Props & {
    dangerouslySetInnerHTML?: { __html: string };
  };
  const attributes = renderProps(rest as Props);
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attributes} />`;
  if (dangerouslySetInnerHTML && typeof dangerouslySetInnerHTML.__html === "string") {
    return `<${tag}${attributes}>${dangerouslySetInnerHTML.__html}</${tag}>`;
  }
  return `<${tag}${attributes}>${renderChildren(children)}</${tag}>`;
}

export const jsxs = jsx;

export function Fragment({ children }: { children?: Child }): string {
  return renderChildren(children);
}

export namespace JSX {
  export type Element = string;
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}
