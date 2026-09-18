# Minimal static file server for local testing (no Node/Python needed).
#
#   .\serve.ps1            -> http://localhost:8080/
#   .\serve.ps1 -Port 3000
#   .\serve.ps1 -Lan       -> also reachable from other devices on your network
#                             (needs an elevated PowerShell, or once run as admin:
#                              netsh http add urlacl url=http://+:8080/ user=Everyone)
#
# Note: service workers (offline support) only register on localhost or HTTPS,
# so a phone on your LAN loading http://<pc-ip>:8080 will run the game but not
# install the offline cache. See README.md for options.

param(
  [int]$Port = 8080,
  [switch]$Lan
)

$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$Root = (Resolve-Path $Root).Path.TrimEnd('\')

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json'
  '.png'  = 'image/png'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$host_ = if ($Lan) { '+' } else { 'localhost' }
$listener.Prefixes.Add("http://${host_}:$Port/")
try {
  $listener.Start()
} catch {
  Write-Error "Could not start listener on port $Port : $($_.Exception.Message)"
  exit 1
}
Write-Host "Serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path.EndsWith('/')) { $path += 'index.html' }
      $rel = $path.TrimStart('/') -replace '/', '\'
      $file = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      $inside = $file.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)
      if ($inside -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
        $type = 'application/octet-stream'
        if ($mime.ContainsKey($ext)) { $type = $mime[$ext] }
        $res.StatusCode = 200
        $res.ContentType = $type
        $res.Headers['Cache-Control'] = 'no-cache'
        $res.ContentLength64 = $bytes.Length
        if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $msg = [Text.Encoding]::UTF8.GetBytes('Not found')
        $res.StatusCode = 404
        $res.ContentType = 'text/plain; charset=utf-8'
        $res.ContentLength64 = $msg.Length
        $res.OutputStream.Write($msg, 0, $msg.Length)
      }
      Write-Host ("{0} {1} {2}" -f $res.StatusCode, $req.HttpMethod, $req.Url.PathAndQuery)
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
}
