// Applies the Appearance theme (Settings > My account) before first paint; the CSP forbids inline scripts. Keep the
// pref validation in step with readUiPreferences (lib/uiPreferences.ts). React re-applies through window.odipTheme.set.
(function () {
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
  var choice = 'system'
  function set(pref) {
    choice = pref === 'light' || pref === 'dark' ? pref : 'system'
    var dark = choice === 'dark' || (choice === 'system' && !!media && media.matches)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', dark ? '#131512' : '#fbf9f5')
  }
  function stored() {
    try {
      var id = JSON.parse(localStorage.getItem('odip_user') || '{}').id
      return id ? JSON.parse(localStorage.getItem('odip_ui_prefs:' + id) || '{}').theme : undefined
    } catch (e) { return undefined } // corrupt JSON, a null blob, or storage that throws: System
  }
  if (media && media.addEventListener) media.addEventListener('change', function () { if (choice === 'system') set('system') })
  // reset re-resolves from the signed-in user's stored prefs (System when signed out): the provider's cleanup uses it so an SPA route change keeps the theme
  window.odipTheme = { set: set, reset: function () { set(stored()) } }
  set(stored())
})()
