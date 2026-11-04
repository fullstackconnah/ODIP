import { Navigate, useParams } from 'react-router-dom'

// Incidents are edited in place, a part at a time, on the full view; the wizard now serves new reports only.
// Old `/incidents/:id/edit` bookmarks and stored task links land on the view.
export default function IncidentEditRedirect() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/incidents/${id}`} replace />
}
