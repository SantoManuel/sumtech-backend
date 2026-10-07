```powershell
# =============================================================================
# Script: export-simulation-pdfs.ps1
# Descripcion: Descarga los 25 PDFs de simulacion DGII (A4 + 80mm)
#              desde el backend local y los guarda en una carpeta organizada.
# =============================================================================

$ErrorActionPreference = "Stop"

$BaseUrl     = "http://localhost:4000/api/v1"
$LoginUrl    = "$BaseUrl/auth/login"
$PdfBaseUrl  = "$BaseUrl/invoicing/dgii/certification/pdf"
$SeqOffset   = 160

# Carpeta de destino
$OutputDir  = "C:\Users\Santo Manuel\Desktop\Sumtech\RepresentacionesImpresas_Simulacion_DGII"
$A4Dir      = Join-Path $OutputDir "A4"
$ThermalDir = Join-Path $OutputDir "80mm"

# =============================================================================
# Crear directorios
# =============================================================================

New-Item -ItemType Directory -Path $A4Dir -Force | Out-Null
New-Item -ItemType Directory -Path $ThermalDir -Force | Out-Null

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Exportacion de PDFs - Simulacion DGII" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# =============================================================================
# 1. LOGIN
# =============================================================================

Write-Host "`n[1/3] Obteniendo token JWT..." -ForegroundColor Yellow

$loginBody = @{
    identifier = "admin"
    password   = "password123"
} | ConvertTo-Json

try {

    $loginResponse = Invoke-RestMethod `
        -Uri $LoginUrl `
        -Method POST `
        -Body $loginBody `
        -ContentType "application/json"

    $token = $loginResponse.accessToken

    if (-not $token) {
        $token = $loginResponse.access_token
    }

    if (-not $token) {

        Write-Host "  ERROR: No se pudo obtener accessToken del login." -ForegroundColor Red

        Write-Host `
            "  Respuesta: $($loginResponse | ConvertTo-Json -Depth 5)" `
            -ForegroundColor Red

        exit 1
    }

    Write-Host "  Token obtenido exitosamente." -ForegroundColor Green

}
catch {

    Write-Host `
        "  ERROR en login: $($_.Exception.Message)" `
        -ForegroundColor Red

    exit 1
}

$headers = @{
    Authorization = "Bearer $token"
}

# =============================================================================
# 2. LISTA DE LOS 25 e-NCFs
# =============================================================================

$eNcfs = @(
    "E310000000161",  # Sim 1
    "E310000000162",  # Sim 2
    "E310000000163",  # Sim 3
    "E310000000164",  # Sim 4
    "E320000000161",  # Sim 5
    "E320000000162",  # Sim 6
    "E410000000161",  # Sim 7
    "E410000000162",  # Sim 8
    "E430000000161",  # Sim 9
    "E430000000162",  # Sim 10
    "E440000000161",  # Sim 11
    "E440000000162",  # Sim 12
    "E450000000161",  # Sim 13
    "E450000000162",  # Sim 14
    "E460000000161",  # Sim 15
    "E460000000162",  # Sim 16
    "E470000000161",  # Sim 17
    "E470000000162",  # Sim 18
    "E330000000161",  # Sim 19
    "E340000000161",  # Sim 20
    "E340000000162",  # Sim 21
    "E320000000163",  # Sim 22
    "E320000000164",  # Sim 23
    "E320000000165",  # Sim 24
    "E320000000166"   # Sim 25
)

# =============================================================================
# 3. DESCARGAR PDFs
# =============================================================================

Write-Host "`n[2/3] Descargando 50 PDFs (25 A4 + 25 80mm)..." -ForegroundColor Yellow

$successCount = 0
$errorCount   = 0

for ($i = 0; $i -lt $eNcfs.Count; $i++) {

    $eNcf = $eNcfs[$i]
    $num  = $i + 1

    # -------------------------------------------------------------------------
    # A4
    # -------------------------------------------------------------------------

    $a4File = Join-Path `
        $A4Dir `
        "RI_131148697_${eNcf}_A4.pdf"

    $a4Url = "${PdfBaseUrl}/${eNcf}?format=a4&offset=${SeqOffset}"

    try {

        Invoke-WebRequest `
            -Uri $a4Url `
            -Headers $headers `
            -OutFile $a4File `
            -UseBasicParsing

        $a4Size = (Get-Item $a4File).Length

        Write-Host `
            "  [$num/25] A4  : $eNcf -> OK ($a4Size bytes)" `
            -ForegroundColor Green

        $successCount++

    }
    catch {

        Write-Host `
            "  [$num/25] A4  : $eNcf -> ERROR: $($_.Exception.Message)" `
            -ForegroundColor Red

        $errorCount++
    }

    # -------------------------------------------------------------------------
    # 80mm
    # -------------------------------------------------------------------------

    $thermalFile = Join-Path `
        $ThermalDir `
        "RI_131148697_${eNcf}_80mm.pdf"

    $thermalUrl = "${PdfBaseUrl}/${eNcf}?format=80mm&offset=${SeqOffset}"

    try {

        Invoke-WebRequest `
            -Uri $thermalUrl `
            -Headers $headers `
            -OutFile $thermalFile `
            -UseBasicParsing

        $thermalSize = (Get-Item $thermalFile).Length

        Write-Host `
            "  [$num/25] 80mm: $eNcf -> OK ($thermalSize bytes)" `
            -ForegroundColor Green

        $successCount++

    }
    catch {

        Write-Host `
            "  [$num/25] 80mm: $eNcf -> ERROR: $($_.Exception.Message)" `
            -ForegroundColor Red

        $errorCount++
    }
}

# =============================================================================
# 4. RESUMEN
# =============================================================================

Write-Host "`n[3/3] RESUMEN" -ForegroundColor Cyan

Write-Host `
    "  Exitosos : $successCount / 50" `
    -ForegroundColor Green

if ($errorCount -gt 0) {
    $errorColor = "Red"
}
else {
    $errorColor = "Green"
}

Write-Host `
    "  Errores  : $errorCount / 50" `
    -ForegroundColor $errorColor

Write-Host `
    "  Carpeta  : $OutputDir" `
    -ForegroundColor White

# =============================================================================
# LISTAR ARCHIVOS A4
# =============================================================================

Write-Host "`n  Archivos A4:" -ForegroundColor Yellow

Get-ChildItem $A4Dir -Filter "*.pdf" |
    ForEach-Object {
        Write-Host "    $($_.Name) ($($_.Length) bytes)"
    }

# =============================================================================
# LISTAR ARCHIVOS 80mm
# =============================================================================

Write-Host "`n  Archivos 80mm:" -ForegroundColor Yellow

Get-ChildItem $ThermalDir -Filter "*.pdf" |
    ForEach-Object {
        Write-Host "    $($_.Name) ($($_.Length) bytes)"
    }

# =============================================================================
# FIN
# =============================================================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host " EXPORTACION COMPLETADA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
```

