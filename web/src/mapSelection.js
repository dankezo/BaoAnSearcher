/** List click selects that row and leaves the province, query, and camera alone. */
export function selectListedDot(state, row) {
  const id = row?.id
  return {
    place: state?.place ?? null,
    query: state?.query,
    zoomIntent: state?.zoomIntent ?? null,
    pick: id ? { type: 'dot', id } : state?.pick ?? null,
  }
}
