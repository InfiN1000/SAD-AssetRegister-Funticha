# Functional Test Results

Run these manually after deploying (see README) and check off / annotate each row.

| Test ID | Scenario | Expected Result | How to trigger it in this app | Result |
|---|---|---|---|---|
| TC-A4-01 | Viewer attempts to open Admin page | Access denied | Log in as a Requester, click "Users" or "Approvals" nav (hidden) — or navigate directly; `renderAccessDenied()` shows "ACCESS DENIED" | ☐ |
| TC-A4-02 | Staff submits request | Request saved as Pending | Log in as Staff, Equipment → Request an available item | ☐ |
| TC-A4-03 | Administrator approves request | Status becomes Approved; audit log created | Approvals tab → Approve; then check Audit Log for an `APPROVED` entry | ☐ |
| TC-A4-04 | Administrator rejects request | Status becomes Rejected | Approvals tab → Reject | ☐ |
| TC-A4-05 | Attempt to release rejected request | Operation blocked | Try calling `release_equipment()` on a rejected request's id (e.g. via SQL editor or browser console) — the function raises "Only approved requests can be released" | ☐ |
| TC-A4-06 | Release approved equipment | Equipment becomes Borrowed | Release & Returns tab → Release; check Equipment tab shows `borrowed` | ☐ |
| TC-A4-07 | Return released equipment | Equipment returns to appropriate status | Release & Returns tab → Process return (toggle "damaged" to test both `available` and `damaged` outcomes) | ☐ |
| TC-A4-08 | Check audit log after approval | Approval entry is visible | Audit Log tab, filter by eye for `APPROVED` action | ☐ |
| TC-A4-09 | Staff attempts restricted delete | Operation blocked | Log in as Staff; the "Delete" button on Equipment only renders for Administrators, and the RLS policy `equipment_admin_delete` also rejects a direct API call | ☐ |
| TC-A4-10 | Logout and open protected page | Redirected to login / access denied | Log out, refresh — `onAuthStateChange` shows the auth view; no session means no data can be fetched (RLS requires `auth.uid()`) | ☐ |

## Additional business-rule checks

| Rule | How to verify |
|---|---|
| BR-A4-02 (no self-approval) | Log in as an Administrator who also submitted a request; try to approve your own request in Approvals — the RPC raises "You cannot approve your own request." |
| BR-A4-08 (no double return) | Return a request once, then try the `return_equipment` RPC again on the same id — raises "Only released (or overdue) requests can be returned." |
| BR-A4-09 (no borrowing under maintenance) | Report a maintenance issue on an available item; confirm it disappears from "Request" options on Equipment until resolved. |
