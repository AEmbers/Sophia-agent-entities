# 成员素材处理版 · 交付验证脚本 v2
# 退出码 0 = 全部通过；非 0 = 有失败项
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = "C:\Users\Administrator\sophia-work\member-assets"
$fail = 0
function Check($name, $cond, $detail) {
  if ($cond) { Write-Output "PASS  $name  $detail" }
  else { Write-Output "FAIL  $name  $detail"; $script:fail++ }
}

# 只数"梯队目录内"的 PNG，避免把预览图算进来
$tierDirs = @("01_第一梯队_管理与总控组","02_第二梯队_产品分析与设计组","03_第三梯队_架构与研发组","04_第四梯队_测试运维与文档组")
$p2048 = @(); $p512 = @()
foreach ($t in $tierDirs) {
  $p2048 += Get-ChildItem "$root\out-2048\$t" -Filter *.png -ErrorAction SilentlyContinue
  $p512  += Get-ChildItem "$root\out-512\$t"  -Filter *.png -ErrorAction SilentlyContinue
}
Check "2048 数量=20" ($p2048.Count -eq 20) "实际 $($p2048.Count)"
Check "512 数量=20"  ($p512.Count  -eq 20) "实际 $($p512.Count)"

# --- 尺寸与通道 ---
$bad2048 = 0; $badCorner = 0; $bad512 = 0
foreach ($f in $p2048) {
  $im = New-Object System.Drawing.Bitmap -ArgumentList @($f.FullName)
  if ($im.Width -ne 2048 -or $im.Height -ne 2048 -or $im.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format32bppArgb) { $bad2048++ }
  $a1=$im.GetPixel(2,2).A; $a2=$im.GetPixel(2045,2).A; $a3=$im.GetPixel(2,2045).A; $a4=$im.GetPixel(2045,2045).A
  $ac=$im.GetPixel(1024,1024).A
  if ($a1 -ne 0 -or $a2 -ne 0 -or $a3 -ne 0 -or $a4 -ne 0 -or $ac -ne 255) { $badCorner++ }
  $im.Dispose()
}
Check "2048 尺寸/格式全部正确" ($bad2048 -eq 0) "异常 $bad2048"
Check "2048 四角透明+中心不透明" ($badCorner -eq 0) "异常 $badCorner"

foreach ($f in $p512) {
  $im = New-Object System.Drawing.Bitmap -ArgumentList @($f.FullName)
  if ($im.Width -ne 512 -or $im.Height -ne 512 -or $im.PixelFormat -ne [System.Drawing.Imaging.PixelFormat]::Format32bppArgb) { $bad512++ }
  $im.Dispose()
}
Check "512 尺寸/格式全部正确" ($bad512 -eq 0) "异常 $bad512"

# --- 结构完整 ---
$expect = @{
  "01_第一梯队_管理与总控组" = @("钦天监监正","灵台主事","时宪主事","典籍掌事","星禁掌察")
  "02_第二梯队_产品分析与设计组" = @("观象访事","星图主事","象绘主事","星绘主事","传报主事")
  "03_第三梯队_架构与研发组" = @("灵台郎","历算主事","星仪主事","数象主事","推步主事")
  "04_第四梯队_测试运维与文档组" = @("星验主事","星机校验","天象值守","星文审校","录典主事")
}
$nameOk = $true; $miss = @()
foreach ($tier in $expect.Keys) {
  foreach ($n in $expect[$tier]) {
    if (-not (Test-Path "$root\out-2048\$tier\$n.png")) { $nameOk = $false; $miss += "$tier\$n.png" }
    if (-not (Test-Path "$root\out-512\$tier\$n.png"))  { $nameOk = $false; $miss += "512:$tier\$n" }
  }
}
Check "20 个职位名与梯队结构完整" $nameOk "缺失: $($miss -join ', ')"

# --- 水印已清除：检查"豆包"笔画位置在成品里是否已透明 ---
# 位置来自对原始 20 张做 max 投影后目测标定的水印笔画网格（原图坐标系）
$wmPts = @()
foreach ($x in @(1900,1930,1960,1985,2010,2030)) { foreach ($y in @(1930,1955,1980,2005)) { $wmPts += ,@($x,$y) } }
$trans = 0; $opaqueList = @()
foreach ($tier in $tierDirs) {
  foreach ($f in (Get-ChildItem "$root\out-2048\$tier" -Filter *.png)) {
    $im = New-Object System.Drawing.Bitmap -ArgumentList @($f.FullName)
    foreach ($pt in $wmPts) {
      if ($pt[0] -lt 2048 -and $pt[1] -lt 2048) {
        if ($im.GetPixel($pt[0],$pt[1]).A -eq 0) { $trans++ } else { $opaqueList += "$($f.BaseName)($($pt[0]),$($pt[1]))" }
      }
    }
    $im.Dispose()
  }
}
$totalPts = $wmPts.Count * 20
$pct = [math]::Round(100.0*$trans/$totalPts,1)
Check "水印笔画位置已透明(>=92%)" ($pct -ge 92.0) "实测 $pct% ($trans/$totalPts)；未透明示例: $(($opaqueList | Select-Object -First 4) -join ', ')"

Write-Output ""
if ($fail -eq 0) { Write-Output "===== 全部通过 ====="; exit 0 }
else { Write-Output "===== 有 $fail 项失败 ====="; exit 1 }
