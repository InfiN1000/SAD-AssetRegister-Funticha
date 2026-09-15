<<<<<<< HEAD
# Lab Asset Register — Role-Based Asset Transaction and Approval Management

Systems Analysis and Design — Lab 4-A. A static frontend (deployable to GitHub Pages)
backed by Supabase (Postgres + Auth). Role-based access and every business rule
(BR-A4-01 … BR-A4-10) are enforced **both** in the interface and at the database
level via Row Level Security and `security definer` RPC functions.

## Project structure

```
lab-asset-system/
├── index.html                  # App shell (auth screen + role-based views)
├── css/style.css                # Styling
├── js/
│   ├── config.js                 # Supabase URL + anon key (fill in)
│   ├── supabaseClient.js         # Supabase client init
│   └── app.js                    # Auth, navigation, and all view logic
├── sql/schema.sql               # Tables, RLS policies, RPC functions, seed data
└── docs/
    ├── erd.md                     # Entity-Relationship Diagram (Mermaid)
    ├── use-case-diagram.md        # Use Case Diagram (Mermaid)
    ├── workflow-diagram.md        # Borrowing approval state diagram (Mermaid)
    ├── role-permission-matrix.md
    ├── business-rules.md
    └── functional-test-results.md
```

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → paste the entire contents of `sql/schema.sql` → run it.
   This creates all tables, enums, RLS policies, RPC functions, a trigger that
   auto-creates a `profiles` row on signup, and five sample equipment rows.
3. Go to **Project Settings → API** and copy your **Project URL** and **anon public key**.
4. Paste them into `js/config.js`:
   ```js
   export const SUPABASE_URL = "https://xxxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```
5. (Optional) In **Authentication → Providers → Email**, turn off "Confirm email"
   while testing so new accounts can log in immediately.

## 2. Create your first Administrator

Every new sign-up starts as a `requester` (see `handle_new_user()` in the schema).
Sign up once through the app, then in the Supabase SQL Editor run:

```sql
update profiles set role = 'administrator' where id =
  (select id from auth.users where email = 'you@example.com');
```

From then on, use the app's **Users** page to promote/demote everyone else.

## 3. Run locally

This is a plain static site — no build step. Any static server works, e.g.:

```bash
cd lab-asset-system
python3 -m http.server 8080
# open http://localhost:8080
```

## 4. Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Repo **Settings → Pages** → Source: deploy from branch → branch `main`, folder `/ (root)`.
3. Your live URL will be `https://<username>.github.io/<repo>/`.

## Roles

| Role | What they can do |
|---|---|
| **Administrator** | Manage users & equipment, approve/reject requests, resolve maintenance, view audit logs |
| **Laboratory Staff** | View equipment, submit/release/return borrowing transactions, submit maintenance requests |
| **Requester / Viewer** | View equipment, submit borrowing requests, view own request history |

See `docs/role-permission-matrix.md` for the full matrix and `docs/business-rules.md`
for exactly where each BR-A4-xx rule is enforced in code.

## Submission checklist mapping

| Requirement | Where |
|---|---|
| GitHub repository URL | (fill in after pushing) |
| Live GitHub Pages URL | (fill in after deploying) |
| Updated ERD and Use Case Diagram | `docs/erd.md`, `docs/use-case-diagram.md` |
| Role-permission matrix | `docs/role-permission-matrix.md` |
| Workflow diagram | `docs/workflow-diagram.md` |
| Business rules | `docs/business-rules.md` |
| Audit-log screenshot | Take one from the **Audit Log** tab after running a few actions |
| Functional test results | `docs/functional-test-results.md` |
=======
# SAD-AssetRegister-Funticha
System for role-based lab asset borrowing, approval workflow, and audit logging (GitHub Pages + Supabase).
>>>>>>> c69623849d2e89fb9670089b883390047777d22a
