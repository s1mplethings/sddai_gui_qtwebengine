<#
  gen_aidoc.ps1 — 生成 AI Doc 骨架
  用法：
    powershell -ExecutionPolicy Bypass -File scripts\gen_aidoc.ps1 -Target "C:\\your\\project"
  逻辑：
    - 从 ai_context\templates\aidoc 拷贝模板到目标目录的 docs/aidoc。
    - 现有文件会备份为 <name>.bak。
#>
param(
  [Parameter(Mandatory=$true)][string]$Target
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $root
$template = Join-Path $repo 'ai_context/templates/aidoc'
if (-not (Test-Path $template)) { Write-Error "Template not found: $template"; exit 1 }
$dst = Join-Path $Target 'docs/aidoc'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

Get-ChildItem -File $template | ForEach-Object {
  $destFile = Join-Path $dst $_.Name
  if (Test-Path $destFile) { Copy-Item $destFile "$destFile.bak" -Force }
  Copy-Item $_.FullName $destFile -Force
}
Write-Output "[gen_aidoc] copied to $dst"
