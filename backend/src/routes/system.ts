import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WINDOWS_DIALOG_TIMEOUT_MS = 30_000;

/**
 * 通过平台原生弹窗选择目录，并返回绝对路径。
 * 说明：
 * - 该函数优先走桌面端原生能力，确保拿到的是“真实文件系统路径”而非浏览器沙箱句柄名。
 * - 返回 null 代表用户取消选择，不视为错误。
 */
async function pickDirectoryWithNativeDialog(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Select workspace folder")'
    ]);
    const path = stdout.trim();
    return path || null;
  }

  if (process.platform === 'win32') {
    /**
     * Windows 使用 PowerShell + FolderBrowserDialog：
     * - 直接回传 SelectedPath（绝对路径），避免前端仅显示目录名的问题。
     * - Out-String + trim() 用于兼容换行结尾。
     * - 显式启用 STA（Single-Threaded Apartment），避免 WinForms 对话框在 MTA 下无法正确弹出，
     *   从而导致 /system/select-directory 请求长时间保持 pending。
     * - 添加超时保护，防止环境异常时请求无穷等待。
     */
    const windowsDialogScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$owner = New-Object System.Windows.Forms.Form',
      '$owner.TopMost = $true',
      '$owner.ShowInTaskbar = $false',
      '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
      '$owner.WindowState = [System.Windows.Forms.FormWindowState]::Minimized',
      '$owner.Opacity = 0',
      '$owner.Show()',
      '$owner.Activate()',
      '[System.Windows.Forms.Application]::DoEvents()',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Select workspace folder"',
      '$dialog.ShowNewFolderButton = $true',
      '$result = $dialog.ShowDialog($owner)',
      '$owner.Close()',
      '$owner.Dispose()',
      'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  $dialog.SelectedPath | Out-String',
      '}'
    ].join('; ');
    /**
     * 使用 execFile 的 timeout，超时后会直接终止子进程，避免对话框进程残留。
     * 同时设置 windowsHide=false，确保对话框有机会在桌面会话中显示。
     */
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        windowsDialogScript
      ],
      {
        timeout: WINDOWS_DIALOG_TIMEOUT_MS,
        windowsHide: false,
        maxBuffer: 1024 * 1024
      }
    );
    const path = stdout.trim();
    return path || null;
  }

  return null;
}

export async function registerSystemRoutes(app: FastifyInstance) {
  app.post('/system/select-directory', async (request, reply) => {
    try {
      const path = await pickDirectoryWithNativeDialog();
      if (!path) {
        if (process.platform === 'darwin' || process.platform === 'win32') {
          return reply.code(204).send();
        }
        return reply.code(501).send({ error: 'Directory picker is only implemented for macOS and Windows.' });
      }

      return { path };
    } catch {
      return reply.code(204).send();
    }
  });
}
