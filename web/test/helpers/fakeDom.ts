/** The few DOM features Panel uses, so panel glue can be tested in the node environment. */
export class FakeElement {
  children: FakeElement[] = [];
  textContent = '';
  value = '';
  disabled = false;
  hidden = false;
  private listeners = new Map<string, (() => void)[]>();
  constructor(readonly tag: string, readonly id = '') {}
  replaceChildren(...nodes: FakeElement[]): void { this.children = nodes; }
  addEventListener(type: string, fn: () => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  click(): void { for (const fn of this.listeners.get('click') ?? []) fn(); }
}

export function fakeDocument(ids: string[]): Document {
  const byId = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  return { getElementById: (id: string) => byId.get(id) ?? null, createElement: (tag: string) => new FakeElement(tag) } as unknown as Document;
}
