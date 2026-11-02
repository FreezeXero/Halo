// Which computer Halo is running on. CALHACK_PLATFORM overrides it (tests use it to check the Windows code on any machine).
export type Platform = "mac" | "windows";

export function platform(): Platform {
  const o = process.env.CALHACK_PLATFORM?.trim().toLowerCase();
  if (o === "windows" || o === "mac") return o;
  return process.platform === "win32" ? "windows" : "mac";
}

export const isWindows = (): boolean => platform() === "windows";

/** What to call the computer in plain words. */
export const computerName = (): string => (isWindows() ? "PC" : "Mac");
