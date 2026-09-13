import {
  ApiError,
  apiErrorResponse,
  parseCreateProductRequest,
  parseCreateStoreRequest,
  parseIdempotencyKey,
  parseIfMatch,
  parseCreatePriceRequest,
} from "./api.ts";

export type HttpRequest = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: unknown;
  requestId: string;
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type CatalogHttpDependencies = {
  createStore?: (input: ReturnType<typeof parseCreateStoreRequest>, context: RequestContext) => Promise<unknown>;
  createProduct?: (input: ReturnType<typeof parseCreateProductRequest>, context: RequestContext) => Promise<unknown>;
  createPrice?: (input: ReturnType<typeof parseCreatePriceRequest>, context: RequestContext) => Promise<unknown>;
};

export type RequestContext = {
  organizationId: string;
  actorId: string;
  permissions: readonly string[];
};

function requireContext(request: HttpRequest): RequestContext {
  const organizationId = request.headers["x-organization-id"];
  const actorId = request.headers["x-actor-id"];
  const permissions = request.headers["x-permissions"]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!organizationId || !actorId) throw new ApiError(401, "UNAUTHORIZED", "Authentication is required");
  return { organizationId, actorId, permissions };
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.includes(permission)) throw new ApiError(403, "FORBIDDEN", "You do not have permission for this resource");
}

function json(status: number, body: unknown): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

export async function handleCatalogRequest(request: HttpRequest, dependencies: CatalogHttpDependencies): Promise<HttpResponse> {
  try {
    const context = requireContext(request);
    if (request.method === "POST" && request.path === "/stores") {
      requirePermission(context, "store.create");
      parseIdempotencyKey(request.headers["idempotency-key"] ?? null);
      const input = parseCreateStoreRequest(request.body);
      if (input.organizationId !== context.organizationId) throw new ApiError(403, "FORBIDDEN", "You do not have permission for this resource");
      if (!dependencies.createStore) throw new ApiError(503, "INTERNAL_ERROR", "Service unavailable");
      return json(201, await dependencies.createStore(input, context));
    }
    if (request.method === "POST" && request.path === "/products") {
      requirePermission(context, "product.create");
      parseIdempotencyKey(request.headers["idempotency-key"] ?? null);
      const input = parseCreateProductRequest(request.body);
      if (input.organizationId !== context.organizationId) throw new ApiError(403, "FORBIDDEN", "You do not have permission for this resource");
      if (!dependencies.createProduct) throw new ApiError(503, "INTERNAL_ERROR", "Service unavailable");
      return json(201, await dependencies.createProduct(input, context));
    }
    const priceMatch = /^\/stores\/([^/]+)\/prices$/.exec(request.path);
    if (request.method === "POST" && priceMatch) {
      requirePermission(context, "product.change_price");
      parseIdempotencyKey(request.headers["idempotency-key"] ?? null);
      const ifMatch = parseIfMatch(request.headers["if-match"] ?? null);
      const input = parseCreatePriceRequest(request.body);
      if (input.organizationId !== context.organizationId || input.storeId !== priceMatch[1]) throw new ApiError(403, "FORBIDDEN", "You do not have permission for this resource");
      if (!dependencies.createPrice) throw new ApiError(503, "INTERNAL_ERROR", "Service unavailable");
      return json(201, await dependencies.createPrice({ ...input, revision: String(ifMatch) }, context));
    }
    return json(404, { error: { code: "NOT_FOUND", message: "Route not found", requestId: request.requestId } });
  } catch (error) {
    const response = apiErrorResponse(error, request.requestId);
    return json(response.status, response.body);
  }
}

export function requestHeaders(headers: Headers): Record<string, string | undefined> {
  return Object.fromEntries(["x-organization-id", "x-actor-id", "x-permissions", "idempotency-key", "if-match"].map((name) => [name, headers.get(name) ?? undefined]));
}
