# Script pentru descarcare batch de imagini pentru testare Big Data
# Descarca imagini din Lorem Picsum (API gratuit, fara autentificare)

param(
    [int]$Count = 50,
    [string]$OutputDir = "test-images"
)

Write-Host "Downloading $Count images for Big Data testing..." -ForegroundColor Cyan

# Creeaza directorul pentru imagini
$fullPath = Join-Path $PSScriptRoot $OutputDir
if (-not (Test-Path $fullPath)) {
    New-Item -ItemType Directory -Path $fullPath | Out-Null
    Write-Host "Created directory: $fullPath" -ForegroundColor Green
}

# Lista de categorii pentru imagini diverse
$categories = @(
    "nature", "city", "people", "animals", "food", 
    "technology", "architecture", "cars", "sports", "art"
)

Write-Host "Starting download..." -ForegroundColor Yellow

for ($i = 1; $i -le $Count; $i++) {
    try {
        # Selectează o categorie random
        $category = $categories[$i % $categories.Count]
        
        # Folosește Lorem Picsum pentru imagini random (fără API key necesar)
        $url = "https://picsum.photos/800/600?random=$i"
        
        $outputFile = Join-Path $fullPath "image_$($i.ToString('000')).jpg"
        
        # Download imagine
        Invoke-WebRequest -Uri $url -OutFile $outputFile -UseBasicParsing -ErrorAction Stop
        
        Write-Host "  [$i/$Count] Downloaded: image_$($i.ToString('000')).jpg" -ForegroundColor Gray
        
        # Pauza mica pentru a nu face spam
        if ($i % 10 -eq 0) {
            Write-Host "  Pause (avoiding rate limit)..." -ForegroundColor DarkGray
            Start-Sleep -Milliseconds 500
        }
    }
    catch {
        Write-Host "  Failed to download image $i : $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Download complete!" -ForegroundColor Green
Write-Host "Images saved to: $fullPath" -ForegroundColor Cyan
Write-Host "Total images: $(Get-ChildItem $fullPath -Filter *.jpg | Measure-Object).Count" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now you can drag & drop these images into the application!" -ForegroundColor Yellow
