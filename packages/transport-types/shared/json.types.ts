/**
 * JSON value helper types shared across transport contracts.
 * These provide safe alternatives to `any` for payload metadata and
 * dynamic content persisted in JSONB columns.
 */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | JsonArray;

export type JsonArray = JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
