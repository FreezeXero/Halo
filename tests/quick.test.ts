import { describe, expect, it } from "vitest";
import { browserProcess, quickAction, tidy } from "../src/core/quick.js";

const CHROME = "Google Chrome";

describe("quick browser requests", () => {
  it("tidies polite phrasing", () => {
    expect(tidy("Halo, can you please reload the page for me?")).toBe("reload the page");
  });

  it("reloads, goes back and forward in a browser", () => {
    expect(quickAction("reload the page", CHROME)).toMatchObject({ kind: "keys", keys: "{F5}" });
    expect(quickAction("Refresh", CHROME)).toMatchObject({ kind: "keys", keys: "{F5}" });
    expect(quickAction("go back", CHROME)).toMatchObject({ kind: "keys", keys: "%{LEFT}" });
    expect(quickAction("go forward", "Microsoft Edge")).toMatchObject({ kind: "keys", keys: "%{RIGHT}" });
  });

  it("doesn't send browser keys when a browser isn't in front", () => {
    expect(quickAction("reload the page", "Notepad")).toBeNull();
    expect(quickAction("go back", null)).toBeNull();
  });

  it("opens known sites", () => {
    expect(quickAction("go to the YouTube home page", CHROME)).toMatchObject({ kind: "go", url: "https://www.youtube.com" });
    expect(quickAction("open gmail", null)).toMatchObject({ kind: "go", url: "https://mail.google.com" });
    expect(quickAction("YouTube", CHROME)).toMatchObject({ kind: "go", url: "https://www.youtube.com" });
    expect(quickAction("go to example.com", CHROME)).toMatchObject({ kind: "go", url: "https://example.com" });
  });

  it("searches", () => {
    expect(quickAction("search youtube for cat videos", CHROME)).toMatchObject({ url: "https://www.youtube.com/results?search_query=cat%20videos" });
    expect(quickAction("google best pizza near me", CHROME)).toMatchObject({ url: "https://www.google.com/search?q=best%20pizza%20near%20me" });
  });

  it("leaves everything else to the agent", () => {
    expect(quickAction("my sound isn't working", CHROME)).toBeNull();
    expect(quickAction("open notepad", CHROME)).toBeNull();
    expect(quickAction("turn on dark mode", CHROME)).toBeNull();
    expect(quickAction("send this photo to my daughter", CHROME)).toBeNull();
  });

  it("maps browsers to their Windows process", () => {
    expect(browserProcess("Microsoft Edge")).toBe("msedge");
    expect(browserProcess(CHROME)).toBe("chrome");
    expect(browserProcess("Notepad")).toBeNull();
  });
});

describe("searching", () => {
  it("understands \"search up\"", () => {
    expect(quickAction("search up organic chemistry tutor on youtube", CHROME)).toMatchObject({ url: "https://www.youtube.com/results?search_query=organic%20chemistry%20tutor" });
  });

  it("builds only Google and YouTube search addresses", async () => {
    const { searchUrl } = await import("../src/agent/tools.js");
    expect(searchUrl("youtube", "cats")).toBe("https://www.youtube.com/results?search_query=cats");
    expect(searchUrl("google", "a&b")).toBe("https://www.google.com/search?q=a%26b");
    expect(searchUrl("evil.com", "x")).toBeNull();
    expect(searchUrl("google", "  ")).toBeNull();
  });
});
