// DAV is the source of dosage forms for VSS, which has no form column in TiDB.
export const sdkKeySql=(column,dialect='tidb')=>{
 const key=`UPPER(REPLACE(TRIM(${column}), ' ', ''))`
 return dialect==='tidb'?`CONVERT(${key} USING utf8mb4) COLLATE utf8mb4_unicode_ci`:key
}
export function sdkFormsSql(dialect='tidb'){
 const entries=['so_dang_ky','so_dang_ky_cu'].map(column=>`SELECT ${sdkKeySql(column,dialect)} AS sdk_form_key, TRIM(dang_bao_che) AS dav_form FROM dav_drugs WHERE ${column} IS NOT NULL AND TRIM(${column})<>'' AND dang_bao_che IS NOT NULL AND TRIM(dang_bao_che)<>''`)
 // One row per registration prevents duplicate DAV decisions multiplying awards.
 // Conflicting forms remain unresolved rather than picking an arbitrary form.
 return `SELECT sdk_form_key, CASE WHEN COUNT(DISTINCT dav_form)=1 THEN MIN(dav_form) END AS dav_form FROM (${entries.join(' UNION ALL ')}) sdk_entries GROUP BY sdk_form_key`
}
