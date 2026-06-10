import { feishuFetch } from './http'

async function req<T = unknown>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  params?: Record<string, string>
): Promise<T> {
  // feishuFetch handles the outbound allowlist, retries, and (on private deploys) the
  // /<svc>/vN/ → v(N-1) version fallback for instances that lag behind SaaS.
  const res = await feishuFetch(method, path, token, body, params)

  const json = await res.json() as { code: number; msg: string; data: T }

  if (!res.ok || json.code !== 0) {
    // Permission errors on user-owned resources: app (tenant) identity can't edit
    // documents/sheets/bases the user created. Point at the fix.
    const isForbidden = json.code === 1770032 || json.code === 91403 || /forbidden|permission|denied/i.test(json.msg)
    const hint = isForbidden
      ? '（应用对该资源无编辑权限。若是你本人创建的文档/表格，请在「设置」用飞书账号授权后以个人身份操作；或在该文档右上「分享」把应用加为可编辑协作者）'
      : ''
    throw new Error(`Feishu API error (code=${json.code}): ${json.msg}${hint}`)
  }
  return json.data
}

// ─── App ─────────────────────────────────────────────────────────────────────

export function getApp(token: string, appToken: string) {
  return req('GET', `/bitable/v1/apps/${appToken}`, token)
}

export function createApp(token: string, name: string) {
  return req('POST', '/bitable/v1/apps', token, { name })
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export function listTables(token: string, appToken: string) {
  return req('GET', `/bitable/v1/apps/${appToken}/tables`, token)
}

export function createTable(
  token: string,
  appToken: string,
  name: string,
  fields: FeishuField[] = []
) {
  return req('POST', `/bitable/v1/apps/${appToken}/tables`, token, {
    table: { name, default_view_name: '默认视图', fields },
  })
}

export function deleteTable(token: string, appToken: string, tableId: string) {
  return req('DELETE', `/bitable/v1/apps/${appToken}/tables/${tableId}`, token)
}

// ─── Fields ──────────────────────────────────────────────────────────────────

export function listFields(token: string, appToken: string, tableId: string) {
  return req('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, token)
}

export function createField(token: string, appToken: string, tableId: string, field: FeishuField) {
  return req('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, token, field)
}

export function updateField(
  token: string,
  appToken: string,
  tableId: string,
  fieldId: string,
  field: Partial<FeishuField>
) {
  // Feishu's update-field API requires field_name + type in the body; callers
  // must supply both (executeTool backfills them from the current field).
  return req('PUT', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`, token, field)
}

export function deleteField(token: string, appToken: string, tableId: string, fieldId: string) {
  return req('DELETE', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`, token)
}

// ─── Records ─────────────────────────────────────────────────────────────────

export function listRecords(
  token: string,
  appToken: string,
  tableId: string,
  pageSize = 20,
  pageToken?: string
) {
  return req(
    'GET',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    token,
    undefined,
    {
      page_size: String(pageSize),
      ...(pageToken ? { page_token: pageToken } : {}),
    }
  )
}

export function createRecord(
  token: string,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>
) {
  return req('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records`, token, { fields })
}

export function batchCreateRecords(
  token: string,
  appToken: string,
  tableId: string,
  records: Array<{ fields: Record<string, unknown> }>
) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    token,
    { records }
  )
}

export function updateRecord(
  token: string,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
) {
  return req(
    'PUT',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    token,
    { fields }
  )
}

export function deleteRecord(
  token: string,
  appToken: string,
  tableId: string,
  recordId: string
) {
  return req('DELETE', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, token)
}

export function batchUpdateRecords(
  token: string,
  appToken: string,
  tableId: string,
  records: Array<{ record_id: string; fields: Record<string, unknown> }>
) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
    token,
    { records }
  )
}

/** Fetch full field data for specific record_ids — used to CAPTURE rows right before a delete
 *  so the deletion can be undone (re-created) afterward. */
export function batchGetRecords(
  token: string,
  appToken: string,
  tableId: string,
  recordIds: string[]
) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_get`,
    token,
    { record_ids: recordIds }
  )
}

export function batchDeleteRecords(
  token: string,
  appToken: string,
  tableId: string,
  records: string[]   // array of record_ids
) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`,
    token,
    { records }
  )
}

export interface SearchCondition { field_name: string; operator: string; value: string[] }
export interface SearchFilter { conjunction: 'and' | 'or'; conditions: SearchCondition[] }

const FILTER_OP_MAP: Record<string, string> = {
  '=': 'is',
  '!=': 'isNot',
  '>=': 'isGreaterEqual',
  '<=': 'isLessEqual',
  '>': 'isGreater',
  '<': 'isLess',
}

// Split on top-level commas only (ignoring commas inside quotes or parentheses).
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let cur = ''
  for (const ch of s) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

function parseAtom(atom: string): SearchCondition {
  const m = atom.trim().match(/^CurrentValue\.\[([^\]]+)\]\s*(>=|<=|!=|=|>|<)\s*(.+)$/s)
  if (!m) throw new Error(`无法解析过滤条件: ${atom.trim()}（支持 CurrentValue.[字段]=/!=/>/</>=/<= 值）`)
  const [, field, op, rawVal] = m
  let v = rawVal.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return { field_name: field, operator: FILTER_OP_MAP[op], value: [v] }
}

/**
 * Convert the documented filter formula (CurrentValue.[字段]="值", optionally wrapped
 * in AND(...)/OR(...)) into the structured filter the records/search endpoint expects.
 * The endpoint ignores any unknown formula string, so without this the filter would be
 * silently dropped (returning ALL records) — dangerous for update_where. Throws on an
 * unparseable filter rather than matching everything.
 */
