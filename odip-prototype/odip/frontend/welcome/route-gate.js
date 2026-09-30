// Route gate: a tiny CLASSIC script (no imports or exports), loaded first in the app's <head>.
// A signed-out visitor to exactly "/" is sent to the landing page before the app bundle loads,
// so there is no flash of the login page and the marketing visitor never downloads the app.
// Deep links (/trips/..., /login, ...) and signed-in visitors are untouched.
// It must stay a same-origin external file: the CSP allows no inline script.
// "odip_token" is the key the app's PrivateRoute and API client use for the session.
(function () {
  try {
    if (location.pathname !== '/') return
    if (localStorage.getItem('odip_token')) return
    location.replace('/welcome/')
  } catch (error) {
    // Storage blocked or unavailable: leave the visitor on the app.
  }
})()
