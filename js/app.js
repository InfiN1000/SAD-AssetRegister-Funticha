import { supabase } from "./supabaseClient.js";

// ============================================================================
// STATE
// ============================================================================
let currentUser = null;   // auth.users row
let currentProfile = null; // { id, full_name, role }
let equipmentCache = [];

const ROLE_ADMIN = "administrator";
const ROLE_STAFF = "staff";
const ROLE_REQUESTER = "requester";

// ============================================================================
// SMALL HELPERS
// ============================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(message, isError = false) {
  const area = $("#toast-area");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function statusTag(status) {
  return `<span class="status-tag status-${status}">${status.replace("_", " ")}</span>`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

function roleLabel(role) {
  return { administrator: "Administrator", staff: "Laboratory Staff", requester: "Requester / Viewer" }[role] || role;
}

/** Generic modal builder. fields: [{name,label,type:'text'|'textarea'|'checkbox'|'select', options?}] */
function openModal({ title, fields, submitLabel = "Submit", onSubmit }) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const fieldsHtml = fields.map(f => {
    if (f.type === "checkbox") {
      return `<div class="field"><label><input type="checkbox" name="${f.name}" /> ${f.label}</label></div>`;
    }
    if (f.type === "select") {
      const opts = f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
      return `<div class="field"><label>${f.label}</label><select name="${f.name}">${opts}</select></div>`;
    }
    if (f.type === "textarea") {
      return `<div class="field"><label>${f.label}</label><textarea name="${f.name}" rows="3" ${f.required ? "required" : ""}></textarea></div>`;
    }
    return `<div class="field"><label>${f.label}</label><input type="text" name="${f.name}" ${f.required ? "required" : ""} /></div>`;
  }).join("");

  backdrop.innerHTML = `
    <div class="modal">
      <h2>${title}</h2>
      <form id="modal-form">
        ${fieldsHtml}
        <p class="form-error" id="modal-error"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">${submitLabel}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);

  $("#modal-cancel", backdrop).addEventListener("click", () => backdrop.remove());
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.remove(); });

  $("#modal-form", backdrop).addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {};
    fields.forEach(f => {
      const el = backdrop.querySelector(`[name="${f.name}"]`);
      data[f.name] = f.type === "checkbox" ? el.checked : el.value;
    });
    try {
      await onSubmit(data);
      backdrop.remove();
    } catch (err) {
      $("#modal-error", backdrop).textContent = err.message || "Something went wrong.";
    }
  });
}

function confirmAction(message) {
  return window.confirm(message);
}

// ============================================================================
// AUTH
// ============================================================================
$("#switch-to-signup").addEventListener("click", () => {
  $("#login-form").classList.add("hidden");
  $("#signup-form").classList.remove("hidden");
  $("#switch-to-signup-wrap").classList.add("hidden");
  $("#switch-to-login-wrap").classList.remove("hidden");
});
$("#switch-to-login").addEventListener("click", () => {
  $("#signup-form").classList.add("hidden");
  $("#login-form").classList.remove("hidden");
  $("#switch-to-login-wrap").classList.add("hidden");
  $("#switch-to-signup-wrap").classList.remove("hidden");
});

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) $("#login-error").textContent = error.message;
});

$("#signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#signup-error").textContent = "";
  const full_name = $("#signup-name").value.trim();
  const email = $("#signup-email").value.trim();
  const password = $("#signup-password").value;
  const { error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name } }
  });
  if (error) { $("#signup-error").textContent = error.message; return; }
  toast("Account created. If email confirmation is enabled, check your inbox, then log in.");
  $("#switch-to-login").click();
});

$("#logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (session?.user) {
    currentUser = session.user;
    await loadProfile();
    showApp();
  } else {
    currentUser = null;
    currentProfile = null;
    showAuth();
  }
});

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", currentUser.id)
    .single();
  if (error) {
    toast("Could not load your profile: " + error.message, true);
    return;
  }
  currentProfile = data;
}

function showAuth() {
  $("#auth-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
}

function showApp() {
  $("#auth-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  applyRoleVisibility();
  $("#chip-name").textContent = currentProfile?.full_name || currentUser.email;
  $("#chip-role").textContent = roleLabel(currentProfile?.role);
  navigateTo(currentProfile?.role === ROLE_REQUESTER ? "equipment" : "equipment");
}

// ============================================================================
// ROLE-BASED NAVIGATION (interface requirement)
// ============================================================================
const NAV_VISIBILITY = {
  equipment: [ROLE_ADMIN, ROLE_STAFF, ROLE_REQUESTER],
  "my-requests": [ROLE_REQUESTER],
  approvals: [ROLE_ADMIN],
  operations: [ROLE_STAFF, ROLE_ADMIN],
  maintenance: [ROLE_STAFF, ROLE_ADMIN],
  users: [ROLE_ADMIN],
  audit: [ROLE_ADMIN],
};

function applyRoleVisibility() {
  const role = currentProfile?.role;
  $all(".nav-item[data-view]").forEach(btn => {
    const view = btn.dataset.view;
    const allowed = NAV_VISIBILITY[view]?.includes(role);
    btn.classList.toggle("hidden", !allowed);
  });
  $("#add-equipment-btn").classList.toggle("hidden", role !== ROLE_ADMIN);
  $("#open-maintenance-btn").classList.toggle("hidden", !(role === ROLE_STAFF || role === ROLE_ADMIN));
}

$all(".nav-item[data-view]").forEach(btn => {
  btn.addEventListener("click", () => navigateTo(btn.dataset.view));
});

function navigateTo(view) {
  const allowed = NAV_VISIBILITY[view]?.includes(currentProfile?.role);
  $all(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $all("[data-role-view]").forEach(sec => sec.classList.add("hidden"));

  if (!allowed) {
    renderAccessDenied(view);
    return;
  }

  const sectionMap = {
    equipment: renderEquipment,
    "my-requests": renderMyRequests,
    approvals: renderApprovals,
    operations: renderOperations,
    maintenance: renderMaintenance,
    users: renderUsers,
    audit: renderAudit,
  };
  $(`#view-${view}`).classList.remove("hidden");
  sectionMap[view]?.();
}

