# Skapar upload-keystoren för Google Play + android/keystore.properties.
# Körs EN gång av ägaren, i en EGEN PowerShell (inte via en agent — lösenordet
# skrivs in interaktivt och hamnar aldrig i någon kommandorad eller logg).
#
#   powershell -ExecutionPolicy Bypass -File scripts\android-keystore-setup.ps1
#
# Resultat:
#   %USERPROFILE%\foilio-upload.jks      (SÄKERHETSKOPIERA — utanför repot)
#   android\keystore.properties          (gitignorad; build.gradle läser den)
#
# Play App Signing håller den riktiga app-signeringsnyckeln, så en förlorad
# upload-nyckel går att byta hos Google — men det tar dagar. Spara kopian.

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$keytool = "D:\Emulator\jbr\bin\keytool.exe"
if (-not (Test-Path $keytool)) {
  $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe"
}
if (-not (Test-Path $keytool)) { throw "Hittar inte keytool.exe — sätt JAVA_HOME till en JDK 21." }

$storeFile = Join-Path $env:USERPROFILE "foilio-upload.jks"
$propsFile = Join-Path $repo "android\keystore.properties"
$alias = "foilio"

if (Test-Path $storeFile) {
  Write-Host "Keystoren finns redan: $storeFile" -ForegroundColor Yellow
  Write-Host "Vill du bara skriva om android\keystore.properties svarar du J."
  if ((Read-Host "Fortsätt utan att skapa ny keystore? (J/N)") -notmatch '^[JjYy]') { exit 1 }
} else {
  $p1 = Read-Host "Välj lösenord för keystoren (minst 8 tecken)" -AsSecureString
  $p2 = Read-Host "Upprepa lösenordet" -AsSecureString
  $s1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
  $s2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
  if ($s1 -ne $s2) { throw "Lösenorden skiljer sig." }
  if ($s1.Length -lt 8) { throw "Minst 8 tecken." }
  # Gradle läser keystore.properties som ISO-8859-1 via java.util.Properties, och
  # backslash/mellanslag/likhetstecken har egen betydelse där → tillåt bara enkla
  # ASCII-tecken så att lösenordet som skrivs är exakt det som läses.
  if ($s1 -match '[^A-Za-z0-9!@#$%^&*()_+\-.,;?~]') {
    throw "Använd bara bokstäver A–Z, siffror och !@#$%^&*()_+-.,;?~ (inga å/ä/ö, mellanslag, = eller \)."
  }

  # Samma lösenord för store och key (PKCS12 kräver det i praktiken).
  # -dname slipper de interaktiva namnfrågorna; värdena syns bara i certifikatet.
  & $keytool -genkeypair -v `
    -keystore $storeFile -storetype PKCS12 `
    -alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $s1 -keypass $s1 `
    -dname "CN=Foilio, O=Foilio, L=Stockholm, C=SE"
  if ($LASTEXITCODE -ne 0) { throw "keytool misslyckades ($LASTEXITCODE)." }

  $storeFileFwd = $storeFile -replace '\\', '/'
  @(
    "storeFile=$storeFileFwd"
    "storePassword=$s1"
    "keyAlias=$alias"
    "keyPassword=$s1"
  ) | Set-Content -Path $propsFile -Encoding ascii
  $s1 = $null; $s2 = $null
}

Write-Host ""
Write-Host "Klart." -ForegroundColor Green
Write-Host "  Keystore : $storeFile"
Write-Host "  Gradle   : $propsFile"
Write-Host ""
Write-Host "Upload-nyckelns SHA-1 (behövs INTE för Google-inloggning — Play App Signing-nyckelns SHA-1 tas ur Play Console → App integrity):"
& $keytool -list -v -keystore $storeFile -alias $alias -storepass (Get-Content $propsFile | Where-Object { $_ -like 'storePassword=*' } | ForEach-Object { $_.Substring(14) }) 2>$null | Select-String "SHA1"
Write-Host ""
Write-Host "Nästa steg: bygg AAB:en —  `$env:JAVA_HOME='D:\Emulator\jbr'; cd android; .\gradlew bundleRelease"
