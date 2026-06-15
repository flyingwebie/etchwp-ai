import { describe, expect, test } from "bun:test";
import { ERROR_REMEDIATIONS, EtchToolError, toolError } from "../src/errors.ts";

describe("error codes", () => {
  test("E_NO_CHROME remediation names the debug flag", () => {
    const err = toolError("E_NO_CHROME");
    expect(err).toBeInstanceOf(EtchToolError);
    expect(err.code).toBe("E_NO_CHROME");
    expect(err.remediation).toContain("--remote-debugging-port=9222");
  });

  test("E_NO_TAB remediation names ETCH_TAB_URL_HINT", () => {
    expect(toolError("E_NO_TAB").remediation).toContain("ETCH_TAB_URL_HINT");
  });

  test("E_MULTIPLE_TABS remediation instructs narrowing the hint", () => {
    expect(toolError("E_MULTIPLE_TABS").remediation).toContain("ETCH_TAB_URL_HINT");
  });

  test("E_UNSAVED_CHANGES remediation names etch_save and discard", () => {
    const r = toolError("E_UNSAVED_CHANGES").remediation;
    expect(r).toContain("etch_save");
    expect(r).toContain("discard");
  });

  test("every documented code has a remediation", () => {
    for (const code of [
      "E_NO_CHROME",
      "E_NO_TAB",
      "E_MULTIPLE_TABS",
      "E_NO_ETCH",
      "E_NOT_AVAILABLE",
      "E_TIMEOUT",
      "E_INDETERMINATE",
      "E_DETACHED",
      "E_SESSION_RELOADED",
      "E_UNSAVED_CHANGES",
      "E_FEATURE_MISSING",
      "E_VALIDATION",
      "E_SIDECAR_DISABLED",
      "E_SIDECAR_AUTH",
    ]) {
      expect(ERROR_REMEDIATIONS[code], `missing remediation for ${code}`).toBeTruthy();
    }
  });

  test("pass-through Etch codes keep their code with generic remediation", () => {
    const err = toolError("BLOCK_NOT_FOUND", "no such block");
    expect(err.code).toBe("BLOCK_NOT_FOUND");
    expect(err.message).toBe("no such block");
    expect(err.remediation.length).toBeGreaterThan(0);
  });
});
