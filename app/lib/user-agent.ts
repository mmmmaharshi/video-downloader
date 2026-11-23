export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export const CHROME_UA = `${UA} (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`;

// The header pair every JSON probe sends: one place for a UA or Accept change.
export const JSON_HEADERS = {
  Accept: "application/json",
  "User-Agent": CHROME_UA,
} as const;
