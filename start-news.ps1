$jadenRoot = $PSScriptRoot
$jadenNode = (Get-Command node -ErrorAction Stop).Source
$jadenRuntime = Join-Path $jadenRoot '.runtime'
try {
    $jadenHealth = Invoke-RestMethod 'http://127.0.0.1:1455/health' -TimeoutSec 3
    if ($jadenHealth.service -eq 'jaden-ai-news') {
        Write-Output 'Jaden AI News 실행 프로그램이 이미 켜져 있습니다. 사이트에서 연결 확인을 누르세요.'
        return
    }
} catch { }
New-Item -ItemType Directory -Path $jadenRuntime -Force | Out-Null
$jadenProcess = Start-Process -FilePath $jadenNode -ArgumentList 'bridge/server.mjs' -WorkingDirectory $jadenRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $jadenRuntime 'bridge.log') -RedirectStandardError (Join-Path $jadenRuntime 'bridge-error.log') -PassThru
Write-Output "Jaden AI News 실행 프로그램을 시작했습니다. PID: $($jadenProcess.Id)"
Write-Output '저장된 설정으로 사이트에 자동 연결합니다. 사이트에서 연결 확인을 누른 뒤 데이터 수집하기를 누르세요.'
