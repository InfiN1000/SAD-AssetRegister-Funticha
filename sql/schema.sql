-- ============================================================================
-- SYSTEMS ANALYSIS AND DESIGN — LAB 4-A
-- Role-Based Asset Transaction and Approval Management
-- Supabase (PostgreSQL) schema: tables, RLS policies, and RPC functions
-- that enforce every BR-A4-xx business rule at the DATABASE level, not just
-- in the frontend.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ENUM TYPES
-- ----------------------------------------------------------------------------
create type user_role as enum ('administrator', 'staff', 'requester');

create type equipment_status as enum ('available', 'borrowed', 'maintenance', 'damaged');

create type request_status as enum (
  'pending', 'approved', 'rejected', 'released', 'returned', 'overdue', 'closed'
);

create type maintenance_status as enum ('open', 'in_progress', 'resolved');

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------

-- 2.1 profiles — one row per auth.users row, carries the role used everywhere
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  role        user_role not null default 'requester',
  created_at  timestamptz not null default now()
);

-- 2.2 equipment
create table equipment (
  id          bigint generated always as identity primary key,
  code        text unique not null,
  name        text not null,
  category    text,
  status      equipment_status not null default 'available',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.3 borrowing_requests — the approval workflow record
create table borrowing_requests (
  id               bigint generated always as identity primary key,
  requester_id     uuid not null references profiles (id),
  equipment_id     bigint not null references equipment (id),
  status           request_status not null default 'pending',
  purpose          text,
  requested_at     timestamptz not null default now(),
  reviewed_by      uuid references profiles (id),
  reviewed_at      timestamptz,
  review_notes     text,
  released_by      uuid references profiles (id),
  released_at      timestamptz,
  due_at           timestamptz,
  returned_by      uuid references profiles (id),
  returned_at      timestamptz,
  return_condition text,                          -- 'good' | 'damaged'
  closed_at        timestamptz,
  updated_at       timestamptz not null default now()
);

-- 2.4 maintenance_requests
create table maintenance_requests (
  id                 bigint generated always as identity primary key,
  equipment_id       bigint not null references equipment (id),
  requested_by       uuid not null references profiles (id),
  issue_description  text not null,
  status             maintenance_status not null default 'open',
  created_at         timestamptz not null default now(),
  resolved_by        uuid references profiles (id),
  resolved_at        timestamptz
);

-- 2.5 audit_logs — BR-A4-10: every sensitive operation is written here
create table audit_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid references profiles (id),
  action       text not null,
  module       text not null,
  record_id    text,
  description  text,
  created_at   timestamptz not null default now()
);

create index idx_borrowing_requester on borrowing_requests (requester_id);
create index idx_borrowing_equipment on borrowing_requests (equipment_id);
create index idx_borrowing_status on borrowing_requests (status);
create index idx_audit_created on audit_logs (created_at desc);

-- ----------------------------------------------------------------------------
-- 3. HELPER FUNCTIONS (role lookups used inside RLS + RPCs)
-- ----------------------------------------------------------------------------
create or replace function current_role_name()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from profiles where id = auth.uid()) = 'administrator', false);
$$;

create or replace function is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from profiles where id = auth.uid()) in ('administrator', 'staff'),
    false
  );
$$;

