/**
 * The technical axis of a storefront, distinct from the site itself.
 *
 * - `SourceModule.name` remains the runtime unit of scraping (one site).
 * - `commercePlatform.kind` groups the sites that share a commerce engine, and
 *   therefore share reusable primitives (`platforms/shopline`,
 *   `platforms/cyberbiz`, `platforms/bvshop`).
 * - `custom` is a bucket for the **absence** of a common engine, not an engine.
 *   Bespoke sites declare it with a label of their own.
 *
 * Marketplaces are out of scope: there the page template belongs to the
 * marketplace rather than to the seller, so a per-seller adapter would make no
 * sense — what you would need is a per-marketplace adapter.
 */

export type CommercePlatformKind =
  | "shopline"
  | "cyberbiz"
  | "bvshop"
  | "custom";

export interface CommercePlatform {
  readonly kind: CommercePlatformKind;
  readonly label: string;
}

export const SHOPLINE_COMMERCE_PLATFORM = {
  kind: "shopline",
  label: "SHOPLINE",
} as const satisfies CommercePlatform;

export const CYBERBIZ_COMMERCE_PLATFORM = {
  kind: "cyberbiz",
  label: "CYBERBIZ",
} as const satisfies CommercePlatform;

export const BVSHOP_COMMERCE_PLATFORM = {
  kind: "bvshop",
  label: "BV SHOP",
} as const satisfies CommercePlatform;

/** Storefront with no identified common engine. The label is free-form. */
export function customCommercePlatform(label: string): CommercePlatform {
  return { kind: "custom", label };
}
