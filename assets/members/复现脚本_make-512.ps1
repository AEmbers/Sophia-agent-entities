# 生成 512 面板用小图（高质量降采样）
# 用 HighQualityBicubic + 前置预模糊，保证缩小后依旧锐利好看
param(
  [string]$SrcDir,
  [string]$OutDir,
  [int]$Size = 512
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Drawing2D

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$tiers = Get-ChildItem $SrcDir -Directory | Sort-Object Name
$n = 0
foreach ($tier in $tiers) {
  $sub = Join-Path $OutDir $tier.Name
  New-Item -ItemType Directory -Force -Path $sub | Out-Null
  foreach ($f in (Get-ChildItem $tier.FullName -Filter *.png | Sort-Object Name)) {
    $img = New-Object System.Drawing.Bitmap -ArgumentList @($f.FullName)
    $dst = New-Object System.Drawing.Bitmap -ArgumentList @($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $rect = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $Size, $Size)
    $g.DrawImage($img, $rect, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $dst.Save((Join-Path $sub $f.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose(); $img.Dispose()
    $n++
  }
  Write-Output "[$n] $($tier.Name)"
}
Write-Output "done: $n  -> $OutDir (${Size}x${Size})"
