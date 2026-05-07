param(
    # 变更说明：
    # - v1.0.0：新增 Windows PowerShell 启动脚本，补齐与 start-dev.sh 对应能力。
    # - v1.0.1：增强为“当前终端实时日志”模式，便于在一个窗口观察 backend/website 启动与报错信息。
    # - 当任一服务退出（或 Ctrl+C 中断）时，统一清理所有子进程，避免端口残留。
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"

# 使用脚本所在目录作为根目录，避免从其他目录执行时路径解析错误。
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$backendProcess = $null
$websiteProcess = $null
$eventSubscriptions = @()

function Start-DevProcess {
    param(
        [string]$Name,
        [string]$WorkingDirectory
    )

    # 使用 .NET Process + 重定向流，实现双服务日志在当前终端实时回显。
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $process.StartInfo.FileName = "pnpm.cmd"
    $process.StartInfo.Arguments = "run dev"
    $process.StartInfo.WorkingDirectory = $WorkingDirectory
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $process.StartInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

    $null = $process.Start()

    # 输出流事件：每一行都附带服务名前缀，便于区分来源。
    $outSub = Register-ObjectEvent `
        -InputObject $process `
        -EventName OutputDataReceived `
        -MessageData $Name `
        -Action {
            $serviceName = [string]$Event.MessageData
            if (-not [string]::IsNullOrWhiteSpace($EventArgs.Data)) {
                Write-Host "[$serviceName] $($EventArgs.Data)"
            }
        }

    $errSub = Register-ObjectEvent `
        -InputObject $process `
        -EventName ErrorDataReceived `
        -MessageData $Name `
        -Action {
            $serviceName = [string]$Event.MessageData
            if (-not [string]::IsNullOrWhiteSpace($EventArgs.Data)) {
                Write-Host "[$serviceName][ERR] $($EventArgs.Data)" -ForegroundColor Red
            }
        }

    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()

    return @{
        Process = $process
        OutputSubscription = $outSub
        ErrorSubscription = $errSub
    }
}

function Stop-DevProcess {
    param(
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        return
    }

    try {
        # 仅在进程仍存活时尝试终止，避免抛出“进程已退出”异常。
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
        # 清理阶段不因为单个进程终止失败而中断。
    }
}

function Unregister-DevEvents {
    param(
        [array]$Subscriptions
    )

    foreach ($sub in $Subscriptions) {
        if ($null -ne $sub) {
            try {
                Unregister-Event -SubscriptionId $sub.Id -ErrorAction SilentlyContinue
                Remove-Job -Id $sub.Id -Force -ErrorAction SilentlyContinue
            }
            catch {
                # 清理阶段不因为事件反注册失败而中断。
            }
        }
    }
}

try {
    # 先启动 backend 开发服务。
    $backendResult = Start-DevProcess `
        -Name "backend" `
        -WorkingDirectory (Join-Path $RootDir "backend")
    $backendProcess = $backendResult.Process

    # 再启动 website 开发服务。
    $websiteResult = Start-DevProcess `
        -Name "website" `
        -WorkingDirectory (Join-Path $RootDir "website")
    $websiteProcess = $websiteResult.Process

    $eventSubscriptions += $backendResult.OutputSubscription
    $eventSubscriptions += $backendResult.ErrorSubscription
    $eventSubscriptions += $websiteResult.OutputSubscription
    $eventSubscriptions += $websiteResult.ErrorSubscription

    Write-Host "backend pid: $($backendProcess.Id)"
    Write-Host "website pid: $($websiteProcess.Id)"
    Write-Host "dev services started with live logs, press Ctrl+C to stop."

    # 轮询等待：只要任一子进程退出，就结束主循环并进入 finally 清理另一个进程。
    while ($true) {
        if ($backendProcess.HasExited -or $websiteProcess.HasExited) {
            break
        }
        Start-Sleep -Seconds 1
    }

    if ($PassThru) {
        # 可选输出，便于脚本调用方做进程状态集成。
        [PSCustomObject]@{
            BackendPid = $backendProcess.Id
            WebsitePid = $websiteProcess.Id
            BackendExited = $backendProcess.HasExited
            WebsiteExited = $websiteProcess.HasExited
        }
    }
}
finally {
    Stop-DevProcess -Process $backendProcess
    Stop-DevProcess -Process $websiteProcess
    Unregister-DevEvents -Subscriptions $eventSubscriptions
}
