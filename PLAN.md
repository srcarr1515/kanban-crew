# Plan: Assign Crew Agents to Ticket Assignee Slot

## Overview
Add the ability to assign a Crew Agent as the assignee of a local-mode task/ticket. This involves DB schema, Rust API, and React UI changes.

## Changes

### 1. DB Migration (`crates/db/migrations/20260319500000_add_crew_member_to_tasks.sql`)
- Add nullable `crew_member_id` column to `tasks` table
- FK reference to `crew_members(id)` with `ON DELETE SET NULL`

### 2. Rust Backend (`crates/server/src/routes/local/mod.rs`)
- Add `crew_member_id: Option<String>` to `LocalTask` response struct
- Add `crew_member_id: Option<String>` to `CreateTaskRequest`
- Add `crew_member_id: Option<Option<String>>` to `UpdateTaskRequest` (with `some_if_present` for nullable)
- Update SQL queries in `list_tasks`, `create_task`, `update_task` to include `crew_member_id`

### 3. Frontend Types & API
**`packages/web-core/src/shared/lib/local/taskAdapter.ts`:**
- Add `crew_member_id: string | null` to `LocalTask` interface

**`packages/web-core/src/shared/lib/local/localApi.ts`:**
- Add `crew_member_id` to `createLocalTask` and `updateLocalTask` parameter types

### 4. LocalOrgProvider (`packages/web-core/src/shared/providers/local/LocalOrgProvider.tsx`)
- Fetch crew members via React Query
- Map crew members to `OrganizationMemberWithProfile` format and populate `membersWithProfilesById`
- This enables KanbanContainer's existing `issueAssigneesMap` logic to resolve crew member data for card display

### 5. LocalProjectProvider (`packages/web-core/src/shared/providers/local/LocalProjectProvider.tsx`)
- Build `issueAssignees` array from tasks that have `crew_member_id` set
- Implement `getAssigneesForIssue` to return the crew member assignment
- Add `updateLocalTask(id, { crew_member_id })` support in the `updateIssue` mutation path

### 6. Crew Member Assignee Dialog (`packages/web-core/src/shared/dialogs/kanban/CrewMemberAssigneeDialog.tsx`)
- Simple command dialog listing crew members
- Single-select (one assignee per task)
- Shows crew member name and avatar
- "Unassign" option when already assigned
- Calls `updateLocalTask(taskId, { crew_member_id })` on selection

### 7. KanbanContainer Wiring (`packages/web-core/src/features/kanban/ui/KanbanContainer.tsx`)
- When `IS_LOCAL_MODE`, override `handleCardAssigneeClick` to open `CrewMemberAssigneeDialog` instead of `AssigneeSelectionDialog`
