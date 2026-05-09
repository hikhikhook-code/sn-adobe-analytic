import type { DataProvider } from "./types";
import { ProviderNotImplementedError } from "./types";

/**
 * Placeholder for a provider that reads from a user-uploaded CSV/JSON export
 * (e.g. a contributor downloads their own Adobe Stock analytics, then uploads
 * the file to SN Adobe Analytic). Unlike the live scraper concept, this is a
 * pull from the user's own data — there is no fetching from Adobe servers.
 *
 * To wire it up, parse the uploaded file, store it in a `ManualImport` table
 * (not yet in the schema), and resolve queries against that store. Emit
 * `dataQuality: "verified"` for fields the user explicitly provided.
 */
export const manualImportProvider: DataProvider = {
  id: "manual",
  name: "Manual import data provider",
  dataQuality: "verified",

  async search() {
    throw new ProviderNotImplementedError("manual");
  },

  async contributor() {
    throw new ProviderNotImplementedError("manual");
  },

  async heatmap() {
    throw new ProviderNotImplementedError("manual");
  },

  async trending() {
    throw new ProviderNotImplementedError("manual");
  },
};
