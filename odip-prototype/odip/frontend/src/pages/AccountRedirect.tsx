import { Navigate, useSearchParams } from 'react-router-dom'

/** The server's Microsoft callback for linking an account returns to /account?section=microsoft&microsoft=<outcome>; Profile in Settings is where that is shown. */
export default function AccountRedirect() {
  const microsoft = useSearchParams()[0].get('microsoft')
  return <Navigate replace to={`/settings?section=profile${microsoft ? `&microsoft=${encodeURIComponent(microsoft)}` : ''}`} />
}
