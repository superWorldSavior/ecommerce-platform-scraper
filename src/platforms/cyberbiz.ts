import {
  capImageCandidateSelection,
  type ImageCandidateDecision,
  type ImageCandidateSelection,
  imageCandidateUrlLookupVariants,
  normalizeImageCandidateHtml,
} from "../kernel/image-candidates.ts";

export const CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES = 16;

export function cyberbizImageContextWindows(
  normalizedHtml: string,
  url: string,
  radius = 900,
): string[] {
  const contexts: string[] = [];
  for (const variant of imageCandidateUrlLookupVariants(url)) {
    let start = 0;
    while (true) {
      const index = normalizedHtml.indexOf(variant, start);
      if (index < 0) break;
      contexts.push(
        normalizedHtml.slice(
          Math.max(0, index - radius),
          Math.min(normalizedHtml.length, index + variant.length + radius),
        ),
      );
      start = index + variant.length;
    }
  }
  return contexts;
}

export function decideCyberbizContentImageContext(
  context: string,
): ImageCandidateDecision | null {
  if (isCyberbizMobileDuplicateContext(context)) {
    return {
      keep: false,
      reason: "duplicate",
      note: "Cyberbiz responsive mobile duplicate",
    };
  }
  if (isCyberbizDecorativeContext(context)) {
    return {
      keep: false,
      reason: "decorative_asset",
      note: "Cyberbiz decorative content image",
    };
  }
  if (isCyberbizStoryContext(context)) {
    return {
      keep: false,
      reason: "brand_story_asset",
      note: "Cyberbiz testimonial/storytelling image",
    };
  }
  return null;
}

export function decideCyberbizContentImageByHtmlContext(
  html: string,
  url: string,
): ImageCandidateDecision | null {
  const normalizedHtml = normalizeImageCandidateHtml(html);
  for (const context of cyberbizImageContextWindows(normalizedHtml, url, 260)) {
    const decision = decideCyberbizContentImageContext(context);
    if (decision !== null) return decision;
  }
  return null;
}

export function capCyberbizImageCandidateSelection(
  selection: ImageCandidateSelection,
  maxSelected = CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES,
): ImageCandidateSelection {
  return capImageCandidateSelection(selection, {
    maxSelected,
    reason: "brand_story_asset",
    note: `Cyberbiz selected image cap ${maxSelected}`,
  });
}

function isCyberbizMobileDuplicateContext(context: string): boolean {
  return /class=["'](?=[^"']*\buse_main_st_bg\b)(?=[^"']*\b(?:mo|mobile|tp)\b)[^"']*["']/iu
    .test(context);
}

function isCyberbizDecorativeContext(context: string): boolean {
  return /class=["'][^"']*(?:\belement_img_icon\b|\bnew_pd_bg\b)/iu.test(
    context,
  ) ||
    /(?:<video\b[^>]*\bposter=|product_pop_in_top|product_pop)/iu.test(
      context,
    );
}

function isCyberbizStoryContext(context: string): boolean {
  return /class=["'][^"']*(?:\bperson_img\b|\bendorser\b)/iu.test(context) ||
    /(?:代言|見證|心得|testimonial)/iu.test(context);
}
