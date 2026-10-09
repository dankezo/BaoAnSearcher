import { useMemo } from 'react'
import { fmtDate, DAV_LOOKUP } from '../../api'
import { IngredientText } from '../../components'
import { TagBadge } from '../../TagFilterDropdown'
import { ALL_COLS } from './davConfig'
import type { DavColumn, TagConfig } from '../../types/dav'

export function useDavColumns(configs: TagConfig[]) {
  return useMemo<DavColumn[]>(
    () =>
      ALL_COLS.map((c) => {
        if (c.key === 'tagId') {
          return {
            ...c,
            text: (r) => configs.find((t) => t.id === r.tagId)?.label || r.tagId || '',
            render: (_v, row) => <TagBadge tagId={row.tagId} configs={configs} />,
          }
        }
        if (c.key === 'soDangKy') {
          return {
            ...c,
            render: (v) => (
              <a className="sdk" href={DAV_LOOKUP} target="_blank" rel="noreferrer">
                {v}
              </a>
            ),
          }
        }
        if (c.key === 'hoatChat') return { ...c, render: (v) => <IngredientText text={v} /> }
        if (c.key === 'tenderGroup') return { ...c, render: (v) => v || 'Chưa có dữ liệu thầu' }
        if (c.key === 'ngayCap') return { ...c, render: (v) => fmtDate(v) }
        if (c.key === 'ngayHetHan') {
          return {
            ...c,
            render: (v, row) => (
              <span className="cell-badge">
                {fmtDate(v)}
                {row.conHieuLuc ? (
                  <span className="badge ok">Hiệu lực</span>
                ) : (
                  <span className="badge off">Hết / không đủ</span>
                )}
              </span>
            ),
          }
        }
        return c
      }),
    [configs],
  )
}
