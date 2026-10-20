// PostgREST may cap a response even when a larger limit is requested.
// Supply a new query for every page and a unique ordering column.
async function readAllRows(makeQuery, orderColumn = 'symbol', pageSize = 500) {
  const rows = [];
  for (;;) {
    const { data, error } = await makeQuery()
      .order(orderColumn, { ascending: true })
      .range(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    // Advance by what the server returned, including when its cap is smaller
    // than our requested page. Stop only at an empty page.
    rows.push(...data);
  }
}

module.exports = { readAllRows };
