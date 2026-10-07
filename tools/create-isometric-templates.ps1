# Gabaritos matematicos da grade do runtime: tile 160x80, sem zoom de camera.
Add-Type -AssemblyName System.Drawing
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'gabaritos\isometrico'))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$originX = 256
$originY = 280
$ink = [System.Drawing.Color]::FromArgb(255, 36, 51, 72)
$ground = [System.Drawing.Color]::FromArgb(255, 21, 115, 207)
$originColour = [System.Drawing.Color]::FromArgb(255, 215, 47, 80)

function Project-Point([double]$tx, [double]$ty, [double]$height = 0) {
    return [System.Drawing.PointF]::new($originX + ($tx - $ty) * 80, $originY + ($tx + $ty) * 40 - $height)
}

function Footprint-Points([int]$nx, [int]$ny, [int]$height = 0) {
    Project-Point 0 0 $height
    Project-Point $nx 0 $height
    Project-Point $nx $ny $height
    Project-Point 0 $ny $height
}

function Draw-Label($graphics, [string]$text, [float]$x, [float]$y, [float]$size = 14, $colour = $ink, [bool]$bold = $false) {
    $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = [System.Drawing.Font]::new('Arial', $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
    $brush = [System.Drawing.SolidBrush]::new($colour)
    $graphics.DrawString($text, $font, $brush, $x, $y)
    $font.Dispose()
    $brush.Dispose()
}

function Draw-Grid($graphics, [int]$nx, [int]$ny, [int]$height, $colour, [float]$thickness, [bool]$dashed = $false) {
    $pen = [System.Drawing.Pen]::new($colour, $thickness)
    if ($dashed) { $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash }
    for ($tx = 0; $tx -le $nx; $tx++) {
        $graphics.DrawLine($pen, (Project-Point $tx 0 $height), (Project-Point $tx $ny $height))
    }
    for ($ty = 0; $ty -le $ny; $ty++) {
        $graphics.DrawLine($pen, (Project-Point 0 $ty $height), (Project-Point $nx $ty $height))
    }
    $pen.Dispose()
}

function Create-Overlay([int]$nx, [int]$ny) {
    $bitmap = [System.Drawing.Bitmap]::new(512, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $bitmap.SetResolution(96, 96)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    [System.Drawing.PointF[]]$points = Footprint-Points $nx $ny
    $verticalPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(95, 82, 104, 126), 1)
    $verticalPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dot
    foreach ($point in $points) {
        $graphics.DrawLine($verticalPen, $point.X, $point.Y, $point.X, $point.Y - 160)
    }
    $verticalPen.Dispose()
    Draw-Grid $graphics $nx $ny 160 ([System.Drawing.Color]::FromArgb(105, 39, 151, 128)) 1.5 $true
    Draw-Grid $graphics $nx $ny 80 ([System.Drawing.Color]::FromArgb(155, 39, 151, 128)) 1.5 $true

    $fill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22, 21, 115, 207))
    $graphics.FillPolygon($fill, $points)
    $fill.Dispose()
    Draw-Grid $graphics $nx $ny 0 $ground 2
    $outline = [System.Drawing.Pen]::new($ground, 3)
    $graphics.DrawPolygon($outline, $points)
    $outline.Dispose()

    $cross = [System.Drawing.Pen]::new($originColour, 2)
    $graphics.DrawLine($cross, $originX - 7, $originY, $originX + 7, $originY)
    $graphics.DrawLine($cross, $originX, $originY - 7, $originX, $originY + 7)
    $graphics.DrawEllipse($cross, $originX - 4, $originY - 4, 8, 8)
    $cross.Dispose()
    Draw-Label $graphics 'O' ($originX + 9) ($originY - 22) 14 $originColour $true

    $center = Project-Point ($nx / 2.0) ($ny / 2.0)
    $centerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 195, 118, 18), 1.5)
    $graphics.DrawLine($centerPen, $center.X - 5, $center.Y, $center.X + 5, $center.Y)
    $graphics.DrawLine($centerPen, $center.X, $center.Y - 5, $center.X, $center.Y + 5)
    $centerPen.Dispose()
    Draw-Label $graphics 'C' ($center.X + 7) ($center.Y - 7) 12

    Draw-Label $graphics '+tx' ($originX + 42) ($originY + 3) 12 $ground
    Draw-Label $graphics '+ty' ($originX - 67) ($originY + 3) 12 $ground
    $ruler = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(190, 82, 104, 126), 1)
    $graphics.DrawLine($ruler, 452, 40, 452, $originY)
    for ($height = 0; $height -le 240; $height += 40) {
        $y = $originY - $height
        $graphics.DrawLine($ruler, 446, $y, 458, $y)
        Draw-Label $graphics "$height" 463 ($y - 7) 12
    }
    $ruler.Dispose()
    Draw-Label $graphics 'ALTURA px' 421 18 11
    Draw-Label $graphics 'H=160' 20 120 11 ([System.Drawing.Color]::FromArgb(255, 39, 151, 128))
    Draw-Label $graphics 'H=80' 20 200 11 ([System.Drawing.Color]::FromArgb(255, 39, 151, 128))
    Draw-Label $graphics 'O = origem do tile | C = centro da pegada' 20 466 12
    Draw-Label $graphics 'Canvas 512x512 | O=(256,280) | escala 1:1' 20 485 12
    $graphics.Dispose()
    return $bitmap
}

