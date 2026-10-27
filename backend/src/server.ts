import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";

type Role = "employee" | "manager" | "finance";
type Status = "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";
type Category = "travel" | "meals" | "internet";
type User = { id: string; name: string; role: Role; managerId: string | null };
type AuditEvent = { id: string; actorId: string; timestamp: string; oldStatus: Status | null; newStatus: Status; reason?: string };
type Claim = {
  id: string; employeeId: string; category: Category; amount: number;
  expenseDate: string; description: string; status: Status; createdAt: string;
  history: AuditEvent[];
};
type IdempotencyEntry = { bodyHash: string; claimId: string };

export const users: User[] = [
  { id: "u1", name: "Asha", role: "employee", managerId: "u3" },
  { id: "u2", name: "Ravi", role: "employee", managerId: "u3" },
  { id: "u3", name: "Meera", role: "manager", managerId: null },
  { id: "u4", name: "Farhan", role: "finance", managerId: null }
];
export const monthlyLimits: Record<Category, number> = { travel: 10000, meals: 3000, internet: 1000 };

const initialClaims: Claim[] = [
  { id: "c1", employeeId: "u1", category: "travel", amount: 8500, expenseDate: "2026-10-05", description: "Client visit, Pune", status: "APPROVED", createdAt: "2026-10-05T10:00:00.000Z", history: [] },
  { id: "c2", employeeId: "u1", category: "meals", amount: 1200, expenseDate: "2026-10-05", description: "Team lunch", status: "REJECTED", createdAt: "2026-10-05T10:00:00.000Z", history: [{ id: "seed-c2", actorId: "u3", timestamp: "2026-10-06T10:00:00.000Z", oldStatus: "SUBMITTED", newStatus: "REJECTED", reason: "Outside policy" }] },
  { id: "c3", employeeId: "u2", category: "meals", amount: 2500, expenseDate: "2026-10-12", description: "Client dinner", status: "SUBMITTED", createdAt: "2026-10-12T10:00:00.000Z", history: [] },
  { id: "c4", employeeId: "u2", category: "internet", amount: 999, expenseDate: "2026-09-30", description: "September broadband", status: "PAID", createdAt: "2026-09-30T10:00:00.000Z", history: [{ id: "seed-c4", actorId: "u4", timestamp: "2026-10-02T10:00:00.000Z", oldStatus: "APPROVED", newStatus: "PAID" }] }
];

export const claims: Claim[] = structuredClone(initialClaims);
const idempotency = new Map<string, IdempotencyEntry>();

const app = express();
app.use(cors());
app.use(express.json());

