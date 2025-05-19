// pages/api/download.js
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { tmpdir } from 'os'

const execFileAsync = promisify(execFile)
const sessions = new Map()

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { appleId, password, appId, twoFactorCode, sessionId } = req.body

    // Thiết lập môi trường
    process.env.HOME = tmpdir()
    process.env.TMPDIR = tmpdir()

    const ipatoolPath = path.join(tmpdir(), 'ipatool')
    
    // Quản lý session
    let keychainPassphrase
    let currentSessionId = sessionId

    if (currentSessionId && sessions.has(currentSessionId)) {
      keychainPassphrase = sessions.get(currentSessionId)
    } else {
      keychainPassphrase = process.env.KEYCHAIN_PASSPHRASE || 
        Math.random().toString(36).slice(2, 18)
      currentSessionId = Math.random().toString(36).slice(2, 12)
      sessions.set(currentSessionId, keychainPassphrase)
      setTimeout(() => sessions.delete(currentSessionId), 10 * 60 * 1000)
    }

    // Đăng nhập
    const loginArgs = [
      'auth', 'login',
      '--email', appleId,
      '--password', password,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      ...(twoFactorCode ? ['--auth-code', twoFactorCode] : [])
    ]

    const { stdout: loginOutput, stderr: loginError } = await execFileAsync(ipatoolPath, loginArgs, {
      timeout: 120000
    })

    if (loginError || !loginOutput.includes('success=true')) {
      if (/2FA|two-factor|auth-code/i.test(loginError || loginOutput)) {
        return res.status(401).json({
          error: '2FA_REQUIRED',
          sessionId: currentSessionId
        })
      }
      throw new Error(loginError || 'Login failed')
    }

    // Tải xuống
    const downloadArgs = [
      'download',
      '--bundle-identifier', appId,
      '--non-interactive',
      '--keychain-passphrase', keychainPassphrase,
      '--purchase'
    ]

    const { stdout: downloadOutput } = await execFileAsync(ipatoolPath, downloadArgs, {
      timeout: 300000
    })

    const ipaPath = downloadOutput.split('\n')
      .reverse()
      .find(line => line.trim().endsWith('.ipa'))?.trim()

    if (!ipaPath) throw new Error('IPA not found')

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${appId}.ipa"`)
    return res.send(ipaPath)

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({
      error: 'SERVER_ERROR',
      details: error.message
    })
  }
}