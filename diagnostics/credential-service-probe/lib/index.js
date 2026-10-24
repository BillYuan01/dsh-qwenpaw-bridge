export const name = 'diag-cred-probe'

function sample(ctx) {
  return async () => {
    const out = { service: false }
    const creds = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    out.service = creds !== undefined
    if (creds !== undefined) {
      try {
        const info = await creds.describe('DEEPSEEK_API_KEY')
        out.describe = { configured: info.configured, source: info.source, writable: info.writable }
      } catch (error) {
        out.describeError = String(error && error.message).slice(0, 120)
      }
      try {
        const hit = await creds.resolve('DEEPSEEK_API_KEY')
        out.resolve = hit === undefined ? null : { source: hit.source, length: hit.value.length }
      } catch (error) {
        out.resolveError = String(error && error.message).slice(0, 120)
      }
    }
    out.env_present = process.env.DEEPSEEK_API_KEY !== undefined
    return out
  }
}

export function apply(ctx) {
  const first = sample(ctx)
  ;(async () => {
    const out = {}
    out.at_apply = await first()
    await new Promise(resolve => setTimeout(resolve, 1200))
    out.after_1200ms = await first()
    out.services = typeof ctx.root === 'object' && ctx.root && typeof ctx.root.get === 'function'
      ? undefined
      : undefined
    try {
      const fs = await import('node:fs/promises')
      await fs.writeFile(process.env.DIAG_OUT || '/tmp/diag-cred-report.json', JSON.stringify(out, null, 2))
    } catch {}
  })()
}
