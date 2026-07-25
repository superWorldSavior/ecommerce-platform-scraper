/**
 * Axe technique du storefront, distinct du site lui-même.
 *
 * - `SourceModule.name` reste l'unité runtime de scraping (un site).
 * - `commercePlatform.kind` regroupe les sites qui partagent un moteur de
 *   boutique, et donc des primitives mutualisables (`platforms/shopline`,
 *   `platforms/cyberbiz`, `platforms/bvshop`).
 * - `custom` est un bucket d'**absence** de moteur commun, pas un moteur. Les
 *   sites sur mesure le déclarent avec leur propre libellé.
 *
 * Les places de marché sortent du cadre : le gabarit de page y appartient à la
 * marketplace et non au vendeur, donc un adapter par vendeur n'aurait pas de
 * sens — c'est un adapter par marketplace qu'il faudrait.
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

/** Storefront sans moteur commun identifié. Le libellé est libre. */
export function customCommercePlatform(label: string): CommercePlatform {
  return { kind: "custom", label };
}
