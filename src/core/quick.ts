// Simple browser requests ("reload the page", "go to YouTube") that need no AI: Halo does them right away with a
// keyboard shortcut or by opening the address. Anything not matched here goes to the agent as usual.
// Only navigation: nothing here changes a setting, sends, buys, closes or deletes anything.

export type QuickAction =
  | { kind: "keys"; keys: string; did: string } // SendKeys text for the browser in front
  | { kind: "go"; url: string; did: string }; // open this address (in the browser in front when there is one)

const BROWSER = /\b(chrome|edge|firefox|brave|opera|vivaldi|arc|chromium|safari)\b/i;

/** The program in front is a web browser ("Google Chrome", "Microsoft Edge"). */
export function isBrowser(frontApp: string | null): boolean {
  return !!frontApp && BROWSER.test(frontApp);
}

/** The Windows process name for a browser's description, so Halo can bring that window back to the front. */
export function browserProcess(frontApp: string | null): string | null {
  const m = frontApp?.match(BROWSER)?.[1]?.toLowerCase();
  if (!m) return null;
  return ({ edge: "msedge" } as Record<string, string>)[m] ?? m;
}

const SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  "google maps": "https://maps.google.com",
  maps: "https://maps.google.com",
  facebook: "https://www.facebook.com",
  instagram: "https://www.instagram.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.com",
  wikipedia: "https://www.wikipedia.org",
  reddit: "https://www.reddit.com",
  twitter: "https://x.com",
  linkedin: "https://www.linkedin.com",
  outlook: "https://outlook.live.com",
  hotmail: "https://outlook.live.com",
  github: "https://github.com",
  spotify: "https://open.spotify.com",
  weather: "https://weather.com",
  news: "https://news.google.com",
};

const KEYS: [RegExp, string, string][] = [
  [/^(reload|refresh)( (the|this) (page|tab|site|website))?$/, "{F5}", "Reloaded the page."],
  [/^(go )?back( a page)?$|^(go to )?(the )?previous page$/, "%{LEFT}", "Went back a page."],
  [/^(go )?forward( a page)?$|^(go to )?(the )?next page$/, "%{RIGHT}", "Went forward a page."],
  [/^(open )?(a )?new tab$/, "^t", "Opened a new tab."],
  [/^scroll down$/, "{PGDN}", "Scrolled down."],
  [/^scroll up$/, "{PGUP}", "Scrolled up."],
  [/^(go to |scroll to )?(the )?top( of (the )?page)?$/, "{HOME}", "Went to the top of the page."],
  [/^(zoom in|make (it|this|the (page|text|words)) bigger)$/, "^{ADD}", "Zoomed in."],
  [/^(zoom out|make (it|this|the (page|text|words)) smaller)$/, "^{SUBTRACT}", "Zoomed out."],
  [/^(reset (the )?zoom|normal size)$/, "^0", "Set the zoom back to normal."],
];

/** "Please, can you reload the page for me?" → "reload the page". */
export function tidy(text: string): string {
  return text
    .toLowerCase()
    .replace(/[!?,]+|\.(?!\w)/g, " ") // keeps the dots in "example.com"
    .replace(/^\s*(hey |ok |okay )?halo\b/, "")
    .replace(/\b(please|pls|for me|thanks|thank you|now|just|real quick)\b/g, "")
    .replace(/^\s*(can|could|would|will) you\s+/, "")
    .replace(/^\s*(i want to|i'd like to|i wanna|let's|lets)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A simple browser request Halo can do without the AI, or null. frontApp: the program in front ("Google Chrome"). */
export function quickAction(text: string, frontApp: string | null): QuickAction | null {
  const t = tidy(text);
  if (!t || t.length > 60) return null;
  const inBrowser = isBrowser(frontApp);

  if (inBrowser) {
    for (const [re, keys, did] of KEYS) if (re.test(t)) return { kind: "keys", keys, did };
  }

  // "go to youtube", "open the youtube home page", "take me to gmail", "youtube.com"
  const m = t.match(/^(?:go to|open|open up|take me to|show me|bring up|pull up|load|visit)?\s*(?:the\s+)?(.+?)(?:\s+(?:home ?page|website|site|page|homepage))?$/);
  const name = m?.[1]?.trim() ?? "";
  if (SITES[name]) return { kind: "go", url: SITES[name], did: `Opened ${titleCase(name)}.` };
  const domain = name.match(/^((?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|co|ca|uk|us|app|dev|ai|tv|me))$/);
  if (domain && /^(go to|open|visit|load|take me to)\b/.test(t)) return { kind: "go", url: `https://${domain[1]}`, did: `Opened ${domain[1]}.` };

  // "search youtube for cat videos", "search for cat videos", "google cat videos"
  const yt = t.match(/^(?:search(?: up)?|look up|find|pull up)\s+(?:on\s+)?youtube\s+for\s+(.+)$|^(?:search(?: up)?|look up|find|pull up)\s+(.+?)\s+on youtube$/);
  if (yt) {
    const q = (yt[1] ?? yt[2]).trim();
    return { kind: "go", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, did: `Searched YouTube for ${q}.` };
  }
  const g = t.match(/^(?:search(?: up| the web| google)?(?: for)?|google|look up)\s+(.+)$/);
  if (g) return { kind: "go", url: `https://www.google.com/search?q=${encodeURIComponent(g[1].trim())}`, did: `Searched for ${g[1].trim()}.` };

  return null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
