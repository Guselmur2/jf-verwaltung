# Holt eine Datensicherung vom Raspberry Pi und legt sie hier auf dem Rechner ab.
#
#   Erster Start:  richtet sich selbst ein (fragt nach Passwort und Zielordner)
#   Danach:        ein Doppelklick auf "Sicherung holen.cmd" genuegt
#
# API-Schluessel und Sicherungspasswort werden mit der Windows-Datenschutz-
# funktion (DPAPI) verschluesselt abgelegt. Sie lassen sich nur von diesem
# Benutzerkonto auf diesem Rechner wieder lesen — im Klartext steht nichts
# in der Konfigurationsdatei.

[CmdletBinding()]
param(
    [switch] $Einrichten,
    [string] $Rechner,
    [string] $ApiKey,
    [string] $Passwort,
    [string] $Ziel,
    [int]    $Behalten = 0,
    [string] $Konfig,
    [switch] $Still          # keine Rueckfragen (fuer die Aufgabenplanung)
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Konfig) {
    $Konfig = Join-Path $env:LOCALAPPDATA 'jf-spintverwaltung\sicherung.json'
}

# ---------------------------------------------------------------- Hilfsmittel

function Schreibe($Text, $Farbe = 'Gray') { Write-Host $Text -ForegroundColor $Farbe }

function Schuetze([string] $Klartext) {
    # DPAPI: nur dieses Benutzerkonto auf diesem Rechner kann das zurueckholen.
    ConvertFrom-SecureString (ConvertTo-SecureString $Klartext -AsPlainText -Force)
}

function Entsperre([string] $Geschuetzt) {
    $sicher = ConvertTo-SecureString $Geschuetzt
    $zeiger = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher)
    try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($zeiger) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($zeiger) }
}

function FrageStill([string] $Frage, [string] $Vorgabe) {
    if ($Still) { return $Vorgabe }
    $eingabe = Read-Host "$Frage$(if ($Vorgabe) { " [$Vorgabe]" })"
    if ([string]::IsNullOrWhiteSpace($eingabe)) { return $Vorgabe }
    return $eingabe.Trim()
}

# Das Zertifikat des Pi ist selbstsigniert. Statt die Pruefung ganz abzuschalten
# wird der Fingerabdruck festgehalten und bei jedem Lauf verglichen — faellt er
# anders aus, bricht das Skript ab.
#
# Die Pruefung muss eine kompilierte Klasse sein: Windows PowerShell ruft sie in
# einem Thread ohne Runspace auf, dort laesst sich kein Skriptblock ausfuehren.
if (-not ([Management.Automation.PSTypeName]'PiZertifikat').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

public static class PiZertifikat
{
    public static string Erwartet = null;
    public static string Gesehen  = null;

    public static bool Pruefe(object absender, X509Certificate zertifikat,
                              X509Chain kette, SslPolicyErrors fehler)
    {
        if (zertifikat == null) return false;
        Gesehen = zertifikat.GetCertHashString();
        if (string.IsNullOrEmpty(Erwartet)) return true;          // Einrichtung
        return string.Equals(Gesehen, Erwartet, StringComparison.OrdinalIgnoreCase);
    }

    public static void Aktivieren(string erwartet)
    {
        Erwartet = erwartet;
        Gesehen  = null;
        ServicePointManager.ServerCertificateValidationCallback = Pruefe;
    }
}
'@
}

function SetzeZertifikatspruefung([string] $Erwartet) {
    [PiZertifikat]::Aktivieren($Erwartet)
}

function GesehenerFingerabdruck { [PiZertifikat]::Gesehen }

# ---------------------------------------------------------------- Einrichtung

function LiesSchluesselAusProjekt {
    # Wenn api.txt neben dem Skript liegt, den Lese-Schluessel daraus nehmen.
    $datei = Join-Path (Split-Path -Parent $PSScriptRoot) 'api.txt'
    if (-not (Test-Path $datei)) { return $null }
    foreach ($zeile in Get-Content $datei) {
        if ($zeile -match '^\s*read\s*:\s*(jfw_\S+)') { return $Matches[1] }
    }
    return $null
}

