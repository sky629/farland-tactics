/** The few DOM features Panel and Dialogue use, so DOM glue can be tested in the node environment. */
export class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = '';
  value = '';
  src = '';
  className = '';
  disabled = false;
  hidden = false;
  style: Record<string, string> = {};
  private listeners = new Map<string, ((ev: unknown) => void)[]>();
  constructor(readonly tag: string, readonly id = '') {}
  replaceChildren(...nodes: FakeElement[]): void { this.children = nodes; for (const n of nodes) n.parent = this; }
  appendChild<T extends FakeElement>(node: T): T { this.children.push(node); node.parent = this; return node; }
  append(...nodes: FakeElement[]): void { for (const n of nodes) this.appendChild(n); }
  prepend(...nodes: FakeElement[]): void { for (const n of nodes) n.parent = this; this.children.unshift(...nodes); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(type: string, fn: (ev: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  click(): void { for (const fn of this.listeners.get('click') ?? []) fn({ target: this, stopPropagation() {} }); }
  /** Depth-first search by exact text, for tests. */
  find(text: string): FakeElement | null {
    if (this.textContent === text) return this;
    for (const c of this.children) { const f = c.find(text); if (f) return f; }
    return null;
  }
}

export function fakeDocument(ids: string[]): Document {
  const byId = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  const createTextNode = (text: string) => { const n = new FakeElement('#text'); n.textContent = text; return n; };
  return { getElementById: (id: string) => byId.get(id) ?? null, createElement: (tag: string) => new FakeElement(tag), createTextNode } as unknown as Document;
}