function renderAccessDenied(view) {
  const target = $(`#view-${view}`) || $("#view-equipment");
  target.classList.remove("hidden");
  target.innerHTML = `
    <div class="access-denied">
      <p class="code-big">ACCESS DENIED</p>
      <p>Your role (${roleLabel(currentProfile?.role)}) does not have permission to view this page.</p>
    </div>`;
}

// ============================================================================
// EQUIPMENT VIEW  (all roles)
// ============================================================================
async function renderEquipment() {
  const wrap = $("#equipment-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase.from("equipment").select("*").order("code");
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  equipmentCache = data;

  if (!data.length) { wrap.innerHTML = `<div class="empty-state">No equipment on record yet.</div>`; return; }

  const canRequest = currentProfile.role === ROLE_REQUESTER || currentProfile.role === ROLE_STAFF || currentProfile.role === ROLE_ADMIN;
  const isAdmin = currentProfile.role === ROLE_ADMIN;

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${data.map(eq => `
          <tr>
            <td class="code">${eq.code}</td>
            <td>${eq.name}</td>
            <td>${eq.category || "—"}</td>
            <td>${statusTag(eq.status)}</td>
            <td class="row-actions">
              ${canRequest && eq.status === "available" ? `<button class="btn btn-primary btn-sm" data-request="${eq.id}">Request</button>` : ""}
              ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-delete-eq="${eq.id}">Delete</button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  $all("[data-request]", wrap).forEach(btn => {
    btn.addEventListener("click", () => {
      const eq = equipmentCache.find(e => e.id === Number(btn.dataset.request));
      openModal({
        title: `Request ${eq.name}`,
        fields: [{ name: "purpose", label: "Purpose / reason for borrowing", type: "textarea", required: true }],
        submitLabel: "Submit request",
        onSubmit: async (data) => {
          const { error } = await supabase.rpc("submit_borrowing_request", {
            p_equipment_id: eq.id, p_purpose: data.purpose
          });
          if (error) throw error;
          toast(`Request submitted for ${eq.name}. Status: Pending.`);
          renderEquipment();
        }
      });
    });
  });

  $all("[data-delete-eq]", wrap).forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirmAction("Remove this equipment record?")) return;
      const { error } = await supabase.from("equipment").delete().eq("id", btn.dataset.deleteEq);
      if (error) { toast(error.message, true); return; }
      toast("Equipment removed.");
      renderEquipment();
    });
  });
}

$("#add-equipment-btn").addEventListener("click", () => {
  openModal({
    title: "Add equipment",
    fields: [
      { name: "code", label: "Asset code (e.g. LAP-006)", required: true },
      { name: "name", label: "Name", required: true },
      { name: "category", label: "Category" },
    ],
    submitLabel: "Add",
    onSubmit: async (data) => {
      const { error } = await supabase.from("equipment").insert({
        code: data.code, name: data.name, category: data.category || null
      });
      if (error) throw error;
      toast("Equipment added.");
      renderEquipment();
    }
  });
});

// ============================================================================
// MY REQUESTS VIEW  (requester)
// ============================================================================
async function renderMyRequests() {
  const wrap = $("#my-requests-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase
    .from("borrowing_requests")
    .select("*, equipment(code, name)")
    .eq("requester_id", currentUser.id)
    .order("requested_at", { ascending: false });
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">You haven't submitted any requests yet. Go to Equipment to request an item.</div>`; return; }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Equipment</th><th>Purpose</th><th>Status</th><th>Requested</th><th>Due</th></tr></thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td class="code">${r.equipment?.code || "—"} <span style="color:var(--text-dim); font-family:var(--font-body);">${r.equipment?.name || ""}</span></td>
            <td>${r.purpose || "—"}</td>
            <td>${statusTag(r.status)}</td>
            <td>${fmtDate(r.requested_at)}</td>
            <td>${fmtDate(r.due_at)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ============================================================================
// APPROVALS VIEW  (administrator)
// ============================================================================
async function renderApprovals() {
  const wrap = $("#approvals-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase
    .from("borrowing_requests")
    .select("*, equipment(code, name), profiles!borrowing_requests_requester_id_fkey(full_name)")
    .eq("status", "pending")
    .order("requested_at");
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">No pending requests.</div>`; return; }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Requester</th><th>Equipment</th><th>Purpose</th><th>Requested</th><th></th></tr></thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td>${r.profiles?.full_name || "—"}</td>
            <td class="code">${r.equipment?.code}</td>
            <td>${r.purpose || "—"}</td>
            <td>${fmtDate(r.requested_at)}</td>
            <td class="row-actions">
              <button class="btn btn-primary btn-sm" data-approve="${r.id}">Approve</button>
              <button class="btn btn-danger btn-sm" data-reject="${r.id}">Reject</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  $all("[data-approve]", wrap).forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.rpc("approve_request", { p_request_id: Number(btn.dataset.approve) });
      if (error) { toast(error.message, true); return; }
      toast("Request approved.");
      renderApprovals();
    });
  });

  $all("[data-reject]", wrap).forEach(btn => {
    btn.addEventListener("click", () => {
      openModal({
        title: "Reject request",
        fields: [{ name: "reason", label: "Reason (optional)", type: "textarea" }],
        submitLabel: "Reject",
        onSubmit: async (data) => {
          const { error } = await supabase.rpc("reject_request", {
            p_request_id: Number(btn.dataset.reject), p_notes: data.reason || null
          });
          if (error) throw error;
          toast("Request rejected.");
          renderApprovals();
        }
      });
    });
  });
}

// ============================================================================
// OPERATIONS VIEW — release approved items, process returns (staff/admin)
// ============================================================================
async function renderOperations() {
  const wrap = $("#operations-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase
    .from("borrowing_requests")
    .select("*, equipment(code, name), profiles!borrowing_requests_requester_id_fkey(full_name)")
    .in("status", ["approved", "released", "overdue"])
    .order("requested_at");
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">Nothing awaiting release or return.</div>`; return; }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Requester</th><th>Equipment</th><th>Status</th><th>Due</th><th></th></tr></thead>
      <tbody>
        ${data.map(r => `
          <tr>
            <td>${r.profiles?.full_name || "—"}</td>
            <td class="code">${r.equipment?.code}</td>
            <td>${statusTag(r.status)}</td>
            <td>${fmtDate(r.due_at)}</td>
            <td class="row-actions">
              ${r.status === "approved" ? `<button class="btn btn-primary btn-sm" data-release="${r.id}">Release</button>` : ""}
              ${(r.status === "released" || r.status === "overdue") ? `<button class="btn btn-ghost btn-sm" data-return="${r.id}">Process return</button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  $all("[data-release]", wrap).forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.rpc("release_equipment", { p_request_id: Number(btn.dataset.release) });
      if (error) { toast(error.message, true); return; }
      toast("Equipment released. Status: Borrowed.");
      renderOperations();
    });
  });

  $all("[data-return]", wrap).forEach(btn => {
    btn.addEventListener("click", () => {
      openModal({
        title: "Process return",
        fields: [
          { name: "damaged", label: "Equipment returned damaged", type: "checkbox" },
          { name: "notes", label: "Notes (optional)", type: "textarea" },
        ],
        submitLabel: "Confirm return",
        onSubmit: async (data) => {
          const { error } = await supabase.rpc("return_equipment", {
            p_request_id: Number(btn.dataset.return), p_damaged: !!data.damaged, p_notes: data.notes || null
          });
          if (error) throw error;
          toast("Return processed.");
          renderOperations();
        }
      });
    });
  });
}