export function parseFilterFormula(formula: string): SearchFilter {
  let s = formula.trim()
  let conjunction: 'and' | 'or' = 'and'
  const wrapped = s.match(/^(AND|OR)\s*\((.*)\)$/is)
  if (wrapped) {
    conjunction = wrapped[1].toUpperCase() === 'OR' ? 'or' : 'and'
    s = wrapped[2].trim()
  }
  const conditions = splitTopLevel(s).map(parseAtom)
  if (conditions.length === 0) throw new Error(`空的过滤条件: ${formula}`)
  return { conjunction, conditions }
}

export function searchRecords(
  token: string,
  appToken: string,
  tableId: string,
  filter?: string,
  pageSize = 20,
  viewId?: string,
  pageToken?: string
) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
    token,
    {
      ...(filter ? { filter: parseFilterFormula(filter) } : {}),
      ...(viewId ? { view_id: viewId } : {}),
    },
    // page_size / page_token are QUERY params on records/search (body page_size is ignored by the
    // server, so it would silently fall back to the default page size and over-paginate).
    { page_size: String(pageSize), ...(pageToken ? { page_token: pageToken } : {}) }
  )
}

// ─── Wiki ──────────────────────────────────────────────────────────────────────
// A wiki node wraps a real object (docx / sheet / bitable). Resolve it to the real
// obj_type + obj_token. Needs scope wiki:wiki:readonly (or wiki:node:read).

export function getWikiNode(token: string, wikiToken: string) {
  return req('GET', '/wiki/v2/spaces/get_node', token, undefined, {
    token: wikiToken,
    obj_type: 'wiki',
  })
}

// ─── Views ───────────────────────────────────────────────────────────────────

export function listViews(token: string, appToken: string, tableId: string) {
  return req('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/views`, token)
}

export function createView(
  token: string,
  appToken: string,
  tableId: string,
  viewName: string,
  viewType: 'grid' | 'kanban' | 'gallery' | 'gantt' | 'form'
) {
  return req('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/views`, token, {
    view_name: viewName,
    view_type: viewType,
  })
}

// ─── Sharing / ownership ───────────────────────────────────────────────────────
// Bases created with a tenant_access_token are owned by the app and don't appear
// in any user's drive. Transfer ownership to a real user so they can see/manage it.

export type MemberIdType = 'email' | 'openid' | 'userid'

/**
 * Transfer ownership of a Base to a user. With removeOldOwner=false the app stays
 * on as a collaborator (full_access), so it can keep operating on the Base.
 */
export function transferBaseOwner(
  token: string,
  appToken: string,
  memberType: MemberIdType,
  memberId: string,
  removeOldOwner = false,
  objType: 'bitable' | 'sheet' | 'docx' = 'bitable'
) {
  return req(
    'POST',
    `/drive/v1/permissions/${appToken}/members/transfer_owner`,
    token,
    { member_type: memberType, member_id: memberId },
    { type: objType, need_notification: 'false', remove_old_owner: String(removeOldOwner), stay_put: String(!removeOldOwner) }
  )
}

/** Add a user as a collaborator on a Base (alternative to transfer — app stays owner). */
export function addBaseMember(
  token: string,
  appToken: string,
  memberType: MemberIdType,
  memberId: string,
  perm: 'view' | 'edit' | 'full_access' = 'full_access'
) {
  return req(
    'POST',
    `/drive/v1/permissions/${appToken}/members`,
    token,
    { member_type: memberType, member_id: memberId, perm },
    { type: 'bitable' }
  )
}

// ─── Dashboards ──────────────────────────────────────────────────────────────

export function listDashboards(token: string, appToken: string) {
  return req('GET', `/bitable/v1/apps/${appToken}/dashboards`, token)
}

/**
 * Copy an existing dashboard within a Base. This is the ONLY write operation
 * Feishu's OpenAPI offers for dashboards — there is no API to create a dashboard
 * from scratch or to add/read individual chart blocks (see deprecated stubs below).
 * Verified live: endpoint is real (returns 91403 when the caller lacks edit perm,
 * not 404). Requires edit access to the Base.
 */
export function copyDashboard(token: string, appToken: string, dashboardBlockId: string, name: string) {
  return req(
    'POST',
    `/bitable/v1/apps/${appToken}/dashboards/${dashboardBlockId}/copy`,
    token,
    { name }
  )
}

// NOTE: Feishu bitable OpenAPI has NO endpoint to list or create individual
// dashboard chart blocks (.../dashboards/{id}/blocks → verified HTTP 404).
// Programmatic chart creation/read is impossible; copyDashboard (above) is the
// only dashboard write, and it duplicates a whole dashboard within the same Base.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeishuField {
  field_name: string
  type: FieldType
  property?: {
    options?: Array<{ name: string; color?: number }>
    formatter?: string
    date_formatter?: string
    number_exceeds?: string
    /** For formula fields (type=20) */
    formula_expression?: string
  }
  description?: { text?: string; disable_sync?: boolean }
}

export enum FieldType {
  Text = 1,
  Number = 2,
  SingleSelect = 3,
  MultiSelect = 4,
  DateTime = 5,
  Checkbox = 7,
  Person = 11,
  Phone = 13,
  Url = 15,
  Attachment = 17,
  SingleLink = 18,
  Lookup = 19,
  Formula = 20,
  DuplexLink = 21,
  Location = 22,
  CreatedTime = 1001,
  ModifiedTime = 1002,
  CreatedUser = 1003,
  ModifiedUser = 1004,
  AutoNumber = 1005,
}
