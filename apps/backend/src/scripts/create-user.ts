import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { stdin, stdout } from 'node:process'
import { loadAppConfig } from '../config/app-config.js'
import * as schema from '../database/schema/index.js'
import { createAuth } from '../modules/auth/auth.js'
import { loadEnvironment } from '../config/load-env.js'

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) {
    return Promise.reject(new Error('Run account provisioning from an interactive terminal'))
  }

  return new Promise((resolve, reject) => {
    let secret = ''
    stdout.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()

    const finish = (error?: Error) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(secret)
    }

    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') {
          secret = secret.slice(0, -1)
          stdout.write('\b \b')
          continue
        }
        secret += character
        stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })
}

async function createUser() {
  loadEnvironment()
  const email = readOption('--email')?.trim().toLowerCase()
  const name = readOption('--name')?.trim()

  if (!email || !name) throw new Error('Usage: npm run user:create -- --email user@example.com --name "User Name"')
  const password = await readSecret('New password: ')
  const confirmation = await readSecret('Confirm password: ')
  if (password !== confirmation) throw new Error('Passwords do not match')
  if (password.length < 8) throw new Error('Password must contain at least 8 characters')

  const config = loadAppConfig()
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 })

  try {
    const auth = createAuth(drizzle(pool, { schema }), config, true)
    await auth.api.signUpEmail({ body: { email, name, password } })
    console.info(`Created account for ${email}`)
  } finally {
    await pool.end()
  }
}

createUser().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Account creation failed')
  process.exitCode = 1
})
