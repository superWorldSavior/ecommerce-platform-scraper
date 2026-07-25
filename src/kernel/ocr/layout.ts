export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export type OcrCoordinateSystem =
  | "normalized-lower-left"
  | "normalized-upper-left";

export interface OcrBoundingBox {
  readonly [key: string]: JsonValue;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OcrLayoutLine {
  readonly [key: string]: JsonValue;
  readonly text: string;
  readonly confidence: number;
  readonly boundingBox: OcrBoundingBox | null;
}

export interface OcrLayoutDocument {
  readonly [key: string]: JsonValue;
  readonly provider: string;
  readonly coordinateSystem: OcrCoordinateSystem;
  readonly lines: readonly OcrLayoutLine[];
}

export function parseOcrLayoutDocument(
  value: unknown,
): OcrLayoutDocument | null {
  if (!isRecord(value)) return null;

  const provider = value.provider;
  const coordinateSystem = value.coordinateSystem;
  const rawLines = value.lines;
  if (typeof provider !== "string") return null;
  if (!isOcrCoordinateSystem(coordinateSystem)) return null;
  if (!Array.isArray(rawLines)) return null;

  const lines: OcrLayoutLine[] = [];
  for (const rawLine of rawLines) {
    const line = parseOcrLayoutLine(rawLine);
    if (line !== null) lines.push(line);
  }
  if (lines.length === 0) return null;

  return { provider, coordinateSystem, lines };
}

function parseOcrLayoutLine(value: unknown): OcrLayoutLine | null {
  if (!isRecord(value)) return null;
  const text = value.text;
  const confidence = value.confidence;
  if (typeof text !== "string") return null;
  if (!isNormalizedNumber(confidence)) return null;

  return {
    text,
    confidence,
    boundingBox: parseOcrBoundingBox(value.boundingBox),
  };
}

function parseOcrBoundingBox(value: unknown): OcrBoundingBox | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (!isFiniteNumber(x)) return null;
  if (!isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width)) return null;
  if (!isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0) return null;
  if (x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
}

function isOcrCoordinateSystem(value: unknown): value is OcrCoordinateSystem {
  return value === "normalized-lower-left" ||
    value === "normalized-upper-left";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNormalizedNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}
