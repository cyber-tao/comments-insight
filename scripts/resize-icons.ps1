param(
    [string]$RelativeSource = "..\public\icons\icon-source.png",
    [int[]]$Sizes = @(16, 48, 128)
)

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Resolve-Path (Join-Path $scriptDir $RelativeSource)
$iconsDir = Split-Path $sourcePath

if (-not (Test-Path $sourcePath)) {
    throw "Source image not found: $sourcePath"
}

$baseImage = [System.Drawing.Image]::FromFile($sourcePath)

try {
    foreach ($size in $Sizes) {
        $outputPath = Join-Path $iconsDir ("icon-{0}.png" -f $size)
        $bitmap = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

        $graphics.DrawImage($baseImage, 0, 0, $size, $size)
        $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

        $graphics.Dispose()
        $bitmap.Dispose()

        Write-Output "Saved $outputPath"
    }
}
finally {
    $baseImage.Dispose()
}
