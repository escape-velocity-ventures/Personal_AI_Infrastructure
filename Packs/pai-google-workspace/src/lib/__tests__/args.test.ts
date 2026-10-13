import { describe, expect, test } from "bun:test";
import { parseArgs } from "../args";

const spec = { booleans: ["meet"], multi: ["to", "cc"] };

describe("parseArgs", () => {
  test("a list flag keeps every value, in order", () => {
    // The 2026-10-13 bug: `--to a --to b` sent only to b.
    const { multiple } = parseArgs(["--to", "a@x.com", "--to", "b@y.com"], spec);
    expect(multiple.to).toEqual(["a@x.com", "b@y.com"]);
  });

  test("a single-value flag given twice is an error, not last-one-wins", () => {
    expect(() => parseArgs(["--subject", "One", "--subject", "Two"], spec)).toThrow(
      "--subject was given more than once; it takes a single value"
    );
  });

  test("single values, booleans and positionals", () => {
    const { single, multiple } = parseArgs(["query", "--meet", "--subject", "Hi", "--cc", "c@x.com"], spec);
    expect(single).toEqual({ meet: "true", subject: "Hi" });
    expect(multiple).toEqual({ cc: ["c@x.com"] });
  });

  test("a repeated boolean is harmless", () => {
    expect(parseArgs(["--meet", "--meet"], spec).single).toEqual({ meet: "true" });
  });

  test("a flag with no value at the end is an error", () => {
    expect(() => parseArgs(["--subject"], spec)).toThrow("--subject needs a value");
  });

  test("a flag followed by another flag is an error, not a swallowed value", () => {
    // Cybill on #22: `--to a --to --cc b` made "--cc" a recipient and dropped b.
    expect(() => parseArgs(["--to", "a@x.com", "--to", "--cc", "b@x.com"], spec)).toThrow("--to needs a value");
    expect(() => parseArgs(["--subject", "--meet"], spec)).toThrow("--subject needs a value");
  });

  test("a value that only starts with dashes is still a value", () => {
    const { single } = parseArgs(["--body", "--- notes ---", "--subject", "-- signature"], spec);
    expect(single.body).toBe("--- notes ---");
    expect(single.subject).toBe("-- signature");
  });

  test("an empty string is a value, not a missing one", () => {
    expect(parseArgs(["--subject", ""], spec).single.subject).toBe("");
  });

  test("flags named like Object.prototype members are ordinary flags", () => {
    // Cybill on #22: `key in {}` consulted the prototype, so --constructor used once read as a repeat.
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const { single } = parseArgs([`--${name}`, "x"], spec);
      expect(single[name]).toBe("x");
      expect(() => parseArgs([`--${name}`, "x", `--${name}`, "y"], spec)).toThrow(`--${name} was given more than once`);
    }
  });

  test("with no spec every flag is single-valued", () => {
    expect(() => parseArgs(["--id", "1", "--id", "2"])).toThrow("--id was given more than once");
  });
});
