// Shared --flag parser for the CLIs. One rule they all follow: a flag behaves
// the way a caller would guess. A list flag (--to, --cc, --attendees, ...) can
// be repeated and every value is kept. Any other flag given twice is an error,
// because silently keeping only the last value drops data with no sign: a
// repeated --to once sent a message to one of its two recipients.

export interface ArgSpec {
  booleans?: Iterable<string>; // take no value
  multi?: Iterable<string>; // may repeat; values accumulate in order
}

export interface ParsedArgs {
  single: Record<string, string>;
  multiple: Record<string, string[]>;
}

export function parseArgs(args: string[], spec: ArgSpec = {}): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const multi = new Set(spec.multi ?? []);
  const single: Record<string, string> = {};
  const multiple: Record<string, string[]> = {};

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);

    if (booleans.has(key)) {
      single[key] = "true";
      continue;
    }

    const value = args[i + 1] ?? "";
    i++;

    if (multi.has(key)) {
      (multiple[key] ??= []).push(value);
    } else if (key in single) {
      throw new Error(`--${key} was given more than once; it takes a single value`);
    } else {
      single[key] = value;
    }
  }

  return { single, multiple };
}
