import { assertEquals, assertThrows } from "@std/assert";
import {
  BASE_ARTIFACT_ROLES,
  defineRoleVocabulary,
  RoleVocabularyError,
  selectProjectionContext,
} from "../src/kernel/artifact-context.ts";
import type {
  ArtifactClassification,
  ArtifactContextArtifact,
} from "../src/kernel/artifact-context.ts";

const ROLES = [...BASE_ARTIFACT_ROLES, "datasheet"] as const;
type Role = typeof ROLES[number];

const vocabulary = defineRoleVocabulary<Role>({
  roles: ROLES,
  preferences: { specs: ["html", "datasheet"] },
});

function artifact(id: string, kind = "image"): ArtifactContextArtifact {
  return {
    id,
    artifactKind: kind,
    rawMarkdown: `content-${id}`,
    capturedAt: new Date(0),
  };
}

function classification(
  artifacts: ReadonlyArray<{ id: string; roles: Role[] }>,
): ArtifactClassification<Role> {
  return {
    providerName: "test",
    selectionMode: "role-filtered",
    fallbackReason: null,
    artifacts: artifacts.map((entry) => ({
      artifact: artifact(entry.id),
      roles: entry.roles,
      reason: null,
    })),
  };
}

Deno.test("defineRoleVocabulary rejette un rôle structurel absent de roles", () => {
  assertThrows(
    () =>
      defineRoleVocabulary({
        roles: ["a", "unknown"] as const,
        structural: "missing" as "a",
        preferences: {},
      }),
    RoleVocabularyError,
  );
});

Deno.test("defineRoleVocabulary rejette une préférence citant un rôle inconnu", () => {
  assertThrows(
    () =>
      defineRoleVocabulary({
        roles: ["html", "unknown"] as const,
        preferences: { specs: ["ghost" as "html"] },
      }),
    RoleVocabularyError,
  );
});

Deno.test("defineRoleVocabulary dérive le bruit depuis la base", () => {
  assertEquals([...vocabulary.noise].sort(), [
    "promo",
    "related-product",
    "ui",
  ]);
});

Deno.test("selectProjectionContext filtre sur les rôles préférés", () => {
  const artifacts = [artifact("a"), artifact("b")];
  const context = selectProjectionContext({
    projection: "specs",
    artifacts,
    classification: classification([
      { id: "a", roles: ["datasheet"] },
      { id: "b", roles: ["promo"] },
    ]),
    vocabulary,
  });

  assertEquals(context.artifacts.map((a) => a.id), ["a"]);
  assertEquals(context.stats.selected, 1);
  assertEquals(context.stats.dropped, 1);
  assertEquals(context.fallbackReason, null);
});

Deno.test("selectProjectionContext retombe en contexte complet sans provider", () => {
  const artifacts = [artifact("a", "html")];
  const context = selectProjectionContext({
    projection: "specs",
    artifacts,
    classification: null,
    vocabulary,
  });

  assertEquals(context.fallbackReason, "NO_PROVIDER");
  assertEquals(context.artifacts.length, 1);
  assertEquals(context.stats.roles.html, 1);
});

Deno.test("selectProjectionContext retombe quand une projection n'a pas de préférence", () => {
  const context = selectProjectionContext({
    projection: "projection-inconnue",
    artifacts: [artifact("a")],
    classification: classification([{ id: "a", roles: ["datasheet"] }]),
    vocabulary,
  });

  assertEquals(context.fallbackReason, null);
  assertEquals(context.artifacts.length, 1);
});

Deno.test("selectProjectionContext retombe quand le filtre ne laisse rien", () => {
  const context = selectProjectionContext({
    projection: "specs",
    artifacts: [artifact("a")],
    classification: classification([{ id: "a", roles: ["certificate"] }]),
    vocabulary,
  });

  assertEquals(context.fallbackReason, "NO_SELECTED_ARTIFACTS");
  assertEquals(context.artifacts.length, 1);
});

Deno.test("un artefact structurel échappe au filtre de bruit", () => {
  const context = selectProjectionContext({
    projection: "specs",
    artifacts: [artifact("a")],
    classification: classification([{ id: "a", roles: ["html", "promo"] }]),
    vocabulary,
  });

  assertEquals(context.artifacts.map((a) => a.id), ["a"]);
  assertEquals(context.fallbackReason, null);
});
