import { describe, expect, it } from "vitest";
import { bestOutput, outputSwitch, parseOutputs, safeOutputId, soundDiagnosis } from "../src/win/system.js";

const LIST = [
  "output|default|{0.0.0.00000000}.{09bf9dbe-0c5b-476c-8249-a7fd2b69c07a}|100|on|LG ULTRAGEAR+ (NVIDIA High Definition Audio)",
  "output|other|{0.0.0.00000000}.{2049b039-f1cf-46b8-b284-46f1777aaf87}|78|on|Headphones (AirPods Pro)",
  "output|other|{0.0.0.00000000}.{428ff38d-bd06-461e-9ca4-a0cb887c0de6}|75|on|Realtek Digital Output (Realtek(R) Audio)",
  "output|other|{0.0.0.00000000}.{f274b00b-55a6-48ca-ada3-54d243a076dc}|38|on|Speakers (Realtek(R) Audio)",
].join("\r\n");

describe("sound outputs", () => {
  it("reads the list", () => {
    const o = parseOutputs(LIST);
    expect(o).toHaveLength(4);
    expect(o[0]).toMatchObject({ isDefault: true, level: 100, muted: false, name: "LG ULTRAGEAR+ (NVIDIA High Definition Audio)" });
  });

  it("sees sound going to a monitor and picks headphones over speakers", () => {
    const d = soundDiagnosis(parseOutputs(LIST));
    expect(d?.switchTo).toBe(true);
    expect(d?.problem).toMatch(/LG ULTRAGEAR/);
    expect(d?.target.name).toBe("Headphones (AirPods Pro)");
  });

  it("unmutes when the right output is muted, and says nothing when all is well", () => {
    const muted = parseOutputs("output|default|{0.0.0.00000000}.{f274b00b-55a6-48ca-ada3-54d243a076dc}|50|muted|Speakers (Realtek(R) Audio)");
    expect(soundDiagnosis(muted)).toMatchObject({ switchTo: false, problem: "Speakers (Realtek(R) Audio) is muted" });
    const fine = parseOutputs("output|default|{0.0.0.00000000}.{f274b00b-55a6-48ca-ada3-54d243a076dc}|50|on|Speakers (Realtek(R) Audio)");
    expect(soundDiagnosis(fine)).toBeNull();
  });

  it("never picks a monitor as the fix", () => {
    expect(bestOutput(parseOutputs(LIST.split("\r\n").filter((l) => /NVIDIA|Digital/.test(l)).join("\n")))).toBeNull();
  });

  it("only switches to a real device id", () => {
    expect(safeOutputId("{0.0.0.00000000}.{2049b039-f1cf-46b8-b284-46f1777aaf87}")).toBe(true);
    expect(() => outputSwitch("x'); Remove-Item C:\ -Recurse; ('")).toThrow();
  });
});