function fail(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}
function currentUser(req: Request): User | undefined {
  const id = req.header("X-User-Id");
  return users.find(u => u.id === id);
}
function requireUser(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) return fail(res, 401, "UNAUTHENTICATED", "Provide a valid X-User-Id header.");
  res.locals.user = user;
  next();
}
function canSee(user: User, claim: Claim): boolean {
  if (user.role === "employee") return claim.employeeId === user.id;
  if (user.role === "manager") return users.some(u => u.id === claim.employeeId && u.managerId === user.id);
  return user.role === "finance" && (claim.status === "APPROVED" || claim.status === "PAID");
}
function visibleClaim(req: Request, res: Response): Claim | undefined {
  const user: User = res.locals.user;
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim || !canSee(user, claim)) return undefined;
  return claim;
}
function addHistory(claim: Claim, actor: User, next: Status, reason?: string) {
  const oldStatus = claim.status;
  claim.status = next;
  claim.history.push({
    id: randomUUID(), actorId: actor.id, timestamp: new Date().toISOString(),
    oldStatus, newStatus: next, ...(reason ? { reason } : {})
  });
}
function monthKey(date: string) { return date.slice(0, 7); }
function counted(c: Claim) { return c.status !== "REJECTED" && c.status !== "CANCELLED"; }
function amountUsed(employeeId: string, category: Category, month: string) {
  return claims.filter(c => c.employeeId === employeeId && c.category === category &&
    monthKey(c.expenseDate) === month && counted(c)).reduce((sum, c) => sum + c.amount, 0);
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/users", requireUser, (_req, res) => res.json({ data: users.map(({ id, name, role, managerId }) => ({ id, name, role, managerId })) }));
app.get("/limits", requireUser, (_req, res) => res.json({ data: monthlyLimits }));

app.post("/claims", requireUser, (req, res) => {
  const user: User = res.locals.user;
  if (user.role !== "employee") return fail(res, 403, "FORBIDDEN", "Only employees can submit claims.");
  const key = req.header("Idempotency-Key");
  if (!key?.trim()) return fail(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.");
  const { category, amount, expenseDate, description } = req.body ?? {};
  if (!Object.hasOwn(monthlyLimits, category)) return fail(res, 400, "INVALID_CATEGORY", "Category must be travel, meals, or internet.");
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100)
    return fail(res, 400, "INVALID_AMOUNT", "Amount must be greater than 0 with at most 2 decimal places.");
  if (typeof expenseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || Number.isNaN(Date.parse(expenseDate)))
    return fail(res, 400, "INVALID_EXPENSE_DATE", "expenseDate must be a valid YYYY-MM-DD date.");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const date = new Date(`${expenseDate}T00:00:00`);
  const oldest = new Date(today); oldest.setDate(oldest.getDate() - 60);
  if (date > today) return fail(res, 400, "FUTURE_EXPENSE_DATE", "Expense date cannot be in the future.");
  if (date < oldest) return fail(res, 400, "EXPENSE_DATE_TOO_OLD", "Expense date cannot be more than 60 days ago.");
  if (typeof description !== "string" || !description.trim() || description.trim().length > 500)
    return fail(res, 400, "INVALID_DESCRIPTION", "Description is required and must be 500 characters or fewer.");

  const requestBody = JSON.stringify({ category, amount, expenseDate, description: description.trim() });
  const idemKey = `${user.id}:${key}`;
  const existing = idempotency.get(idemKey);
  if (existing) {
    if (existing.bodyHash !== requestBody) return fail(res, 409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request.");
    const prior = claims.find(c => c.id === existing.claimId);
    if (prior) return res.status(200).json({ data: prior, idempotentReplay: true });
  }

  const month = monthKey(expenseDate);
  const used = amountUsed(user.id, category, month);
  const remaining = monthlyLimits[category] - used;
  if (amount > remaining) return fail(res, 400, "MONTHLY_LIMIT_EXCEEDED", `Monthly ${category} limit is ₹${monthlyLimits[category]}. ₹${Math.max(0, remaining).toFixed(2)} remains for ${month}.`);

  // Synchronous in-memory check-and-insert prevents interleaving within this Node process.
  const claim: Claim = {
    id: `c-${randomUUID().slice(0, 8)}`, employeeId: user.id, category, amount,
    expenseDate, description: description.trim(), status: "SUBMITTED",
    createdAt: new Date().toISOString(), history: []
  };
  claims.push(claim);
  idempotency.set(idemKey, { bodyHash: requestBody, claimId: claim.id });
  return res.status(201).json({ data: claim });
});

app.get("/claims", requireUser, (req, res) => {
  const user: User = res.locals.user;
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20));
  let result = claims.filter(c => canSee(user, c));
  if (req.query.status) result = result.filter(c => c.status === req.query.status);
  if (req.query.category) result = result.filter(c => c.category === req.query.category);
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = result.length;
  const data = result.slice((page - 1) * limit, page * limit);
  res.json({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

app.get("/claims/:id", requireUser, (req, res) => {
  const claim = visibleClaim(req, res);
  if (!claim) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim was not found or you do not have permission to view it.");
  return res.json({ data: claim });
});

app.post("/claims/:id/approve", requireUser, (req, res) => {
  const user: User = res.locals.user;
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim not found.");
  const employee = users.find(u => u.id === claim.employeeId);
  if (user.role !== "manager" || employee?.managerId !== user.id) return fail(res, 403, "FORBIDDEN", "Only the employee's direct manager can approve this claim.");
  if (claim.employeeId === user.id) return fail(res, 403, "SELF_APPROVAL_FORBIDDEN", "You cannot approve your own claim.");
  if (claim.status !== "SUBMITTED") return fail(res, 409, "INVALID_STATUS_TRANSITION", "Only SUBMITTED claims can be approved.");
  addHistory(claim, user, "APPROVED");
  return res.json({ data: claim });
});

app.post("/claims/:id/reject", requireUser, (req, res) => {
  const user: User = res.locals.user;
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim not found.");
  const employee = users.find(u => u.id === claim.employeeId);
  if (user.role !== "manager" || employee?.managerId !== user.id) return fail(res, 403, "FORBIDDEN", "Only the employee's direct manager can reject this claim.");
  if (claim.employeeId === user.id) return fail(res, 403, "SELF_APPROVAL_FORBIDDEN", "You cannot reject your own claim.");
  if (claim.status !== "SUBMITTED") return fail(res, 409, "INVALID_STATUS_TRANSITION", "Only SUBMITTED claims can be rejected.");
  const reason = req.body?.reason;
  if (typeof reason !== "string" || !reason.trim()) return fail(res, 400, "REJECTION_REASON_REQUIRED", "A reason is required to reject a claim.");
  addHistory(claim, user, "REJECTED", reason.trim());
  return res.json({ data: claim });
});

app.post("/claims/:id/pay", requireUser, (req, res) => {
  const user: User = res.locals.user;
  if (user.role !== "finance") return fail(res, 403, "FORBIDDEN", "Only finance can pay claims.");
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim || !canSee(user, claim)) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim was not found or you do not have permission to view it.");
  if (claim.status !== "APPROVED") return fail(res, 409, "INVALID_STATUS_TRANSITION", "Only APPROVED claims can be paid.");
  addHistory(claim, user, "PAID");
  return res.json({ data: claim });
});

app.post("/claims/:id/cancel", requireUser, (req, res) => {
  const user: User = res.locals.user;
  const claim = claims.find(c => c.id === req.params.id);
  if (!claim) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim not found.");
  if (user.role !== "employee" || claim.employeeId !== user.id) return fail(res, 403, "FORBIDDEN", "Only the claim owner can cancel their claim.");
  if (claim.status !== "SUBMITTED") return fail(res, 409, "INVALID_STATUS_TRANSITION", "Only SUBMITTED claims can be cancelled.");
  addHistory(claim, user, "CANCELLED");
  return res.json({ data: claim });
});

app.get("/claims/:id/history", requireUser, (req, res) => {
  const claim = visibleClaim(req, res);
  if (!claim) return fail(res, 404, "CLAIM_NOT_FOUND", "Claim was not found or you do not have permission to view it.");
  return res.json({ data: claim.history });
});

// Serve the built UI (single-service deploy) when frontend/dist exists.
const uiDir = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(uiDir)) {
  app.use(express.static(uiDir));
  app.get(/^\/(?!claims|users|limits|health).*/, (_req, res) => res.sendFile(path.join(uiDir, "index.html")));
}

export { app };
if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => console.log(`Reimbursement API listening on http://localhost:${port}`));
}
