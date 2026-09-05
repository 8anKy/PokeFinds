# Skapar upload-keystoren for Google Play + android/keystore.properties.
# Kors EN gang av agaren, i en EGEN PowerShell (inte via en agent - losenordet
# skrivs in interaktivt och hamnar aldrig i nagon kommandorad eller logg).
#
#   powershell -ExecutionPolicy Bypass -File scripts\android-keystore-setup.ps1
#
# Resultat:
#   %USERPROFILE%\foilio-upload.jks      (SAKERHETSKOPIERA - utanfor repot)
#   android\keystore.properties          (gitignorad; build.gradle laser den)
#
# Play App Signing haller den riktiga app-signeringsnyckeln, sa en forlorad
# upload-nyckel gar att byta hos Google - men det tar dagar. Spara kopian.
#
# OBS: filen ar avsiktligt ren ASCII (inga a/o med prickar, inga tankstreck) -
# Windows PowerShell 5.1 laser .ps1 utan BOM som ANSI och parsern gick sonder
# pa UTF-8-tecknen forsta gangen (2026-09-05).

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$keytool = "D:\Emulator\jbr\bin\keytool.exe"
if (-not (Test-Path $keytool)) {
  $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
}
if (-not (Test-Path $keytool)) { throw "Hittar inte keytool.exe - satt JAVA_HOME till en JDK 21." }

$storeFile = Join-Path $env:USERPROFILE "foilio-upload.jks"
$propsFile = Join-Path $repo "android\keystore.properties"
$alias = "foilio"

function Read-Plain([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

if (Test-Path $storeFile) {
  Write-Host "Keystoren finns redan: $storeFile" -ForegroundColor Yellow
  $answer = Read-Host "Skriva om android\keystore.properties med dess losenord? (J/N)"
  if ($answer -notmatch '^[JjYy]') { exit 1 }
  $s1 = Read-Plain "Keystorens losenord"
} else {
  $s1 = Read-Plain "Valj losenord for keystoren (minst 8 tecken)"
  $s2 = Read-Plain "Upprepa losenordet"
  if ($s1 -ne $s2) { throw "Losenorden skiljer sig." }
  if ($s1.Length -lt 8) { throw "Minst 8 tecken." }
  # Gradle laser keystore.properties som ISO-8859-1 via java.util.Properties, och
  # backslash/mellanslag/likhetstecken har egen betydelse dar -> tillat bara enkla
  # ASCII-tecken sa att losenordet som skrivs ar exakt det som lases.
  if ($s1 -match '[^A-Za-z0-9!@#$%^&*()_+\-.,;?~]') {
    throw "Anvand bara A-Z, a-z, siffror och !@#$%^&*()_+-.,;?~ (inga a/o med prickar, mellanslag, = eller backslash)."
  }

  # Samma losenord for store och key (PKCS12 kraver det i praktiken).
  # -dname slipper de interaktiva namnfragorna; vardena syns bara i certifikatet.
  & $keytool -genkeypair -v `
    -keystore $storeFile -storetype PKCS12 `
    -alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $s1 -keypass $s1 `
    -dname "CN=Foilio, O=Foilio, L=Stockholm, C=SE"
  if ($LASTEXITCODE -ne 0) { throw "keytool misslyckades ($LASTEXITCODE)." }
  $s2 = $null
}

$storeFileFwd = $storeFile -replace '\\', '/'
$lines = @(
  "storeFile=$storeFileFwd"
  "storePassword=$s1"
  "keyAlias=$alias"
  "keyPassword=$s1"
)
[IO.File]::WriteAllLines($propsFile, $lines, (New-Object System.Text.ASCIIEncoding))

Write-Host ""
Write-Host "Klart." -ForegroundColor Green
Write-Host "  Keystore : $storeFile"
Write-Host "  Gradle   : $propsFile"
Write-Host ""
Write-Host "Upload-nyckelns SHA-1 (behovs INTE for Google-inloggning - dar anvands Play App Signing-nyckelns SHA-1 fran Play Console > App integrity):"
& $keytool -list -v -keystore $storeFile -alias $alias -storepass $s1 2>$null | Select-String "SHA1"
$s1 = $null
Write-Host ""
Write-Host "Nasta steg - bygg AAB:en:"
Write-Host '  $env:JAVA_HOME = "D:\Emulator\jbr"; cd android; .\gradlew bundleRelease'
