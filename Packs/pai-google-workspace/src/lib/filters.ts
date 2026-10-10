// Pure helpers for Gmail filters (users.settings.filters). No I/O, so they are
// unit-testable; the API calls live in google-client.ts.
//
// Deliberately NOT supported yet: the `forward` action, and adding TRASH.
// Forwarding is the mechanism the agent-mail design chose Reply-To to avoid
// (ev-xvrp), and a trash filter deletes mail unattended. Both are one field
// away if a real need appears; adding them should be a decision, not a default.

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface Filter {
  id?: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

// What a caller asks for, in words rather than label IDs.
export interface FilterSpec extends FilterCriteria {
  labels?: string[]; // user label NAMES to apply
  archive?: boolean; // skip the inbox
  markRead?: boolean;
  star?: boolean;
  important?: boolean;
  neverImportant?: boolean;
  neverSpam?: boolean;
}

export interface Label {
  id: string;
  name: string;
}

const CRITERIA_KEYS = ["from", "to", "subject", "query", "negatedQuery"] as const;

// Build the API request body from a spec. Throws, with a message a caller can
// act on, when the filter would match everything or do nothing, or names a
// label that doesn't exist (labels are never created implicitly).
export function buildFilter(spec: FilterSpec, labels: Label[]): Filter {
  const criteria: FilterCriteria = {};
  for (const k of CRITERIA_KEYS) {
    const v = spec[k]?.trim();
    if (v) criteria[k] = v;
  }
  if (spec.hasAttachment) criteria.hasAttachment = true;
  if (Object.keys(criteria).length === 0) {
    throw new Error("a filter needs at least one criterion (from, to, subject, query, negatedQuery or hasAttachment); refusing to match all mail");
  }

  const add = new Set<string>();
  const remove = new Set<string>();
  const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  for (const name of spec.labels ?? []) {
    const id = byName.get(name.trim().toLowerCase());
    if (!id) {
      throw new Error(`unknown label "${name}"; create it in Gmail first (existing: ${labels.map((l) => l.name).join(", ")})`);
    }
    add.add(id);
  }
  if (spec.archive) remove.add("INBOX");
  if (spec.markRead) remove.add("UNREAD");
  if (spec.star) add.add("STARRED");
  if (spec.important && spec.neverImportant) throw new Error("important and neverImportant contradict each other");
  if (spec.important) add.add("IMPORTANT");
  if (spec.neverImportant) remove.add("IMPORTANT");
  if (spec.neverSpam) remove.add("SPAM");

  if (add.size === 0 && remove.size === 0) {
    throw new Error("a filter needs at least one action (label, archive, markRead, star, important, neverImportant or neverSpam)");
  }
  const action: FilterAction = {};
  if (add.size) action.addLabelIds = [...add];
  if (remove.size) action.removeLabelIds = [...remove];
  return { criteria, action };
}

// One readable line per filter, with label IDs turned back into names.
export function describeFilter(f: Filter & { action: FilterAction & { forward?: string } }, labels: Label[]): string {
  const name = new Map(labels.map((l) => [l.id, l.name]));
  const n = (id: string) => name.get(id) ?? id;
  const c = f.criteria ?? {};
  const when = [
    c.from && `from:${c.from}`,
    c.to && `to:${c.to}`,
    c.subject && `subject:(${c.subject})`,
    c.query && `${c.query}`,
    c.negatedQuery && `-(${c.negatedQuery})`,
    c.hasAttachment && "has:attachment",
  ].filter(Boolean).join(" ");
  const a = f.action ?? {};
  const does = [
    ...(a.addLabelIds ?? []).map((id) => `+${n(id)}`),
    ...(a.removeLabelIds ?? []).map((id) => `-${n(id)}`),
    a.forward && `forward:${a.forward}`,
  ].filter(Boolean).join(" ");
  return `${f.id ?? "(new)"}  ${when}  =>  ${does}`;
}
