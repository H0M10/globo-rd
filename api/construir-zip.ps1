# Empaqueta la API en function.zip para subirla a AWS Lambda.
# Uso (desde la carpeta api):  npm run zip
# Nota: se usa tar.exe (incluido en Windows 10/11) porque Compress-Archive de
# Windows PowerShell 5.1 guarda las rutas con "\" y Lambda (Linux) no las entiende.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path 'global-bundle.pem')) {
  Write-Host 'Descargando el certificado de RDS (global-bundle.pem)...'
  curl.exe -sSL -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
}

Write-Host 'Instalando dependencias...'
npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install falló' }

if (Test-Path 'function.zip') { Remove-Item 'function.zip' }
tar.exe -a -cf function.zip index.mjs package.json global-bundle.pem node_modules
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear function.zip' }

$kb = [math]::Round((Get-Item 'function.zip').Length / 1KB)
Write-Host "Listo: api\function.zip ($kb KB). Subelo en Lambda > Codigo > Cargar desde > Archivo .zip"
