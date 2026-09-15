# Business Rules — Implementation Reference

| ID | Rule | Where it's enforced |
|----|------|----------------------|
| BR-A4-01 | Only available equipment may be requested. | `submit_borrowing_request()` checks `equipment.status = 'available'` before inserting; UI also hides the "Request" button for non-available items. |
| BR-A4-02 | Staff/Admin cannot approve their own request. | `approve_request()` raises an exception if `requester_id = auth.uid()`. |
| BR-A4-03 | Only Administrator may approve or reject requests. | `approve_request()` / `reject_request()` call `is_admin()` and raise if false; also no direct table UPDATE policy exists, so only these functions can change status. |
| BR-A4-04 | Only Approved requests may be released. | `release_equipment()` checks `status = 'approved'` before proceeding. |
| BR-A4-05 | Released equipment becomes Borrowed. | `release_equipment()` sets `equipment.status = 'borrowed'` in the same transaction as the status change. |
| BR-A4-06 | Returned equipment becomes Available unless damaged. | `return_equipment()` sets `equipment.status` to `'available'` or `'damaged'` based on the `p_damaged` flag. |
| BR-A4-07 | Rejected requests cannot be released. | Guaranteed structurally: `release_equipment()` only accepts `status = 'approved'`, and a rejected request can never reach `approved`. |
| BR-A4-08 | Returned transactions cannot be processed twice. | `return_equipment()` only accepts `status in ('released','overdue')`; once returned, the status is `'returned'` and a second call fails. |
| BR-A4-09 | Equipment under Maintenance cannot be borrowed. | Same check as BR-A4-01 (`status = 'available'` gate) — maintenance equipment is never `'available'`; `submit_maintenance_request()` also flips equipment to `'maintenance'` immediately. |
| BR-A4-10 | Sensitive operations must be logged. | Every workflow RPC (`submit_borrowing_request`, `approve_request`, `reject_request`, `release_equipment`, `return_equipment`, `close_request`, `mark_overdue`, maintenance functions, `set_user_role`) calls `log_action()`, which writes to `audit_logs`. Direct inserts into `audit_logs` are blocked by RLS — only `log_action()` (security definer) can write. |

All of the above are implemented as **PostgreSQL functions with `security definer`**, not just frontend `if` statements — so the rules hold even if someone calls the Supabase API directly, bypassing the web UI entirely.
