import { parseInteger, positive } from "./quantities.ts";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PRECONDITION_REQUIRED";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (fieldErrors) this.fieldErrors = fieldErrors;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY = /^[A-Z]{3}$/;
const CHANNELS = ["POS", "STOREFRONT", "MANUAL", "IFOOD", "B2B"] as const;
const STOCK_UNITS = ["G", "UNIT"] as const;
const SALE_STRATEGIES = ["WEIGHT_FREE", "WEIGHT_INCREMENT", "FIXED_PACKAGE", "APPROXIMATE_UNIT", "MINIMUM_WEIGHT", "UNIT"] as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body must be an object");
  }
  return value as JsonObject;
}

function strictKeys(value: JsonObject, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const firstUnknown = unknown[0];
  if (firstUnknown) throw new ApiError(400, "VALIDATION_ERROR", "Request contains unknown fields", { [firstUnknown]: "unknown field" });
}

function stringField(body: JsonObject, field: string, maxLength: number): string {
  if (typeof body[field] !== "string" || !body[field].trim() || body[field].length > maxLength) {
    throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`, { [field]: `required string of at most ${maxLength} characters` });
  }
  return body[field].trim();
}

function uuidField(body: JsonObject, field: string): string {
  const value = stringField(body, field, 36);
  if (!UUID.test(value)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`, { [field]: "must be a UUID" });
  return value;
}

function enumField<T extends string>(body: JsonObject, field: string, values: readonly T[]): T {
  const value = stringField(body, field, 40);
  if (!values.includes(value as T)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`, { [field]: `must be one of ${values.join(", ")}` });
  return value as T;
}

export type CreateStoreRequest = { id: string; organizationId: string; name: string; slug: string };
export function parseCreateStoreRequest(value: unknown): CreateStoreRequest {
  const body = object(value);
  strictKeys(body, ["id", "organizationId", "name", "slug"]);
  const slug = stringField(body, "slug", 80);
  if (!SLUG.test(slug)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid slug", { slug: "must be lowercase kebab-case" });
  return { id: uuidField(body, "id"), organizationId: uuidField(body, "organizationId"), name: stringField(body, "name", 200), slug };
}

export type CreateProductRequest = { id: string; organizationId: string; sku: string; name: string; stockUnit: "G" | "UNIT"; saleStrategy: typeof SALE_STRATEGIES[number] };
export function parseCreateProductRequest(value: unknown): CreateProductRequest {
  const body = object(value);
  strictKeys(body, ["id", "organizationId", "sku", "name", "stockUnit", "saleStrategy"]);
  const stockUnit = enumField(body, "stockUnit", STOCK_UNITS);
  const saleStrategy = enumField(body, "saleStrategy", SALE_STRATEGIES);
  if ((stockUnit === "UNIT") !== (saleStrategy === "UNIT")) throw new ApiError(400, "VALIDATION_ERROR", "Invalid product sale configuration", { saleStrategy: "UNIT requires UNIT stockUnit and vice versa" });
  return { id: uuidField(body, "id"), organizationId: uuidField(body, "organizationId"), sku: stringField(body, "sku", 80), name: stringField(body, "name", 200), stockUnit, saleStrategy };
}

export type CreatePriceRequest = { id: string; organizationId: string; storeId: string; productId: string; channel: typeof CHANNELS[number]; amountMinor: string; currency: string; revision: string };
export function parseCreatePriceRequest(value: unknown): CreatePriceRequest {
  const body = object(value);
  strictKeys(body, ["id", "organizationId", "storeId", "productId", "channel", "amountMinor", "currency", "revision"]);
  let amountMinor: string;
  let revision: string;
  try {
    amountMinor = parseInteger(body.amountMinor).toString();
    revision = positive(parseInteger(body.revision)).toString();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid price number");
  }
  const currency = stringField(body, "currency", 3);
  if (!CURRENCY.test(currency)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid currency", { currency: "must be three uppercase letters" });
  return { id: uuidField(body, "id"), organizationId: uuidField(body, "organizationId"), storeId: uuidField(body, "storeId"), productId: uuidField(body, "productId"), channel: enumField(body, "channel", CHANNELS), amountMinor, currency, revision };
}

export function parseIfMatch(value: string | null): number {
  if (!value) throw new ApiError(428, "PRECONDITION_REQUIRED", "If-Match header is required");
  const match = /^"([1-9]\d*)"$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ApiError(400, "VALIDATION_ERROR", "Invalid If-Match header");
  return Number(match[1]);
}

export function parseIdempotencyKey(value: string | null): string {
  if (!value || value.length < 1 || value.length > 128) throw new ApiError(400, "VALIDATION_ERROR", "Idempotency-Key header is required");
  return value;
}

export function apiErrorResponse(error: unknown, requestId: string): { status: number; body: { error: { code: string; message: string; fieldErrors?: Record<string, string>; requestId: string } } } {
  if (error instanceof ApiError) return { status: error.status, body: { error: { code: error.code, message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}), requestId } } };
  if (error instanceof Error && error.message === "FORBIDDEN") return { status: 403, body: { error: { code: "FORBIDDEN", message: "You do not have permission for this resource", requestId } } };
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId } } };
}
