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

// A token that is itself a flag ("--cc"), not a value that happens to start
// with dashes ("--- notes", "-- signature"). Taking it as the previous flag's
// value would swallow it: `--to a --to --cc b` once made "--cc" a recipient and
// dropped b.
const BARE_FLAG = /^--[A-Za-z][\w-]*$/;

export function parseArgs(args: string[], spec: ArgSpec = {}): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const multi = new Set(spec.multi ?? []);
  // No prototype, so a flag named like an inherited property ("--constructor")
  // is not mistaken for a repeat, and "--__proto__" is stored like any other.
  const single: Record<string, string> = Object.create(null);
  const multiple: Record<string, string[]> = Object.create(null);

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);

    if (booleans.has(key)) {
      single[key] = "true";
      continue;
    }

    const value = args[i + 1];
    if (value === undefined || BARE_FLAG.test(value)) {
      throw new Error(`--${key} needs a value`);
    }
    i++;

    if (multi.has(key)) {
      (multiple[key] ??= []).push(value);
    } else if (Object.hasOwn(single, key)) {
      throw new Error(`--${key} was given more than once; it takes a single value`);
    } else {
      single[key] = value;
    }
  }

  return { single, multiple };
}
