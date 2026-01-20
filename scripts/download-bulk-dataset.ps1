# Big Data Image Processor - Dataset Download Script
# Downloads images from multiple sources for bulk processing

param(
    [int]$Count = 1000,
    [string]$OutputDir = ".\datasets\bulk",
    [string]$Source = "unsplash",
    [string]$Category = "random"
)

Write-Host " Big Data Image Downloader" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host "Target: $Count images from $Source" -ForegroundColor Yellow
Write-Host "Output: $OutputDir" -ForegroundColor Yellow
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    Write-Host "✓ Created directory: $OutputDir" -ForegroundColor Green
}

# Function to download from Unsplash
function Download-UnsplashImages {
    param([int]$Count, [string]$OutputDir, [string]$Category)
    
    Write-Host " Downloading from Unsplash..." -ForegroundColor Cyan
    
    $baseUrl = "https://source.unsplash.com/random/800x600"
    $successCount = 0
    
    for ($i = 1; $i -le $Count; $i++) {
        $filename = "unsplash_${Category}_${i}.jpg"
        $outputPath = Join-Path $OutputDir $filename
        
        try {
            $url = if ($Category -ne "random") {
                "${baseUrl}?${Category}&sig=$i"
            } else {
                "${baseUrl}?sig=$i"
            }
            
            Invoke-WebRequest -Uri $url -OutFile $outputPath -TimeoutSec 10 -ErrorAction Stop
            $successCount++
            
            if ($i % 50 -eq 0) {
                Write-Host "  Progress: $i/$Count ($successCount successful)" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ✗ Failed to download image $i" -ForegroundColor Red
        }
        
        # Rate limiting
        Start-Sleep -Milliseconds 200
    }
    
    Write-Host "✓ Downloaded $successCount/$Count images" -ForegroundColor Green
}

# Function to download from Lorem Picsum
function Download-LoremPicsumImages {
    param([int]$Count, [string]$OutputDir)
    
    Write-Host " Downloading from Lorem Picsum..." -ForegroundColor Cyan
    
    $successCount = 0
    
    for ($i = 1; $i -le $Count; $i++) {
        $filename = "picsum_${i}.jpg"
        $outputPath = Join-Path $OutputDir $filename
        
        try {
            $url = "https://picsum.photos/800/600?random=$i"
            Invoke-WebRequest -Uri $url -OutFile $outputPath -TimeoutSec 10 -ErrorAction Stop
            $successCount++
            
            if ($i % 50 -eq 0) {
                Write-Host "  Progress: $i/$Count ($successCount successful)" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ✗ Failed to download image $i" -ForegroundColor Red
        }
        
        Start-Sleep -Milliseconds 100
    }
    
    Write-Host "✓ Downloaded $successCount/$Count images" -ForegroundColor Green
}

# Function to generate synthetic test images
function Generate-TestImages {
    param([int]$Count, [string]$OutputDir)
    
    Write-Host " Generating synthetic test images..." -ForegroundColor Cyan
    
    # Check if ImageMagick is available
    $hasMagick = Get-Command magick -ErrorAction SilentlyContinue
    
    if (-not $hasMagick) {
        Write-Host "    ImageMagick not found. Install it for synthetic image generation." -ForegroundColor Yellow
        Write-Host "  Downloading sample images instead..." -ForegroundColor Yellow
        Download-LoremPicsumImages -Count $Count -OutputDir $OutputDir
        return
    }
    
    $colors = @("red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan")
    $successCount = 0
    
    for ($i = 1; $i -le $Count; $i++) {
        $filename = "synthetic_${i}.jpg"
        $outputPath = Join-Path $OutputDir $filename
        $color = $colors[$i % $colors.Length]
        
        try {
            $text = "Test Image $i`n${color}"
            & magick -size 800x600 xc:$color -pointsize 50 -fill white -gravity center -annotate +0+0 $text $outputPath
            $successCount++
            
            if ($i % 100 -eq 0) {
                Write-Host "  Generated: $i/$Count" -ForegroundColor Yellow
            }
        }
        catch {
            Write-Host "  ✗ Failed to generate image $i" -ForegroundColor Red
        }
    }
    
    Write-Host "✓ Generated $successCount/$Count images" -ForegroundColor Green
}

# Main execution
$startTime = Get-Date

switch ($Source.ToLower()) {
    "unsplash" {
        Download-UnsplashImages -Count $Count -OutputDir $OutputDir -Category $Category
    }
    "picsum" {
        Download-LoremPicsumImages -Count $Count -OutputDir $OutputDir
    }
    "synthetic" {
        Generate-TestImages -Count $Count -OutputDir $OutputDir
    }
    default {
        Write-Host " Unknown source: $Source" -ForegroundColor Red
        Write-Host "Available sources: unsplash, picsum, synthetic" -ForegroundColor Yellow
        exit 1
    }
}

$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
Write-Host " Download complete!" -ForegroundColor Green
Write-Host "Duration: $($duration.TotalSeconds) seconds" -ForegroundColor Cyan
Write-Host "Output directory: $OutputDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Start the Big Data system: docker-compose up -d" -ForegroundColor White
Write-Host "2. Ingest images: npm run ingest $OutputDir" -ForegroundColor White
Write-Host "3. Monitor progress: http://localhost:3001 (Grafana)" -ForegroundColor White
