import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app, claims } from "./server";

describe("reimbursement API", () => {
  beforeEach(() => {
    // Tests use seeded claims; remove any claims created by earlier tests.
    for (let i = claims.length - 1; i >= 4; i--) claims.splice(i, 1);
  });

  it("requires an idempotency key and creates a claim", async () => {
    const body = { category: "meals", amount: 100, expenseDate: new Date().toISOString().slice(0, 10), description: "Test lunch" };
    const missing = await request(app).post("/claims").set("X-User-Id", "u1").send(body);
    expect(missing.status).toBe(400);
    const first = await request(app).post("/claims").set("X-User-Id", "u1").set("Idempotency-Key", "test-1").send(body);
    expect(first.status).toBe(201);
    const replay = await request(app).post("/claims").set("X-User-Id", "u1").set("Idempotency-Key", "test-1").send(body);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
  });

  it("requires a rejection reason and records status changes", async () => {
    const noReason = await request(app).post("/claims/c3/reject").set("X-User-Id", "u3").send({});
    expect(noReason.status).toBe(400);
    const rejected = await request(app).post("/claims/c3/reject").set("X-User-Id", "u3").send({ reason: "Missing receipt" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("REJECTED");
    expect(rejected.body.data.history.at(-1).reason).toBe("Missing receipt");
  });

  it("blocks employees from seeing other employees' claims", async () => {
    const response = await request(app).get("/claims/c3").set("X-User-Id", "u1");
    expect(response.status).toBe(404);
  });

  it("blocks finance from paying a submitted claim", async () => {
    const response = await request(app).post("/claims/c3/pay").set("X-User-Id", "u4");
    expect(response.status).toBe(404);
  });

  it("enforces monthly category limits", async () => {
    const body = { category: "travel", amount: 2000, expenseDate: "2026-10-20", description: "Extra travel" };
    const response = await request(app).post("/claims").set("X-User-Id", "u1").set("Idempotency-Key", "limit-test").send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MONTHLY_LIMIT_EXCEEDED");
  });
});
