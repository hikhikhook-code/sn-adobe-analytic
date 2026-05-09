import type { DataProvider } from "./types";
import { ProviderNotImplementedError } from "./types";

/**
 * Placeholder for a future provider that pulls data from an officially
 * supported Adobe source — for example:
 *   - Adobe Stock Search API (when contributor analytics endpoints exist)
 *   - A Contributor's signed analytics export (CSV/JSON they download from
 *     Adobe Contributor Portal)
 *
 * This provider is intentionally NOT implemented. There is no live scraping
 * here, no proxy rotation, no UA evasion, no private/internal API access.
 *
 * To wire up a real source, replace the bodies below with calls to the
 * official source and emit `dataQuality: "verified"` for first-party data.
 */
export const officialAdobeProvider: DataProvider = {
  id: "official",
  name: "Official Adobe data provider",
  dataQuality: "verified",

  async search() {
    throw new ProviderNotImplementedError("official");
  },

  async contributor() {
    throw new ProviderNotImplementedError("official");
  },

  async heatmap() {
    throw new ProviderNotImplementedError("official");
  },

  async trending() {
    throw new ProviderNotImplementedError("official");
  },
};
