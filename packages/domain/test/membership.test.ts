import test from "node:test";
import assert from "node:assert/strict";
import { canPerform, requirePermission, type Membership } from "../src/index.ts";

const activeViewer: Membership = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  actorId: "00000000-0000-0000-0000-000000000002",
  role: "VIEWER",
  status: "ACTIVE",
};

test("hierarquia permite apenas o nível exigido ou superior", () => {
  assert.equal(canPerform("OWNER", "ADMIN"), true);
  assert.equal(canPerform("MANAGER", "OPERATOR"), true);
  assert.equal(canPerform("VIEWER", "OPERATOR"), false);
  assert.equal(canPerform("ADMIN", "OWNER"), false);
});

test("permissão exige membership ativa", () => {
  assert.equal(requirePermission(activeViewer, "VIEWER"), activeViewer);
  assert.throws(() => requirePermission(activeViewer, "OPERATOR"), /FORBIDDEN/);
  assert.throws(() => requirePermission({ ...activeViewer, status: "SUSPENDED" }, "VIEWER"), /FORBIDDEN/);
  assert.throws(() => requirePermission(null, "VIEWER"), /FORBIDDEN/);
});