function Einrichtung {
    Schreibe ''
    Schreibe '  Einrichtung der Datensicherung' 'Cyan'
    Schreibe '  ------------------------------' 'Cyan'
    Schreibe ''

    $host_ = if ($Rechner) { $Rechner } else { FrageStill '  Adresse des Pi' 'jfwpi.fritz.box' }

    $key = $ApiKey
    if (-not $key) { $key = LiesSchluesselAusProjekt }
    if ($key) {
        Schreibe "  API-Schluessel aus api.txt uebernommen (endet auf ...$($key.Substring($key.Length-6)))" 'DarkGray'
    } else {
        $key = FrageStill '  API-Schluessel (jfw_...)' ''
    }
    if (-not $key) { throw 'Ohne API-Schluessel geht es nicht.' }

    $pw = $Passwort
    if (-not $pw) {
        Schreibe ''
        Schreibe '  Die Sicherung wird verschluesselt. Das Passwort waehlst du hier —' 'Yellow'
        Schreibe '  ohne dieses Passwort ist die Sicherung spaeter nicht zu oeffnen.' 'Yellow'
        Schreibe '  Bitte aufschreiben und getrennt von den Sicherungen aufbewahren.' 'Yellow'
        Schreibe ''
        $a = Read-Host '  Passwort fuer die Sicherung (mind. 8 Zeichen)' -AsSecureString
        $b = Read-Host '  Passwort wiederholen' -AsSecureString
        $pw  = Entsperre (ConvertFrom-SecureString $a)
        $pw2 = Entsperre (ConvertFrom-SecureString $b)
        if ($pw -ne $pw2) { throw 'Die beiden Passwoerter stimmen nicht ueberein.' }
    }
    if ($pw.Length -lt 8) { throw 'Das Passwort muss mindestens 8 Zeichen lang sein.' }

    $ordner = if ($Ziel) { $Ziel } else {
        FrageStill '  Wohin sollen die Sicherungen' (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Jugendfeuerwehr-Sicherungen')
    }
    $anzahl = if ($Behalten -gt 0) { $Behalten } else { [int](FrageStill '  Wie viele Sicherungen aufheben' '14') }

    # Fingerabdruck des Zertifikats einmal abholen.
    SetzeZertifikatspruefung $null
    try {
        Invoke-WebRequest -Uri "https://$host_/api/v1/status" -Headers @{ 'X-API-Key' = $key } -UseBasicParsing -TimeoutSec 20 | Out-Null
    } catch {
        throw "Der Pi ist nicht erreichbar oder der Schluessel stimmt nicht: $($_.Exception.Message)"
    }
    $fingerabdruck = GesehenerFingerabdruck

    $daten = [ordered]@{
        rechner        = $host_
        apiKey         = Schuetze $key
        passwort       = Schuetze $pw
        ziel           = $ordner
        behalten       = $anzahl
        fingerabdruck  = $fingerabdruck
        eingerichtet   = (Get-Date).ToString('s')
    }

    $verzeichnis = Split-Path -Parent $Konfig
    if (-not (Test-Path $verzeichnis)) { New-Item -ItemType Directory -Path $verzeichnis -Force | Out-Null }
    $daten | ConvertTo-Json | Set-Content -Path $Konfig -Encoding UTF8

    Schreibe ''
    Schreibe "  Gespeichert unter $Konfig" 'Green'
    Schreibe "  Zertifikat des Pi festgehalten: $fingerabdruck" 'DarkGray'
    Schreibe ''
    return $daten
}

# ------------------------------------------------------------------- Ablauf

if ($Einrichten -or -not (Test-Path $Konfig)) {
    $einst = Einrichtung
} else {
    $einst = Get-Content $Konfig -Raw | ConvertFrom-Json
}

$key = Entsperre $einst.apiKey
$pw  = Entsperre $einst.passwort
SetzeZertifikatspruefung $einst.fingerabdruck

if (-not (Test-Path $einst.ziel)) { New-Item -ItemType Directory -Path $einst.ziel -Force | Out-Null }

$stempel = Get-Date -Format 'yyyy-MM-dd-HHmm'
$zieldatei = Join-Path $einst.ziel "spinte-$stempel.db.enc"

Schreibe ''
Schreibe "  Hole Sicherung von $($einst.rechner) ..." 'Cyan'

try {
    Invoke-WebRequest -Uri "https://$($einst.rechner)/api/v1/sicherung" `
        -Headers @{ 'X-API-Key' = $key; 'X-Sicherung-Passwort' = $pw } `
        -OutFile $zieldatei -UseBasicParsing -TimeoutSec 120
} catch {
    if ((GesehenerFingerabdruck) -and (GesehenerFingerabdruck) -ne $einst.fingerabdruck) {
        Schreibe ''
        Schreibe '  ABBRUCH: Das Zertifikat des Pi hat sich geaendert.' 'Red'
        Schreibe "  erwartet: $($einst.fingerabdruck)" 'Red'
        Schreibe "  erhalten: $(GesehenerFingerabdruck)" 'Red'
        Schreibe '  Wenn das Zertifikat absichtlich neu erstellt wurde, einmal mit' 'Yellow'
        Schreibe '  -Einrichten starten. Sonst pruefen, ob wirklich der Pi antwortet.' 'Yellow'
        exit 2
    }
    Schreibe ''
    Schreibe "  FEHLER: $($_.Exception.Message)" 'Red'
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Schreibe '  Der API-Schluessel wurde offenbar gesperrt oder geloescht.' 'Yellow'
    }
    if (Test-Path $zieldatei) { Remove-Item $zieldatei -Force }
    exit 1
}

# Nur eine Datei behalten, die auch wirklich eine verschluesselte Sicherung ist.
$kopf = [System.IO.File]::ReadAllBytes($zieldatei)[0..7]
$kennung = -join ($kopf | ForEach-Object { [char]$_ })
if ($kennung -ne 'Salted__') {
    Schreibe '  FEHLER: Die Antwort ist keine verschluesselte Sicherung.' 'Red'
    Remove-Item $zieldatei -Force
    exit 1
}

$groesse = (Get-Item $zieldatei).Length
Schreibe "  Gespeichert: $zieldatei" 'Green'
Schreibe ("  Groesse: {0:N0} kB, verschluesselt" -f ($groesse / 1kb)) 'Gray'

# Alte Sicherungen aufraeumen.
$alle = Get-ChildItem -Path $einst.ziel -Filter 'spinte-*.db.enc' | Sort-Object Name -Descending
if ($einst.behalten -gt 0 -and $alle.Count -gt $einst.behalten) {
    $weg = $alle | Select-Object -Skip $einst.behalten
    foreach ($d in $weg) { Remove-Item $d.FullName -Force }
    Schreibe "  $($weg.Count) aeltere Sicherung(en) entfernt, $($einst.behalten) bleiben liegen." 'DarkGray'
}

Schreibe ''
Schreibe '  Fertig.' 'Green'
Schreibe ''
Schreibe '  Zum Oeffnen spaeter:' 'DarkGray'
Schreibe "  openssl enc -d -aes-256-cbc -pbkdf2 -in `"$(Split-Path -Leaf $zieldatei)`" -out spinte.db" 'DarkGray'
Schreibe ''