$sheet = [System.Drawing.Bitmap]::new(1536, 800, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sheet.SetResolution(96, 96)
$sheetGraphics = [System.Drawing.Graphics]::FromImage($sheet)
$sheetGraphics.Clear([System.Drawing.Color]::FromArgb(255, 245, 248, 252))
$sheetGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
Draw-Label $sheetGraphics 'COFFE MANIA - GABARITO ISOMETRICO' 32 24 28 $ink $true
Draw-Label $sheetGraphics 'Escala nativa dos assets: 1 tile = 160x80 px | +tx=(80,40) | +ty=(-80,40) | inclinacao=26.565 graus' 32 72 16
Draw-Label $sheetGraphics 'Azul: chao. Verde tracejado: planos de referencia de altura. Vermelho: origem. Nao redimensionar ao importar.' 32 99 15

$variants = @(@{Name='1x1'; X=1; Y=1}, @{Name='2x1'; X=2; Y=1}, @{Name='2x2'; X=2; Y=2})
for ($index = 0; $index -lt $variants.Count; $index++) {
    $variant = $variants[$index]
    $width = ($variant.X + $variant.Y) * 80
    $height = ($variant.X + $variant.Y) * 40
    Draw-Label $sheetGraphics "$($variant.Name) | pegada ${width}x${height} px" ($index * 512 + 24) 138 22 $ink $true
    $overlay = Create-Overlay $variant.X $variant.Y
    $overlay.Save((Join-Path $outputDirectory "overlay-$($variant.Name).png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $sheetGraphics.DrawImageUnscaled($overlay, $index * 512, 172)
    $overlay.Dispose()
}
Draw-Label $sheetGraphics 'ALTURA LIVRE: elevar a superficie H pixels significa deslocar a grade para cima em H pixels, sem alterar X.' 32 710 16 $ink $true
Draw-Label $sheetGraphics 'As linhas H=80 e H=160 sao referencias, nao alturas obrigatorias. Use os overlays transparentes como camada no editor.' 32 740 15
Draw-Label $sheetGraphics 'No jogo o PNG usa offsets left/top a partir de O. O zoom da camera nao muda a resolucao de exportacao dos assets.' 32 766 15
$sheet.Save((Join-Path $outputDirectory 'gabarito-isometrico.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sheetGraphics.Dispose()
$sheet.Dispose()
Write-Output "Gabaritos criados em $outputDirectory"
