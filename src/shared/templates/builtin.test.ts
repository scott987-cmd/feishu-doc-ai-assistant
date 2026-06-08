import { describe, it, expect } from 'vitest'
import { BUILTIN_TEMPLATES } from './builtin'

// Writing a sample record to a field that doesn't exist (or to a formula/relation/
// auto/system field) makes Feishu reject the whole batch (1254045 FieldNameNotFound).
// Guard that every sample_record key matches a writable field name in its table.
const NON_WRITABLE = new Set([18, 19, 20, 21, 1001, 1002, 1003, 1004, 1005])

describe('builtin templates — sample records match field names', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    for (const table of tpl.tables) {
      const writable = new Set(
        table.fields.filter((f) => !NON_WRITABLE.has(f.type)).map((f) => f.name)
      )
      it(`${tpl.id} / ${table.name}: every sample key is a writable field`, () => {
        const offenders: string[] = []
        for (const rec of table.sample_records ?? []) {
          for (const key of Object.keys(rec)) {
            if (!writable.has(key)) offenders.push(key)
          }
        }
        expect(offenders, `unknown/non-writable keys: ${[...new Set(offenders)].join(', ')}`).toEqual([])
      })
    }
  }
})
