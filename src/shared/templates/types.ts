// ─── Template schema ─────────────────────────────────────────────────────────

export interface ScenarioTemplate {
  id: string
  name: string
  description: string
  icon: string
  /** Optional cover image URL (absolute https for remote templates). Falls back to `icon`. */
  cover?: string
  category: string
  tags: string[]
  version: string
  author?: string
  source: 'builtin' | 'remote'

  preview: { tables: number; views: number; records: number; dashboards?: number }

  inputs: TemplateInput[]

  /** Table definitions — created in order */
  tables: TemplateTableDef[]

  /**
   * Dashboard definitions.
   * Block configs use symbolic placeholders instead of raw IDs:
   *   table_id  → "__tbl:{ref}__"
   *   field_id  → "__fld:{tableRef}:{fieldName}__"
   * The engine resolves these back to real IDs after table creation.
   */
  dashboards?: TemplateDashboard[]

  target: 'new_app' | 'current_app'
}

export interface TemplateInput {
  key: string
  label: string
  type: 'text' | 'select'
  placeholder?: string
  default?: string
  required?: boolean
  options?: Array<{ value: string; label: string }>
}

export interface TemplateTableDef {
  ref: string
  name: string
  fields: TemplateFieldDef[]
  views?: TemplateViewDef[]
  sample_records?: Array<Record<string, unknown>>
}

export interface TemplateFieldDef {
  name: string
  /**
   * Feishu field type number.
   * 1=Text 2=Number 3=SingleSelect 4=MultiSelect 5=DateTime 7=Checkbox
   * 13=Phone 15=URL 17=Attachment 18=SingleLink 19=Lookup 20=Formula
   * 21=DuplexLink 22=Location 1005=AutoNumber（18/19/21 关联类需 property，模板暂不支持）
   */
  type: number
  options?: Array<{ name: string; color?: number }>
  /** For formula fields (type=20). Uses field names in brackets: "[数量]*[单价]" */
  formula_expression?: string
  description?: string
}

export interface TemplateViewDef {
  name: string
  type: 'grid' | 'kanban' | 'gallery' | 'gantt' | 'form'
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface TemplateDashboard {
  name: string
  blocks: TemplateDashboardBlock[]
}

export interface TemplateDashboardBlock {
  /** Feishu block type: 1=chart 2=table_summary 3=metric_card */
  block_type: number
  /**
   * Block config with IDs replaced by symbolic references.
   * "__tbl:{ref}__" and "__fld:{tableRef}:{fieldName}__"
   */
  config: Record<string, unknown>
}

// ─── Registry ────────────────────────────────────────────────────────────────

export interface RegistryIndex {
  version: string
  updated_at: string
  templates: RegistryEntry[]
}

export interface RegistryEntry {
  id: string
  name: string
  icon: string
  cover?: string
  category: string
  description: string
  version: string
  file: string
}

// ─── Execution ───────────────────────────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export interface ProgressStep {
  id: string
  label: string
  status: StepStatus
  detail?: string
}

export interface CreationResult {
  appToken: string
  appName: string
  appUrl: string
  tables: Array<{ ref: string; name: string; tableId: string }>
  totalRecords: number
  dashboardWarnings?: string[]
  /** Names of dashboards auto-created via DOM automation */
  dashboardsCreated?: string[]
}