// ============================================================================
// MAINTENANCE VIEW  (staff report, admin resolve)
// ============================================================================
async function renderMaintenance() {
  const wrap = $("#maintenance-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("*, equipment(code, name), profiles!maintenance_requests_requested_by_fkey(full_name)")
    .order("created_at", { ascending: false });
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">No maintenance issues reported.</div>`; return; }

  const isAdmin = currentProfile.role === ROLE_ADMIN;

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Equipment</th><th>Issue</th><th>Reported by</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${data.map(m => `
          <tr>
            <td class="code">${m.equipment?.code}</td>
            <td>${m.issue_description}</td>
            <td>${m.profiles?.full_name || "—"}</td>
            <td>${statusTag(m.status)}</td>
            <td class="row-actions">
              ${isAdmin && m.status !== "resolved" ? `<button class="btn btn-primary btn-sm" data-resolve="${m.id}">Mark resolved</button>` : ""}
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  $all("[data-resolve]", wrap).forEach(btn => {
    btn.addEventListener("click", async () => {
      const { error } = await supabase.rpc("resolve_maintenance_request", { p_id: Number(btn.dataset.resolve) });
      if (error) { toast(error.message, true); return; }
      toast("Maintenance resolved. Equipment is available again.");
      renderMaintenance();
    });
  });
}

$("#open-maintenance-btn").addEventListener("click", async () => {
  if (!equipmentCache.length) {
    const { data } = await supabase.from("equipment").select("*").order("code");
    equipmentCache = data || [];
  }
  openModal({
    title: "Report equipment issue",
    fields: [
      { name: "equipment_id", label: "Equipment", type: "select", options: equipmentCache.map(e => ({ value: e.id, label: `${e.code} — ${e.name}` })) },
      { name: "issue", label: "Describe the issue", type: "textarea", required: true },
    ],
    submitLabel: "Report",
    onSubmit: async (data) => {
      const { error } = await supabase.rpc("submit_maintenance_request", {
        p_equipment_id: Number(data.equipment_id), p_issue: data.issue
      });
      if (error) throw error;
      toast("Issue reported. Equipment marked under maintenance.");
      renderMaintenance();
    }
  });
});

// ============================================================================
// USERS VIEW  (administrator)
// ============================================================================
async function renderUsers() {
  const wrap = $("#users-table-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase.from("profiles").select("*").order("full_name");
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Role</th><th></th></tr></thead>
      <tbody>
        ${data.map(u => `
          <tr>
            <td>${u.full_name}${u.id === currentUser.id ? " (you)" : ""}</td>
            <td>${roleLabel(u.role)}</td>
            <td class="row-actions">
              <select data-role-select="${u.id}" ${u.id === currentUser.id ? "disabled" : ""}>
                <option value="administrator" ${u.role === "administrator" ? "selected" : ""}>Administrator</option>
                <option value="staff" ${u.role === "staff" ? "selected" : ""}>Laboratory Staff</option>
                <option value="requester" ${u.role === "requester" ? "selected" : ""}>Requester / Viewer</option>
              </select>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  $all("[data-role-select]", wrap).forEach(sel => {
    sel.addEventListener("change", async () => {
      const { error } = await supabase.rpc("set_user_role", {
        p_user_id: sel.dataset.roleSelect, p_role: sel.value
      });
      if (error) { toast(error.message, true); renderUsers(); return; }
      toast("Role updated.");
    });
  });
}

// ============================================================================
// AUDIT LOG VIEW  (administrator)
// ============================================================================
async function renderAudit() {
  const wrap = $("#audit-list-wrap");
  wrap.innerHTML = "Loading…";
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*, profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { wrap.innerHTML = `<div class="empty-state">${error.message}</div>`; return; }
  if (!data.length) { wrap.innerHTML = `<div class="empty-state">No audit entries yet.</div>`; return; }

  wrap.innerHTML = data.map(a => `
    <div class="audit-entry">
      <time>${fmtDate(a.created_at)}</time>
      <span class="action">${a.action}</span>
      <span>${a.module}</span>
      <span>${a.profiles?.full_name || "System"} — ${a.description || ""}</span>
    </div>`).join("");
}
