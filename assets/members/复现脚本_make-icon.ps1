# 成员素材后处理（高性能版）
#  ① 统一 squircle 蒙版 -> 圆角外透明（顺带消掉落在白区的水印）
#  ② 压在画面内的水印：邻域修复（median-ish，沿水平方向取最近的非水印像素）
#  ③ 输出带 alpha 的 2048 PNG
param(
  [string]$Src,
  [string]$Out,
  [switch]$FixWatermark
)
Add-Type -AssemblyName System.Drawing

# 蒙版窗口：水平边距 27（= 原图实测最小白边，不露白）
#           垂直方向下移，给底部职位标签留呼吸空间
#           实测标签最下沿 y=2014；原图上边距最小 20
#           取 x 27..2020 / y 36..2029  => 1994 x 1994
$WIN_X0 = 27
$WIN_Y0 = 36
$WIN_SZ = 1994
$RADIUS = 370

$srcImg = New-Object System.Drawing.Bitmap -ArgumentList @($Src)
$W = $srcImg.Width
$H = $srcImg.Height

# ---------- 读入像素到 int[] (BGRA) ----------
$rect = New-Object System.Drawing.Rectangle -ArgumentList @(0, 0, $W, $H)
$srcData = $srcImg.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $srcData.Stride
$bytes = New-Object 'byte[]' ($stride * $H)
[System.Runtime.InteropServices.Marshal]::Copy($srcData.Scan0, $bytes, 0, $bytes.Length)
$srcImg.UnlockBits($srcData)

# ---------- ② 可选：右下角水印邻域修复 ----------
# 水印区域（按实测/目测标定）：x 1855..2040, y 1900..2040
# 只修“压在有内容画面上的”水印像素：判据 = 该像素在其局部明显偏亮(被抬白)
if ($FixWatermark) {
  $wx0 = 1850; $wx1 = 2045; $wy0 = 1895; $wy1 = 2045
  # 先对这个小区域做水平中值修复：对每个像素，取左右各 6px 处像素的中值
  $region = @{}
  for ($y = $wy0; $y -le $wy1; $y++) {
    for ($x = $wx0; $x -le $wx1; $x++) {
      $region["$x,$y"] = $true
    }
  }
  # 判断是否“被水印抬亮”：与左右 8px 邻居比较亮度
  for ($y = $wy0; $y -le $wy1; $y++) {
    for ($x = $wx0; $x -le $wx1; $x++) {
      $i  = $y * $stride + $x * 4
      $b0 = $bytes[$i]; $g0 = $bytes[$i+1]; $r0 = $bytes[$i+2]
      $l0 = 0.299*$r0 + 0.587*$g0 + 0.114*$b0

      # 取左右远处参考像素（跳过水印笔画宽度 ~14px）
      $ix1 = $x - 14; $ix2 = $x + 14
      if ($ix1 -lt 0 -or $ix2 -ge $W) { continue }
      $j1 = $y * $stride + $ix1 * 4
      $j2 = $y * $stride + $ix2 * 4
      $l1 = 0.299*$bytes[$j1+2] + 0.587*$bytes[$j1+1] + 0.114*$bytes[$j1]
      $l2 = 0.299*$bytes[$j2+2] + 0.587*$bytes[$j2+1] + 0.114*$bytes[$j2]
      $ref = ($l1 + $l2) / 2.0

      # 若自身比两侧明显亮 => 疑似水印笔画
      if ($l0 - $ref -gt 22) {
        # 用左右参考像素的平均值替换（保持原 alpha）
        $a0 = $bytes[$i+3]
        $bytes[$i]   = [byte](($bytes[$j1]   + $bytes[$j2])   / 2)
        $bytes[$i+1] = [byte](($bytes[$j1+1] + $bytes[$j2+1]) / 2)
        $bytes[$i+2] = [byte](($bytes[$j1+2] + $bytes[$j2+2]) / 2)
      }
    }
  }
}

# ---------- ① 统一 squircle 蒙版 ----------
$outBmp = New-Object System.Drawing.Bitmap -ArgumentList @($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$outData = $outBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$outStride = $outData.Stride
$outBytes = New-Object 'byte[]' ($outStride * $H)

$innerX0 = $WIN_X0; $innerX1 = $WIN_X0 + $WIN_SZ - 1
$innerY0 = $WIN_Y0; $innerY1 = $WIN_Y0 + $WIN_SZ - 1
$size = $WIN_SZ
$cx = ($innerX0 + $innerX1) / 2.0
$cy = ($innerY0 + $innerY1) / 2.0
$a  = $size / 2.0
$r  = [math]::Min($RADIUS, $a)
$half = $a - $r

for ($y = 0; $y -lt $H; $y++) {
  for ($x = 0; $x -lt $W; $x++) {
    $o = $y * $outStride + $x * 4
    $alpha = 0.0
    $ax = [math]::Abs($x - $cx)
    $ay = [math]::Abs($y - $cy)
    if ($ax -le $a -and $ay -le $a) {
      if ($ax -le $half -or $ay -le $half) { $alpha = 1.0 }
      else {
        $qx = $ax - $half; $qy = $ay - $half
        $d = [math]::Sqrt($qx*$qx + $qy*$qy)
        if ($d -le $r) {
          $edge = $r - $d
          if ($edge -gt 1.5) { $alpha = 1.0 } else { $alpha = [math]::Max(0.0, $edge / 1.5) }
        }
      }
    }
    if ($alpha -le 0) {
      $outBytes[$o] = 0; $outBytes[$o+1] = 0; $outBytes[$o+2] = 0; $outBytes[$o+3] = 0
    } else {
      $s = $y * $stride + $x * 4
      $outBytes[$o]   = $bytes[$s]
      $outBytes[$o+1] = $bytes[$s+1]
      $outBytes[$o+2] = $bytes[$s+2]
      $outBytes[$o+3] = [byte][math]::Round($alpha * 255)
    }
  }
}
[System.Runtime.InteropServices.Marshal]::Copy($outBytes, 0, $outData.Scan0, $outBytes.Length)
$outBmp.UnlockBits($outData)
$outBmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$outBmp.Dispose()
$srcImg.Dispose()
Write-Output "OK: $Out"
