import { describe, expect, it } from 'vitest'
import { resolveAgentPath, WINDOWS_AGENT_PIPE } from '../src/main/ssh/agent'

describe('resolveAgentPath', () => {
  it('uses the Windows OpenSSH pipe on Windows', () => {
    expect(resolveAgentPath(undefined, {}, 'win32')).toBe('\\\\.\\pipe\\openssh-ssh-agent')
    expect(WINDOWS_AGENT_PIPE).toBe('\\\\.\\pipe\\openssh-ssh-agent')
  })

  it('ignores SSH_AUTH_SOCK on Windows: it usually points to the Git for Windows agent', () => {
    const env = { SSH_AUTH_SOCK: 'C:/Users/me/AppData/Local/Temp/ssh-abc/agent.1445' }
    expect(resolveAgentPath(undefined, env, 'win32')).toBe(WINDOWS_AGENT_PIPE)
  })

  it('uses SSH_AUTH_SOCK on other platforms', () => {
    expect(
      resolveAgentPath(undefined, { SSH_AUTH_SOCK: '/run/user/1000/agent.sock' }, 'linux')
    ).toBe('/run/user/1000/agent.sock')
  })

  it('lets an explicit path win everywhere', () => {
    expect(resolveAgentPath('\\\\.\\pipe\\custom', { SSH_AUTH_SOCK: '/x' }, 'win32')).toBe(
      '\\\\.\\pipe\\custom'
    )
    expect(resolveAgentPath('/custom.sock', { SSH_AUTH_SOCK: '/x' }, 'linux')).toBe('/custom.sock')
  })

  it('fails clearly when no agent can be found', () => {
    expect(() => resolveAgentPath(undefined, {}, 'linux')).toThrow('No SSH agent available')
    expect(() => resolveAgentPath('', { SSH_AUTH_SOCK: '' }, 'darwin')).toThrow(
      'No SSH agent available'
    )
  })
})
