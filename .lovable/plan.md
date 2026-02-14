

# Strukcha v2 Rebuild — Phase 1 Plan

## Overview
A secure internal web app for creditte to import XPM relationship reports and visualise/edit group structures. Phase 1 covers the core foundation: auth, data model, import, and basic structure viewing with React Flow.

---

## 1. Authentication & Tenant Setup
- Email/password login and signup via Lovable Cloud (Supabase Auth)
- Tenant table with a single seed tenant ("creditte")
- User roles table (Admin, Editor, Viewer) with `has_role()` security definer function
- Profiles table linked to `auth.users`
- All data tables include `tenant_id` with RLS policies enforcing tenant isolation
- Protected routes: redirect unauthenticated users to login

## 2. Database Schema (Core Tables)
- **tenants** — id, name
- **entities** — id, tenant_id, name, entity_type (enum), trust_subtype (enum, nullable), abn, acn, source, verified, timestamps
- **relationships** — id, tenant_id, from_entity_id, to_entity_id, relationship_type (enum), directionality fields, ownership_percent/units/class, start_date, end_date, source, confidence, timestamps
- **structures** — id, tenant_id, name, timestamps
- **structure_entities** — structure_id, entity_id (join table)
- **structure_relationships** — structure_id, relationship_id (join table)
- **import_logs** — id, tenant_id, user_id, raw_payload, file_name, status, timestamps
- **audit_log** — id, tenant_id, user_id, action, entity_type, entity_id, before_state, after_state, timestamps
- RLS on all tables scoped to tenant_id

## 3. App Layout & Navigation
- Sidebar navigation: Dashboard, Structures, Import, Review & Fix, Settings
- Clean internal admin look (no public marketing feel)
- Role-based UI: Viewers see read-only views; Editors can modify; Admins manage users/settings

## 4. Import Workflow (Edge Function)
- **Import page** with file upload (CSV and XML)
- **Edge Function** to parse uploaded files:
  - Extract columns: Group(s), Client, UUID, Business Structure, Relationship Type, Related Client
  - Create/update entities using UUID match first, then exact name match
  - Create structures from Group(s) values
  - Canonicalise relationships ("X Of" → canonical direction), deduplicate inverse rows
  - Partner relationships stored with alphabetical entity_id ordering
  - Family relationships (spouse/parent/child) imported but flagged as family type
  - Store raw file payload in import_logs for audit
- **Import results summary** shown after processing (entities created/updated, relationships created, any warnings)

## 5. Structures List Page
- Searchable list of all structures for the tenant
- Sort by recently updated
- Click to open a structure

## 6. Structure View with React Flow Graph
- Interactive graph: nodes = entities, edges = relationships (labeled with type + ownership %)
- Left panel with:
  - Search by entity name
  - Filter by entity_type and relationship_type
  - Toggle "Show family relationships" (default OFF)
  - Depth control (1–3 hops from selected node)
- Click a node → side panel showing entity details and its relationships
- Read-only in Phase 1 (editing comes in Phase 2)

## 7. Dashboard
- Summary stats: total structures, entities, recent imports
- Quick links to recent structures

---

## What's Deferred to Phase 2
- Edit mode (add/edit/delete relationships and entities inline)
- Merge duplicates workflow
- Validation enforcement (block export if Unclassified entities exist)
- Audit log viewing screen
- Export (PNG/SVG graph, CSV exports)
- Fuzzy name matching suggestions during import
- Xero OAuth2/API integration placeholders
- Settings page (user management, tenant config)

