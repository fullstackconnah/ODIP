# ODIP local preview — starts the mock API (port 5050) and the Vite dev server (port 5173).
# Requires the user-local Node install at ~\tools\node (set up 2026-08-02).
$node = "$env:USERPROFILE\tools\node"
$root = $PSScriptRoot

$env:PATH = "$node;$env:PATH"
Start-Process -FilePath "$node\node.exe" -ArgumentList "server.js" -WorkingDirectory "$root\mock-api"
Start-Process -FilePath "$node\npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory "$root\frontend"

Write-Host "Mock API  : http://localhost:5062/api/v1 (proxied via Vite at /api)"
Write-Host "Frontend  : http://localhost:5173  (open this)"
