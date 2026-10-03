import { userInfo } from 'node:os'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { loadAppConfig } from '../config/app-config.js'
import { loadEnvironment } from '../config/load-env.js'
import * as schema from '../database/schema/index.js'
import { AccessProvisioner } from '../modules/access/access-provisioner.js'
import { recommendedAccessProfiles } from '../modules/access/recommended-access.js'

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function provisionAccess() {
  loadEnvironment()
  const action = readOption('--action') ?? 'grant'
  const profile = readOption('--profile')
  if (profile && !Object.hasOwn(recommendedAccessProfiles, profile)) throw new Error('Unknown access profile')
  if (profile && readOption('--permissions')) throw new Error('Choose --profile or --permissions, not both')
  const common = {
    email: readOption('--email')?.trim() ?? '',
    entityCode: readOption('--entity-code')?.trim() ?? '',
    roleCode: readOption('--role-code')?.trim() ?? '',
    source: `local-cli:${userInfo().username}`,
  }
  if (!['grant', 'revoke'].includes(action)) throw new Error('--action must be grant or revoke')
  const pool = new Pool({ connectionString: loadAppConfig().databaseUrl, max: 1 })
  try {
    const provisioner = new AccessProvisioner(drizzle(pool, { schema }))
    const result = action === 'revoke'
      ? await provisioner.revoke(common)
      : await provisioner.grant({
          ...common,
          entityName: readOption('--entity-name') ?? '',
          permissions: profile ? [...recommendedAccessProfiles[profile as keyof typeof recommendedAccessProfiles]] : (readOption('--permissions') ?? '').split(',').map((item) => item.trim()).filter(Boolean),
        })
    console.info(JSON.stringify(result))
  } finally {
    await pool.end()
  }
}

provisionAccess().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Access provisioning failed')
  process.exitCode = 1
})
