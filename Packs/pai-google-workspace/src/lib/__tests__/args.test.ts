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

  test("a flag with no value at the end reads as empty", () => {
    expect(parseArgs(["--subject"], spec).single).toEqual({ subject: "" });
  });

  test("with no spec every flag is single-valued", () => {
    expect(() => parseArgs(["--id", "1", "--id", "2"])).toThrow("--id was given more than once");
  });
});
