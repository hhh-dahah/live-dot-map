# generate-app-icon.ps1 — 从品牌 PNG 生成多尺寸 Windows .ico
#
# 用法（本机 Windows PowerShell 5.1，System.Drawing 由 .NET Framework 提供）：
#   powershell -ExecutionPolicy Bypass -File scripts\generate-app-icon.ps1
#
# 输入：icons/icon-512.png（品牌图标，深色底 + 节点连线）
# 输出：assets/app-icon.ico（16/24/32/48/64/128/256 多尺寸，PNG 条目）
#       favicon.ico（同内容，供 web/PWA 与快捷方式使用）
#
# 后续正式 logo 更新时，替换 icons/icon-512.png 后重跑本脚本即可。

param(
    [string]$Source = "icons/icon-512.png",
    [string]$OutIco = "assets/app-icon.ico",
    [string]$OutFavicon = "favicon.ico"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root $Source
$sizes = @(16, 24, 32, 48, 64, 128, 256)

$sourceBitmap = [System.Drawing.Bitmap]::FromFile((Resolve-Path $sourcePath))
try {
    $pngs = @{}
    foreach ($s in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap($s, $s)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($sourceBitmap, 0, 0, $s, $s)
        } finally {
            $g.Dispose()
        }
        $ms = New-Object System.IO.MemoryStream
        try {
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngs[$s] = $ms.ToArray()
        } finally {
            $ms.Dispose()
        }
        $bmp.Dispose()
    }

    # 手工拼装 ICO 容器：ICONDIR + ICONDIRENTRY * N + PNG 数据
    $count = $sizes.Count
    $headerSize = 6 + 16 * $count
    $ico = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ico)
    try {
        $bw.Write([uint16]0)          # reserved
        $bw.Write([uint16]1)          # type: icon
        $bw.Write([uint16]$count)
        $offset = $headerSize
        foreach ($s in $sizes) {
            $data = $pngs[$s]
            $dim = if ($s -eq 256) { 0 } else { $s }
            $bw.Write([byte]$dim)     # width (0 = 256)
            $bw.Write([byte]$dim)     # height (0 = 256)
            $bw.Write([byte]0)        # color count
            $bw.Write([byte]0)        # reserved
            $bw.Write([uint16]1)      # planes
            $bw.Write([uint16]32)     # bit count
            $bw.Write([uint32]$data.Length)
            $bw.Write([uint32]$offset)
            $offset += $data.Length
        }
        foreach ($s in $sizes) { $bw.Write($pngs[$s]) }
        $bw.Flush()
    } finally {
        $bw.Dispose()
    }
    $bytes = $ico.ToArray()
    $ico.Dispose()

    foreach ($out in @($OutIco, $OutFavicon)) {
        $outPath = Join-Path $root $out
        $dir = Split-Path -Parent $outPath
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllBytes($outPath, $bytes)
        Write-Output ("wrote {0} ({1} bytes, {2} entries)" -f $outPath, $bytes.Length, $count)
    }
} finally {
    $sourceBitmap.Dispose()
}
