# Role–Permission Matrix

| Function                               | Administrator | Laboratory Staff | Requester / Viewer |
|-----------------------------------------|:---:|:---:|:---:|
| View available equipment                | ✅ | ✅ | ✅ |
| Add / edit / delete equipment           | ✅ | ❌ | ❌ |
| Submit a borrowing request              | ✅ | ✅ | ✅ |
| Approve / reject a borrowing request    | ✅ | ❌ | ❌ |
| Approve their **own** request           | ❌ (BR‑A4‑02) | ❌ | ❌ |
| Release approved equipment              | ✅ | ✅ | ❌ |
| Process a return                        | ✅ | ✅ | ❌ |
| Submit a maintenance request            | ✅ | ✅ | ❌ |
| Resolve a maintenance request           | ✅ | ❌ | ❌ |
| View own request status/history         | ✅ | ✅ | ✅ |
| View **all** requests                   | ✅ | ✅ | ❌ (own only) |
| Manage users / roles                    | ✅ | ❌ | ❌ |
| View audit logs                         | ✅ | ❌ | ❌ |

Enforcement is layered:
- **Interface level** — `js/app.js` shows/hides navigation items and buttons per `currentProfile.role` (`NAV_VISIBILITY` map).
- **Database level** — PostgreSQL Row Level Security policies on every table, plus `security definer` RPC functions (`sql/schema.sql`, section 6) that re-check the role and re-validate every business rule before writing, so a user cannot bypass the UI (e.g. via the browser console) to perform an action their role doesn't allow.
