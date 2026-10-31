// The screen-reader table behind a chart: the same figures as the marks, with real headers.
export function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: Array<{ header: string; cells: string[] }> }) {
  return (
    <table data-table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map(c => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.header}>
            <th scope="row">{row.header}</th>
            {row.cells.map((cell, i) => <td key={i}>{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
