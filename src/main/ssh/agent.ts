/** Named pipe of the Windows OpenSSH agent service. */
export const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

/**
 * On Windows, SSH_AUTH_SOCK usually belongs to the Git for Windows agent (an MSYS socket file
 * that ssh2 cannot speak, holding different keys), so the OpenSSH service pipe always wins there.
 */
export function resolveAgentPath(
  explicit: string | undefined,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform
): string {
  const path = explicit || (platform === 'win32' ? WINDOWS_AGENT_PIPE : env['SSH_AUTH_SOCK'])
  if (!path) throw new Error('No SSH agent available')
  return path
}
