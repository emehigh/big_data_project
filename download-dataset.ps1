

Write-Host " Opțiuni pentru batch-uri mari de imagini:" -ForegroundColor Cyan
Write-Host ""

Write-Host "1️  DATASET-URI PUBLICE (Manual Download):" -ForegroundColor Yellow
Write-Host "   • Kaggle: https://www.kaggle.com/datasets"
Write-Host "     - Animals: https://www.kaggle.com/datasets/alessiocorrado99/animals10"
Write-Host "     - COCO: https://www.kaggle.com/datasets/awsaf49/coco-2017-dataset"
Write-Host "     - ImageNet subset: https://www.kaggle.com/c/imagenet-object-localization-challenge"
Write-Host ""

Write-Host "2️  UNSPLASH (Gratuit, fără API key):" -ForegroundColor Yellow
Write-Host "   Rulează: .\download-images.ps1 -Count 100"
Write-Host ""

Write-Host "3️  GOOGLE IMAGES (cu script Python):" -ForegroundColor Yellow
Write-Host "   pip install google-images-download"
Write-Host ""

Write-Host "4️  IMAGINI PROPRII:" -ForegroundColor Yellow
Write-Host "   • Smartphone: Copiază toate pozele din telefon"
Write-Host "   • Google Photos: Download bulk"
Write-Host "   • Screenshots: Folder-ul Downloads"
Write-Host ""

Write-Host "5️  GENERARE AUTOMATĂ (pentru testare rapidă):" -ForegroundColor Yellow
Write-Host "   Rulează: .\generate-test-images.ps1 -Count 200"
Write-Host ""

$choice = Read-Host "Alege opțiunea (1-5) sau ENTER pentru a continua"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host " Deschid Kaggle în browser..." -ForegroundColor Cyan
        Start-Process "https://www.kaggle.com/datasets"
        Write-Host "Descarcă un dataset și extrage-l în folderul 'test-images'"
    }
    "2" {
        Write-Host ""
        $count = Read-Host "Câte imagini vrei să descarci? (ex: 100)"
        & "$PSScriptRoot\download-images.ps1" -Count ([int]$count)
    }
    "4" {
        Write-Host ""
        Write-Host " TIP: Poți folosi și imagini din:" -ForegroundColor Yellow
        Write-Host "   $env:USERPROFILE\Pictures"
        Write-Host "   $env:USERPROFILE\Downloads"
        
        # Numără imagini disponibile
        $picturesCount = (Get-ChildItem "$env:USERPROFILE\Pictures" -Recurse -Include *.jpg,*.png,*.jpeg -ErrorAction SilentlyContinue | Measure-Object).Count
        $downloadsCount = (Get-ChildItem "$env:USERPROFILE\Downloads" -Recurse -Include *.jpg,*.png,*.jpeg -ErrorAction SilentlyContinue | Measure-Object).Count
        
        Write-Host ""
        Write-Host " Ai $picturesCount imagini în Pictures" -ForegroundColor Cyan
        Write-Host " Ai $downloadsCount imagini în Downloads" -ForegroundColor Cyan
    }
    "5" {
        Write-Host ""
        if (-not (Test-Path "$PSScriptRoot\generate-test-images.ps1")) {
            Write-Host "  Script-ul generate-test-images.ps1 nu există încă." -ForegroundColor Red
            Write-Host "Rulează mai întâi: .\download-images.ps1" -ForegroundColor Yellow
        }
    }
    default {
        Write-Host ""
        Write-Host "ℹ  Pentru start rapid, rulează:" -ForegroundColor Cyan
        Write-Host ".\download-images.ps1 -Count 50" -ForegroundColor White
    }
}
