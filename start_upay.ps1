Set-Location $PSScriptRoot
Start-Process "http://localhost:8080"
try { py -m http.server 8080 } catch { python -m http.server 8080 }
