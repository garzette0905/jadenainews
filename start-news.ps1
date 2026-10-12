$jadenRoot = $PSScriptRoot
$jadenNode = (Get-Command node -ErrorAction Stop).Source
$jadenRuntime = Join-Path $jadenRoot '.runtime'
New-Item -ItemType Directory -Path $jadenRuntime -Force | Out-Null
$jadenProcess = Start-Process -FilePath $jadenNode -ArgumentList 'bridge/server.mjs' -WorkingDirectory $jadenRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $jadenRuntime 'bridge.log') -RedirectStandardError (Join-Path $jadenRuntime 'bridge-error.log') -PassThru
Write-Output "Jaden AI News 실행 프로그램을 시작했습니다. PID: $($jadenProcess.Id)"
Write-Output '브라우저에서 http://127.0.0.1:1455/ 를 열어 Sites 뉴스 화면 연결을 누르세요.'
