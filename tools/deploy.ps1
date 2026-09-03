<#
deploy.ps1 - ship this working tree to the VPS and activate it.
PowerShell twin of tools/deploy.sh; runs on Windows 10/11 without Git Bash.
Kept ASCII-only on purpose: PowerShell 5.1 reads a BOM-less .ps1 as ANSI and
UTF-8 em-dashes or curly quotes come back as stray quote characters that
break the parser.

Usage:
    .\tools\deploy.ps1                    # normal deploy
    .\tools\deploy.ps1 -WithUploads       # force re-sending public/uploads (142 MB)
    .\tools\deploy.ps1 -SkipTests         # emergency only; the box normally runs the suite
    .\tools\deploy.ps1 -DryRun            # pack locally and print what would run, no upload

Talks to the host through the `remvps` alias in ~/.ssh/config; override with
the REMASSIST_HOST environment variable.

Why the build runs on the server: `sharp` is a native module, so a
Windows-built standalone bundle carries win32 binaries and next/image dies on
Linux. Packing here, building there - see deploy/README.md.

Differences from deploy.sh that matter on Windows:
  * Archive is built with Windows bsdtar (tar.exe). It bundles gzip, so no
    external gzip is needed, and it takes native C:\ paths (GNU tar from Git
    misreads the drive colon as a remote host and fails).
  * $ErrorActionPreference stays at Continue: in Windows PowerShell 5.1 a
    native command writing to stderr becomes a terminating error under 'Stop',
    which would kill the deploy on the first npm deprecation warning. Every
    step checks $LASTEXITCODE itself instead.
#>
[CmdletBinding()]
param(
    [switch]$WithUploads,
    [switch]$SkipTests,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

$hostName = if ($env:REMASSIST_HOST) { $env:REMASSIST_HOST } else { 'remvps' }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

# --- tools --------------------------------------------------------------
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$scp = (Get-Command scp.exe -ErrorAction Stop).Source
$tar = (Get-Command tar.exe -ErrorAction Stop).Source

function Write-Log([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Dirty([string]$msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

# The bash script ships the working tree, not a commit, but says so first -
# "why is my fix not live" usually ends here.
$dirty = git status --porcelain
if ($dirty) { Write-Dirty 'working tree is dirty; deploying it as-is' }
$head = git rev-parse --short HEAD 2>$null
if (-not $head) { $head = '(no git)' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$name = "remassist-src-$stamp.tgz"
$tarball = Join-Path $env:TEMP $name
$remoteScript = "remote-deploy-$stamp.sh"

Write-Log "Deploying $head to $hostName as $stamp"

# --- first deploy? then the video has to go up whatever the flags say -----
$sendUploads = [bool]$WithUploads
if (-not $sendUploads) {
    & $ssh -o BatchMode=yes $hostName 'test -n "$(ls -A /srv/remassist/shared/uploads 2>/dev/null)"'
    if ($LASTEXITCODE -ne 0) {
        Write-Dirty "shared/uploads is empty on $hostName - including public/uploads this time"
        $sendUploads = $true
    }
}

# --- pack ----------------------------------------------------------------
$excludes = @(
    './node_modules'
    './.next'
    './.next-dev*'
    './.git'
    './.playwright-mcp'
    './.claude'
    './dev.log'
    './.env'
    './.env.local'
    './.env.production'
    './.env.vercel'
    '*.tsbuildinfo'
)
if (-not $sendUploads) { $excludes += './public/uploads' }
$excludeArgs = $excludes | ForEach-Object { "--exclude=$($_)" }

Write-Log 'Packing source'
& $tar -czf $tarball $excludeArgs -- . 2>$null
$tarExit = $LASTEXITCODE
if (-not (Test-Path $tarball) -or (Get-Item $tarball).Length -eq 0) {
    throw 'tar produced nothing'
}
if ($tarExit -ne 0) {
    # deploy.sh tolerates GNU tar's "file changed as we read it"; bsdtar can
    # also report a file changing mid-pack. A real archive is what matters.
    Write-Dirty "tar exited $tarExit but produced an archive - continuing"
}
$sizeMB = [math]::Round((Get-Item $tarball).Length / 1MB, 1)
Write-Host "  $sizeMB MB $name"

$skipFlag = [int]([bool]$SkipTests)

if ($DryRun) {
    Write-Log 'Dry run - not uploading'
    Write-Host "  scp -q $tarball $hostName`:/tmp/$name"
    Write-Host "  scp -q $repoRoot\deploy\remote-deploy.sh $hostName`:/tmp/$remoteScript"
    Write-Host "  ssh $hostName`: sed -i 's/\r$//' /tmp/$remoteScript; SKIP_TESTS=$skipFlag bash /tmp/$remoteScript $stamp /tmp/$name"
    Remove-Item $tarball
    exit 0
}

# --- upload + run the server half ----------------------------------------
Write-Log 'Uploading'
& $scp -q $tarball "${hostName}:/tmp/$name"
if ($LASTEXITCODE -ne 0) { throw 'uploading the source archive failed' }
& $scp -q (Join-Path $repoRoot 'deploy\remote-deploy.sh') "${hostName}:/tmp/$remoteScript"
if ($LASTEXITCODE -ne 0) { throw 'uploading remote-deploy.sh failed' }

Write-Log "Building and activating on $hostName"
# The `sed` strips CRLF: .gitattributes pins LF, but a checkout on a machine
# without it would ship CRLF and the shebang becomes `bash \r`.
# Backtick-$ lets PowerShell pass $?, $rc through untouched to the shell.
$remoteCmd = "sed -i 's/\r`$//' /tmp/$remoteScript; SKIP_TESTS=$skipFlag bash /tmp/$remoteScript '$stamp' '/tmp/$name'; rc=`$?; rm -f /tmp/$remoteScript '/tmp/$name'; exit `$rc"
& $ssh -o BatchMode=yes $hostName $remoteCmd
if ($LASTEXITCODE -ne 0) {
    throw "remote deploy failed with exit code $LASTEXITCODE"
}

Remove-Item $tarball
Write-Host "`nLocal half done - the server logged lint, typecheck, tests, migrate, build, restart and smoke test above." -ForegroundColor Green