-- Central audit writer. security definer so normal users can never insert
-- fake/log-skipping rows directly — only these trusted functions can.
create or replace function log_action(
  p_action      text,
  p_module      text,
  p_record_id   text,
  p_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_logs (user_id, action, module, record_id, description)
  values (auth.uid(), p_action, p_module, p_record_id, p_description);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. NEW-USER TRIGGER — auto-create a profile row (default role: requester)
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'requester'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table profiles enable row level security;
alter table equipment enable row level security;
alter table borrowing_requests enable row level security;
alter table maintenance_requests enable row level security;
alter table audit_logs enable row level security;

-- 5.1 profiles
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (id = auth.uid() or is_admin());

create policy "profiles_update_own_name_or_admin_any"
  on profiles for update
  using (id = auth.uid() or is_admin())
  with check (
    id = auth.uid() and role = (select role from profiles where id = auth.uid())  -- users can't self-promote
    or is_admin()
  );

-- 5.2 equipment — everyone logged in can view; only admin manages directly
create policy "equipment_select_all_authenticated"
  on equipment for select
  using (auth.uid() is not null);

create policy "equipment_admin_insert"
  on equipment for insert
  with check (is_admin());

create policy "equipment_admin_update"
  on equipment for update
  using (is_admin());

create policy "equipment_admin_delete"
  on equipment for delete
  using (is_admin());

-- 5.3 borrowing_requests — direct row mutation is blocked; all state
-- transitions must go through the RPC functions in section 6, which run
-- security definer and enforce BR-A4-xx. Only SELECT/INSERT policies exist.
create policy "requests_select_own_or_staff_admin"
  on borrowing_requests for select
  using (requester_id = auth.uid() or is_staff_or_admin());

create policy "requests_insert_self_or_staff"
  on borrowing_requests for insert
  with check (requester_id = auth.uid() or is_staff_or_admin());

-- Note: intentionally no UPDATE/DELETE policy is defined for this table.
-- With RLS enabled and no matching policy, direct updates/deletes are
-- rejected for all non-superuser roles — status changes are only possible
-- via the security-definer functions below (approve/reject/release/return).

-- 5.4 maintenance_requests
create policy "maintenance_select_staff_admin"
  on maintenance_requests for select
  using (is_staff_or_admin());

create policy "maintenance_insert_staff_admin"
  on maintenance_requests for insert
  with check (is_staff_or_admin() and requested_by = auth.uid());

-- 5.5 audit_logs — administrators only, and only via SELECT (writes are via log_action())
create policy "audit_select_admin_only"
  on audit_logs for select
  using (is_admin());

-- ----------------------------------------------------------------------------
-- 6. WORKFLOW RPC FUNCTIONS — every BR-A4-xx rule lives here, enforced
--    server-side regardless of what the frontend sends.
-- ----------------------------------------------------------------------------

-- 6.1 Submit a borrowing request  (BR-A4-01, BR-A4-09)
create or replace function submit_borrowing_request(
  p_equipment_id bigint,
  p_purpose text
)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status equipment_status;
  v_req borrowing_requests;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select status into v_status from equipment where id = p_equipment_id;
  if v_status is null then
    raise exception 'Equipment not found';
  end if;

  -- BR-A4-01 / BR-A4-09: only AVAILABLE equipment may be requested
  if v_status <> 'available' then
    raise exception 'Equipment is not available for borrowing (current status: %)', v_status;
  end if;

  insert into borrowing_requests (requester_id, equipment_id, purpose, status)
  values (auth.uid(), p_equipment_id, p_purpose, 'pending')
  returning * into v_req;

  perform log_action('SUBMITTED', 'Borrowing', v_req.id::text,
    format('Borrowing request submitted for equipment #%s', p_equipment_id));

  return v_req;
end;
$$;

-- 6.2 Approve a request  (BR-A4-02, BR-A4-03, BR-A4-10)
create or replace function approve_request(
  p_request_id bigint,
  p_notes text default null
)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  -- BR-A4-03: only Administrator may approve
  if not is_admin() then
    raise exception 'Only an Administrator may approve requests';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  -- BR-A4-02: staff/admin cannot approve their own request
  if v_req.requester_id = auth.uid() then
    raise exception 'You cannot approve your own request';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be approved (current status: %)', v_req.status;
  end if;

  update borrowing_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_request_id
  returning * into v_req;

  perform log_action('APPROVED', 'Borrowing', p_request_id::text,
    format('Approved borrowing request #%s', p_request_id));

  return v_req;
end;
$$;

-- 6.3 Reject a request  (BR-A4-03, BR-A4-10)
create or replace function reject_request(
  p_request_id bigint,
  p_notes text default null
)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  if not is_admin() then
    raise exception 'Only an Administrator may reject requests';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be rejected (current status: %)', v_req.status;
  end if;

  update borrowing_requests
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      review_notes = p_notes, updated_at = now()
  where id = p_request_id
  returning * into v_req;

  perform log_action('REJECTED', 'Borrowing', p_request_id::text,
    format('Rejected borrowing request #%s', p_request_id));

  return v_req;
end;
$$;

-- 6.4 Release equipment to the borrower  (BR-A4-04, BR-A4-05, BR-A4-07, BR-A4-10)
create or replace function release_equipment(
  p_request_id bigint,
  p_due_at timestamptz default (now() + interval '7 days')
)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  if not is_staff_or_admin() then
    raise exception 'Only Staff or an Administrator may release equipment';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  -- BR-A4-04 / BR-A4-07: only an APPROVED request may be released
  -- (this also makes releasing a rejected request impossible)
  if v_req.status <> 'approved' then
    raise exception 'Only approved requests can be released (current status: %)', v_req.status;
  end if;

  update borrowing_requests
  set status = 'released', released_by = auth.uid(), released_at = now(),
      due_at = p_due_at, updated_at = now()
  where id = p_request_id
  returning * into v_req;

  -- BR-A4-05: released equipment becomes Borrowed
  update equipment set status = 'borrowed', updated_at = now()
  where id = v_req.equipment_id;

  perform log_action('RELEASED', 'Borrowing', p_request_id::text,
    format('Released equipment #%s for request #%s', v_req.equipment_id, p_request_id));

  return v_req;
end;
$$;

-- 6.5 Return equipment  (BR-A4-06, BR-A4-08, BR-A4-10)
create or replace function return_equipment(
  p_request_id bigint,
  p_damaged boolean default false,
  p_notes text default null
)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  if not is_staff_or_admin() then
    raise exception 'Only Staff or an Administrator may process a return';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  -- BR-A4-08: a request already returned/closed cannot be processed twice
  if v_req.status not in ('released', 'overdue') then
    raise exception 'Only released (or overdue) requests can be returned (current status: %)', v_req.status;
  end if;

  update borrowing_requests
  set status = 'returned', returned_by = auth.uid(), returned_at = now(),
      return_condition = case when p_damaged then 'damaged' else 'good' end,
      review_notes = coalesce(p_notes, review_notes), updated_at = now()
  where id = p_request_id
  returning * into v_req;

  -- BR-A4-06: returned equipment becomes Available unless damaged
  update equipment
  set status = case when p_damaged then 'damaged' else 'available' end, updated_at = now()
  where id = v_req.equipment_id;

  perform log_action('RETURNED', 'Borrowing', p_request_id::text,
    format('Returned equipment #%s for request #%s (%s)', v_req.equipment_id, p_request_id,
      case when p_damaged then 'damaged' else 'good condition' end));

  return v_req;
end;
$$;

-- 6.6 Close a returned request (final workflow state)
create or replace function close_request(p_request_id bigint)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  if not is_admin() then
    raise exception 'Only an Administrator may close a request';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  if v_req.status <> 'returned' then
    raise exception 'Only returned requests can be closed (current status: %)', v_req.status;
  end if;

  update borrowing_requests
  set status = 'closed', closed_at = now(), updated_at = now()
  where id = p_request_id
  returning * into v_req;

  perform log_action('CLOSED', 'Borrowing', p_request_id::text,
    format('Closed request #%s', p_request_id));

  return v_req;
end;
$$;

-- 6.7 Mark an overdue release (released past due_at and not yet returned)
create or replace function mark_overdue(p_request_id bigint)
returns borrowing_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req borrowing_requests;
begin
  if not is_staff_or_admin() then
    raise exception 'Only Staff or an Administrator may flag overdue items';
  end if;

  select * into v_req from borrowing_requests where id = p_request_id for update;
  if v_req is null then
    raise exception 'Request not found';
  end if;

  if v_req.status <> 'released' then
    raise exception 'Only released requests can be marked overdue (current status: %)', v_req.status;
  end if;

  if v_req.due_at is null or v_req.due_at > now() then
    raise exception 'Request is not past its due date';
  end if;

  update borrowing_requests
  set status = 'overdue', updated_at = now()
  where id = p_request_id
  returning * into v_req;

  perform log_action('OVERDUE', 'Borrowing', p_request_id::text,
    format('Request #%s flagged overdue', p_request_id));

  return v_req;
end;
$$;

-- 6.8 Submit a maintenance request  (Staff/Admin only; BR-A4-09 side effect)
create or replace function submit_maintenance_request(
  p_equipment_id bigint,
  p_issue text
)
returns maintenance_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row maintenance_requests;
begin
  if not is_staff_or_admin() then
    raise exception 'Only Staff or an Administrator may submit a maintenance request';
  end if;

  insert into maintenance_requests (equipment_id, requested_by, issue_description, status)
  values (p_equipment_id, auth.uid(), p_issue, 'open')
  returning * into v_row;

  -- BR-A4-09: equipment under maintenance cannot be borrowed
  update equipment set status = 'maintenance', updated_at = now()
  where id = p_equipment_id;

  perform log_action('MAINTENANCE_OPENED', 'Maintenance', v_row.id::text,
    format('Maintenance opened for equipment #%s', p_equipment_id));

  return v_row;
end;
$$;

-- 6.9 Resolve a maintenance request  (Administrator only)
create or replace function resolve_maintenance_request(p_id bigint)
returns maintenance_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row maintenance_requests;
begin
  if not is_admin() then
    raise exception 'Only an Administrator may resolve maintenance requests';
  end if;

  select * into v_row from maintenance_requests where id = p_id for update;
  if v_row is null then
    raise exception 'Maintenance request not found';
  end if;

  update maintenance_requests
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_id
  returning * into v_row;

  update equipment set status = 'available', updated_at = now()
  where id = v_row.equipment_id;

  perform log_action('MAINTENANCE_RESOLVED', 'Maintenance', p_id::text,
    format('Maintenance resolved for equipment #%s', v_row.equipment_id));

  return v_row;
end;
$$;

-- 6.10 Admin: change a user's role  (sensitive → logged)
create or replace function set_user_role(p_user_id uuid, p_role user_role)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row profiles;
begin
  if not is_admin() then
    raise exception 'Only an Administrator may change user roles';
  end if;

  update profiles set role = p_role where id = p_user_id
  returning * into v_row;

  perform log_action('ROLE_CHANGED', 'Users', p_user_id::text,
    format('Role changed to %s', p_role));

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. SEED DATA (sample equipment; remove/edit as you like)
-- ----------------------------------------------------------------------------
insert into equipment (code, name, category, status) values
  ('LAP-001', 'Dell Latitude 5420 Laptop', 'Computing', 'available'),
  ('PROJ-002', 'Epson EB-X05 Projector', 'AV Equipment', 'available'),
  ('MIC-003', 'Shure SM58 Microphone', 'AV Equipment', 'available'),
  ('OSC-004', 'Tektronix TBS1052B Oscilloscope', 'Electronics Lab', 'available'),
  ('CAM-005', 'Canon EOS 200D Camera', 'AV Equipment', 'maintenance');

-- ----------------------------------------------------------------------------
-- NOTE ON BOOTSTRAPPING YOUR FIRST ADMINISTRATOR
-- ----------------------------------------------------------------------------
-- New sign-ups always get role = 'requester' (see handle_new_user()).
-- After your first account signs up, promote it manually once from the
-- Supabase SQL editor (this bypasses RLS because you're running as the
-- Supabase service/owner role):
--
--   update profiles set role = 'administrator' where id = '<your-auth-uid>';
--
-- From then on, use the in-app Users page (set_user_role RPC) to manage roles.
