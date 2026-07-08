Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot 'app.ico'
$sizes = @(16,32,48,64,128,256)
$pngs = @()
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Rectangle]::new(0,0,$size,$size)), ([System.Drawing.Color]::FromArgb(255,18,164,139)), ([System.Drawing.Color]::FromArgb(255,47,111,237)), 45
  $radius = [Math]::Max(4, [int]($size * 0.18))
  $rect = [System.Drawing.RectangleF]::new(1,1,$size-2,$size-2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  $path.AddArc($rect.X,$rect.Y,$d,$d,180,90)
  $path.AddArc($rect.Right-$d,$rect.Y,$d,$d,270,90)
  $path.AddArc($rect.Right-$d,$rect.Bottom-$d,$d,$d,0,90)
  $path.AddArc($rect.X,$rect.Bottom-$d,$d,$d,90,90)
  $path.CloseFigure()
  $g.FillPath($bg,$path)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230,255,255,255)), ([Math]::Max(2, $size * 0.07))
  $cx = $size / 2
  $cy = $size / 2
  $barPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245,255,255,255)), ([Math]::Max(2, $size * 0.055))
  for ($i=0; $i -lt 5; $i++) {
    $x = $size * (0.26 + $i * 0.12)
    $h = $size * @(0.22,0.42,0.58,0.38,0.26)[$i]
    $g.DrawLine($barPen, [float]$x, [float]($cy-$h/2), [float]$x, [float]($cy+$h/2))
  }
  $font = New-Object System.Drawing.Font 'Segoe UI', ([Math]::Max(8, $size*0.16)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245,255,255,255))
  if ($size -ge 64) { $g.DrawString('VP', $font, $brush, [float]($size*0.30), [float]($size*0.68)) }
  $png = Join-Path $PSScriptRoot "icon-$size.png"
  $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $pngs += [pscustomobject]@{Size=$size; Path=$png}
}
$fs = [IO.File]::Open($out, [IO.FileMode]::Create)
$bw = New-Object IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngs.Count)
$offset = 6 + ($pngs.Count * 16)
$data = @()
foreach ($item in $pngs) {
  $bytes = [IO.File]::ReadAllBytes($item.Path)
  $data += ,$bytes
  $bw.Write([Byte]($(if ($item.Size -eq 256) {0} else {$item.Size})))
  $bw.Write([Byte]($(if ($item.Size -eq 256) {0} else {$item.Size})))
  $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$bytes.Length); $bw.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($bytes in $data) { $bw.Write($bytes) }
$bw.Close(); $fs.Close()
