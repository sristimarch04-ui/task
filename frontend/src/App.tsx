import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutDashboard, ReceiptText, WalletCards, CircleCheck, Search, Plus, Bell, ChevronDown, Clock3, Check, X, CreditCard, History, RefreshCw, FileText, ShieldCheck } from "lucide-react";

const rawApi = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:4000" : "");
const API = (rawApi && !/^https?:\/\//.test(rawApi) ? `https://${rawApi}` : rawApi).replace(/\/$/, "");
type Role = "employee" | "manager" | "finance";
type Status = "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID" | "CANCELLED";
type User = { id: string; name: string; role: Role; managerId: string | null };
type Claim = { id: string; employeeId: string; category: string; amount: number; expenseDate: string; description: string; status: Status; createdAt: string; history?: { actorId: string; timestamp: string; oldStatus: Status | null; newStatus: Status; reason?: string }[] };
const demoUsers: User[] = [
  { id: "u1", name: "Asha", role: "employee", managerId: "u3" },
  { id: "u2", name: "Ravi", role: "employee", managerId: "u3" },
  { id: "u3", name: "Meera", role: "manager", managerId: null },
  { id: "u4", name: "Farhan", role: "finance", managerId: null }
];
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const initials = (name: string) => name.split(" ").map(x => x[0]).join("");

export default function App() {
  const [userId, setUserId] = useState("u1");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Claim | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [form, setForm] = useState({ category: "travel", amount: "", expenseDate: new Date().toISOString().slice(0, 10), description: "" });
  const [page, setPage] = useState(1);
  const user = demoUsers.find(u => u.id === userId)!;
  const employeeName = (id: string) => demoUsers.find(u => u.id === id)?.name ?? id;

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || "Request failed");
    return data;
  }, [userId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/claims?page=${page}&limit=50`);
      setClaims(data.data);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load claims");
    } finally { setLoading(false); }
  }, [api, page]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setStatusFilter("ALL"); setCategoryFilter("ALL"); setPage(1); setDetail(null); }, [userId]);

  const visible = useMemo(() => claims.filter(c =>
    (statusFilter === "ALL" || c.status === statusFilter) &&
    (categoryFilter === "ALL" || c.category === categoryFilter) &&
    `${c.id} ${c.description} ${employeeName(c.employeeId)} ${c.category}`.toLowerCase().includes(query.toLowerCase())
  ), [claims, statusFilter, categoryFilter, query]);
  const pending = claims.filter(c => c.status === "SUBMITTED").length;
  const approved = claims.filter(c => c.status === "APPROVED").length;
  const paidTotal = claims.filter(c => c.status === "PAID").reduce((sum, c) => sum + c.amount, 0);
  const totalAmount = claims.reduce((sum, c) => sum + c.amount, 0);

  async function runAction(path: string, method = "POST", body?: unknown) {
    try {
      await api(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      setNotice("Changes saved successfully.");
      setRejectId(null); setRejectReason(""); setDetail(null);
      await refresh();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Action failed"); }
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/claims", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
      setNotice("Claim submitted successfully.");
      setShowForm(false);
      setForm({ category: "travel", amount: "", expenseDate: new Date().toISOString().slice(0, 10), description: "" });
      await refresh();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not submit claim"); }
  }

  async function openDetail(claim: Claim) {
    try { const result = await api(`/claims/${claim.id}`); setDetail(result.data); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Could not open claim"); }
  }

  const canReview = user.role === "manager";
  const canPay = user.role === "finance";
  const canSubmit = user.role === "employee";
  const statusClass = (status: Status) => `status status-${status.toLowerCase()}`;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><WalletCards size={21}/></div><span>reimburse<span className="brand-dot">.</span></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>
        <button className="nav-item active"><LayoutDashboard size={18}/> Overview</button>
        <button className="nav-item" onClick={() => { setStatusFilter("ALL"); setCategoryFilter("ALL"); }}><ReceiptText size={18}/> All claims <span className="nav-count">{claims.length}</span></button>
        {canReview && <button className="nav-item" onClick={() => setStatusFilter("SUBMITTED")}><Clock3 size={18}/> Needs review <span className="nav-count">{pending}</span></button>}
        {canPay && <button className="nav-item" onClick={() => setStatusFilter("APPROVED")}><CreditCard size={18}/> Ready to pay <span className="nav-count">{approved}</span></button>}
        <button className="nav-item" onClick={() => setNotice("Audit events are available in each claim's detail view.")}><History size={18}/> Audit history</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><div className="help-icon"><ShieldCheck size={17}/></div><strong>Spend with confidence</strong><p>Every claim is tracked from submission to payout.</p></div>
        <div className="profile">
          <div className="avatar">{initials(user.name)}</div><div className="profile-copy"><strong>{user.name}</strong><span>{titleCase(user.role)}</span></div>
          <ChevronDown size={16} className="muted"/>
        </div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> Overview</div><div className="top-actions">
        <label className="demo-role">Demo user <select value={userId} onChange={e => setUserId(e.target.value)}>{demoUsers.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></label>
        <button className="icon-btn" aria-label="Notifications" onClick={() => setNotice("You're all caught up.")}><Bell size={18}/><i/></button>
        <div className="top-avatar">{initials(user.name)}</div>
      </div></header>

      <div className="content">
        <div className="page-heading"><div><div className="eyebrow">MONDAY, OCTOBER 26, 2026</div><h1>{user.role === "employee" ? `Good day, ${user.name}` : user.role === "manager" ? "Review & approve" : "Finance overview"} <span>✦</span></h1><p>{user.role === "employee" ? "Keep your work expenses organized, all in one place." : user.role === "manager" ? "Your team's claims, ready for your attention." : "Approved reimbursements, ready for payout."}</p></div>
          {canSubmit && <button className="primary-btn" onClick={() => setShowForm(true)}><Plus size={18}/> New claim</button>}
        </div>

        {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")}><X size={16}/></button></div>}

        <div className="stats-grid">
          <div className="stat-card"><div className="stat-top"><span>{user.role === "employee" ? "My claims" : "Visible claims"}</span><div className="stat-icon purple"><FileText size={18}/></div></div><div className="stat-number">{claims.length}</div><div className="stat-foot"><span className="neutral-dot"/> Across all statuses</div></div>
          <div className="stat-card"><div className="stat-top"><span>{canPay ? "Ready to pay" : canReview ? "Awaiting review" : "In progress"}</span><div className="stat-icon amber"><Clock3 size={18}/></div></div><div className="stat-number">{canPay ? approved : pending}</div><div className="stat-foot"><span className="amber-dot"/> Needs your attention</div></div>
          <div className="stat-card"><div className="stat-top"><span>{canPay ? "Total paid" : "Approved claims"}</span><div className="stat-icon green"><CircleCheck size={18}/></div></div><div className="stat-number small-number">{canPay ? money(paidTotal) : claims.filter(c => c.status === "APPROVED" || c.status === "PAID").length}</div><div className="stat-foot"><span className="green-dot"/> {canPay ? "Successfully reimbursed" : "Approved or paid"}</div></div>
          <div className="stat-card"><div className="stat-top"><span>Total claim value</span><div className="stat-icon blue"><WalletCards size={18}/></div></div><div className="stat-number small-number">{money(totalAmount)}</div><div className="stat-foot"><span className="neutral-dot"/> Current visible records</div></div>
        </div>

        <section className="claims-panel">
          <div className="panel-heading"><div><h2>{canReview ? "Team claims" : canPay ? "Payment queue" : "Your claims"}</h2><p>Manage and track reimbursement requests.</p></div><button className="subtle-btn" onClick={refresh}><RefreshCw size={15}/> Refresh</button></div>
          <div className="filters"><div className="search-box"><Search size={17}/><input placeholder="Search claims..." value={query} onChange={e => setQuery(e.target.value)}/></div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{(["SUBMITTED","APPROVED","REJECTED","PAID","CANCELLED"] as Status[]).map(s => <option key={s} value={s}>{titleCase(s)}</option>)}</select>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="ALL">All categories</option><option value="travel">Travel</option><option value="meals">Meals</option><option value="internet">Internet</option></select>
          </div>
          <div className="table-wrap"><table><thead><tr>{canReview && <th>EMPLOYEE</th>}<th>CLAIM</th><th>CATEGORY</th><th>EXPENSE DATE</th><th>AMOUNT</th><th>STATUS</th><th className="align-right">ACTION</th></tr></thead>
            <tbody>{visible.map(c => <tr key={c.id}>{canReview && <td><div className="person-cell"><div className="mini-avatar">{initials(employeeName(c.employeeId))}</div><span>{employeeName(c.employeeId)}</span></div></td>}
              <td><button className="claim-link" onClick={() => openDetail(c)}><span className="claim-id">{c.id.toUpperCase()}</span><span className="claim-desc">{c.description}</span></button></td>
              <td><span className={`category-pill cat-${c.category}`}>{c.category}</span></td><td className="date-cell">{new Date(c.expenseDate + "T00:00:00").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</td><td className="amount-cell">{money(c.amount)}</td><td><span className={statusClass(c.status)}><span className="status-dot"/>{titleCase(c.status)}</span></td>
              <td className="align-right"><div className="row-actions">
                {canReview && c.status === "SUBMITTED" && <><button className="action-approve" title="Approve" onClick={() => runAction(`/claims/${c.id}/approve`)}><Check size={15}/></button><button className="action-reject" title="Reject" onClick={() => { setRejectId(c.id); setRejectReason(""); }}><X size={15}/></button></>}
                {canPay && c.status === "APPROVED" && <button className="pay-btn" onClick={() => runAction(`/claims/${c.id}/pay`)}>Pay <CreditCard size={14}/></button>}
                {canSubmit && c.status === "SUBMITTED" && <button className="cancel-btn" onClick={() => runAction(`/claims/${c.id}/cancel`)}>Cancel</button>}
                <button className="more-btn" onClick={() => openDetail(c)} aria-label="View details">•••</button>
              </div></td></tr>)}
              {!visible.length && <tr><td colSpan={canReview ? 7 : 6} className="empty-state"><div className="empty-icon"><ReceiptText size={22}/></div><strong>No claims found</strong><p>Try changing your filters or submit a new claim.</p></td></tr>}
            </tbody></table></div>
          <div className="table-footer"><span>Showing <strong>{visible.length}</strong> of <strong>{claims.length}</strong> claims</span><div className="page-buttons"><button disabled={page <= 1} onClick={() => setPage(p => Math.max(1,p-1))}>Previous</button><span>{page}</span><button disabled={claims.length < 50} onClick={() => setPage(p => p+1)}>Next</button></div></div>
        </section>
        <div className="bottom-note"><ShieldCheck size={16}/> Your data is protected by role-based access controls <span>•</span> All status changes are audit logged</div>
      </div>
    </main>

    {showForm && <div className="modal-backdrop" onMouseDown={e => { if(e.target === e.currentTarget) setShowForm(false); }}><div className="modal"><div className="modal-head"><div><div className="eyebrow">EXPENSE MANAGEMENT</div><h2>Submit a new claim</h2><p>Add the details for your work expense.</p></div><button className="icon-btn" onClick={() => setShowForm(false)}><X size={18}/></button></div>
      <form onSubmit={submitClaim} className="claim-form"><label>Expense category<select value={form.category} onChange={e => setForm({...form,category:e.target.value})}><option value="travel">Travel · Limit ₹10,000/month</option><option value="meals">Meals · Limit ₹3,000/month</option><option value="internet">Internet · Limit ₹1,000/month</option></select></label>
      <div className="form-row"><label>Amount (INR)<input required type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm({...form,amount:e.target.value})}/></label><label>Expense date<input required type="date" max={new Date().toISOString().slice(0,10)} value={form.expenseDate} onChange={e => setForm({...form,expenseDate:e.target.value})}/></label></div>
      <label>Description<input required maxLength={500} placeholder="e.g. Client visit to Pune" value={form.description} onChange={e => setForm({...form,description:e.target.value})}/></label>
      <div className="form-hint"><ShieldCheck size={16}/> Claims are checked against your monthly category limit before submission.</div>
      <div className="modal-actions"><button type="button" className="subtle-btn" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="primary-btn"><Plus size={16}/> Submit claim</button></div></form></div></div>}

    {rejectId && <div className="modal-backdrop"><div className="modal compact"><div className="modal-head"><div><h2>Reject claim</h2><p>Please provide a reason. This will be recorded in the audit trail.</p></div><button className="icon-btn" onClick={() => setRejectId(null)}><X size={18}/></button></div><form onSubmit={e => { e.preventDefault(); runAction(`/claims/${rejectId}/reject`, "POST", { reason: rejectReason }); }} className="claim-form"><label>Rejection reason<textarea required rows={4} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Explain why this claim is being rejected..."/></label><div className="modal-actions"><button type="button" className="subtle-btn" onClick={() => setRejectId(null)}>Go back</button><button className="danger-btn" type="submit"><X size={15}/> Reject claim</button></div></form></div></div>}

    {detail && <div className="modal-backdrop" onMouseDown={e => { if(e.target === e.currentTarget) setDetail(null); }}><div className="modal detail-modal"><div className="modal-head"><div><div className="eyebrow">CLAIM DETAILS</div><h2>{detail.id.toUpperCase()}</h2><p>{detail.description}</p></div><button className="icon-btn" onClick={() => setDetail(null)}><X size={18}/></button></div><div className="detail-amount">{money(detail.amount)} <span className={statusClass(detail.status)}><span className="status-dot"/>{titleCase(detail.status)}</span></div><div className="detail-grid"><div><span>Employee</span><strong>{employeeName(detail.employeeId)}</strong></div><div><span>Category</span><strong>{titleCase(detail.category)}</strong></div><div><span>Expense date</span><strong>{detail.expenseDate}</strong></div><div><span>Submitted</span><strong>{new Date(detail.createdAt).toLocaleDateString("en-IN")}</strong></div></div><div className="history-title"><History size={16}/> Audit trail</div><div className="timeline">{(detail.history ?? []).length ? detail.history!.map((h,i) => <div className="timeline-item" key={i}><div className="timeline-dot"/><div><strong>{h.oldStatus ? `${titleCase(h.oldStatus)} → ${titleCase(h.newStatus)}` : titleCase(h.newStatus)}</strong><span>{employeeName(h.actorId)} · {new Date(h.timestamp).toLocaleString()}</span>{h.reason && <p>Reason: {h.reason}</p>}</div></div>) : <p className="no-history">No status changes recorded yet.</p>}</div></div></div>}
  </div>;
}
