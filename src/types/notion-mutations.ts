// Typed Notion property update payloads.
// These match the Notion API property format for page updates.

export interface NotionStatusUpdate {
  Status: { status: { name: string } }
}

export interface NotionPriorityUpdate {
  Priority: { select: { name: string } }
}

export interface NotionTagsUpdate {
  Tags: { multi_select: Array<{ name: string }> }
}

export interface NotionAssigneeUpdate {
  Assignee: { people: Array<{ id: string }> }
}

export interface NotionDateUpdate {
  Date: { date: { start: string } }
}

/** Union of all valid Notion property updates for tasks. */
export type TaskPropertyUpdate = Partial<
  NotionStatusUpdate & NotionPriorityUpdate & NotionTagsUpdate & NotionAssigneeUpdate
>

/** Union of all valid Notion property updates for calendar items. */
export type CalendarPropertyUpdate = Partial<
  NotionStatusUpdate & NotionTagsUpdate & NotionAssigneeUpdate & NotionDateUpdate
>

/** Any valid Notion property update (tasks or calendar). */
export type NotionPropertyUpdate = Partial<
  NotionStatusUpdate & NotionPriorityUpdate & NotionTagsUpdate & NotionAssigneeUpdate & NotionDateUpdate
>
