// Measures the SHIPPED implementation through the same fixture the preview used,
// with no injected CSS: if the real code lands where the approved preview said,
// the numbers must match it.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

const TEAM_ROOT = '__TEAM_ROOT__'
const OVERLAY = '__OVERLAY__'
const HOME = '__HOME__'
const CHROME = '__CHROME__'
const LABEL = '__LABEL__'
const LOCAL = '__OUT__'
const SHOTS = join(LOCAL, `verify-${LABEL}`)

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect?.getTiming()
    return timing === undefined || timing.iterations === Infinity || animation.playState !== 'running'
  }))
}

async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  let previous = Number.NaN
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(120)
    const current = await page.evaluate(() => {
      const surface = document.querySelector('[data-team-thread]')
      return surface === null ? -1 : Math.round(surface.getBoundingClientRect().x * 100) / 100
    })
    if (current >= 0 && current === previous) break
    previous = current
  }
  await settle(page)
}

async function probe(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100
    const box = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) }
    }
    const text = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const lineHeight = Number.parseFloat(style.lineHeight)
      return {
        size: style.fontSize, weight: style.fontWeight, color: style.color,
        box: { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) },
        lines: Number.isFinite(lineHeight) && lineHeight > 0 ? round(rect.height / lineHeight) : null,
        content: (element.textContent ?? '').slice(0, 80),
      }
    }
    const band = document.querySelector('[data-team-thread] > div:first-child')
    const rules: Array<{ cls: string, top: number, bottom: number, y: number }> = []
    if (band !== null) {
      for (const element of band.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(element)
        const top = Number.parseFloat(style.borderTopWidth)
        const bottom = Number.parseFloat(style.borderBottomWidth)
        if ((top > 0 || bottom > 0) && element.tagName !== 'BUTTON' && !element.className.includes('_button_')) {
          rules.push({ cls: element.className.slice(0, 40), top, bottom, y: round(element.getBoundingClientRect().y) })
        }
      }
    }
    // The claim row's own tracks and cells: the redesign's central claim is that
    // all three tracks carry content and identity/state share the first line.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-team-thread] [class*="claimRow"]')].map(row => {
      const cell = (selector: string) => {
        const element = row.querySelector<HTMLElement>(selector)
        if (element === null) return null
        const rect = element.getBoundingClientRect()
        return { x: round(rect.x), y: round(rect.y), h: round(rect.height) }
      }
      return {
        template: getComputedStyle(row).gridTemplateColumns,
        h: round(row.getBoundingClientRect().height),
        done: row.className.includes('RowDone') || row.className.includes('claimRowDone'),
        owner: cell('[class*="claimOwner"]'),
        direction: cell('[class*="claimDirection"]'),
        state: cell('[class*="claimState"]'),
        live: row.querySelector('[class*="claimLive"]') !== null,
        text: (row.textContent ?? '').trim().slice(0, 70),
      }
    })
    const risk = [...document.querySelectorAll<HTMLElement>('[data-team-thread] [class*="riskRow"]')].map(row => {
      // The presence dot's wrapper is a span too, so identify the text span by
      // the title it carries (the full Host diagnostic).
      const span = row.querySelector<HTMLElement>('span[title]')
      const klass = row.querySelector<HTMLElement>('[class*="riskClass"]')
      const rect = row.getBoundingClientRect()
      const lineHeight = Number.parseFloat(getComputedStyle(row).lineHeight)
      return {
        lines: lineHeight > 0 ? round(rect.height / lineHeight) : null,
        title: span?.getAttribute('title') ?? null,
        classLabel: klass?.textContent ?? null,
        content: (span?.textContent ?? '').slice(0, 110),
        html: row.innerHTML.slice(0, 160),
      }
    })
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      band: box('[data-team-thread] > div:first-child'),
      ruleCount: rules.length,
      rules,
      risk,
      claimRows: rows,
      timelineTop: box('[data-team-thread] section[class*="timeline"]'),
      docScrollWidth: document.documentElement.scrollWidth,
    }
  })
}

async function bandShot(page: Page, name: string): Promise<void> {
  const surfaceBox = await page.locator('[data-team-thread]').first().boundingBox()
  const bandBox = await page.locator('[data-team-thread] > div:first-child').first().boundingBox()
  if (surfaceBox === null || bandBox === null) throw new Error(`no band for ${name}`)
  await page.screenshot({ path: join(SHOTS, `${name}.png`), clip: { x: surfaceBox.x, y: bandBox.y, width: surfaceBox.width, height: bandBox.height } })
}

it('measures the shipped claim panel against the approved preview', async () => {
  await rm(HOME, { recursive: true, force: true })
  await rm(SHOTS, { recursive: true, force: true })
  await mkdir(SHOTS, { recursive: true })
  const scope = `${HOME}/profiles/node_modules/@wowyuarm`
  await mkdir(scope, { recursive: true })
  await cp(TEAM_ROOT, `${scope}/dsh-agent-team`, {
    recursive: true,
    filter: source => {
      const normalized = source.replaceAll('\\', '/')
      return !normalized.includes('/node_modules') && !normalized.includes('/src') && !normalized.includes('/artifacts') && !normalized.includes('/.hoplite')
    },
  })
  scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, harnessHome: HOME })
  browser = await chromium.launch({ headless: true, executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const consoleWatch = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd, 'team-workspace')
  await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: '团队' }).click()
  await page.getByRole('button', { name: '新建频道' }).click()
  const channelDialog = page.getByRole('dialog', { name: '新建频道' })
  await channelDialog.getByLabel('名称').fill('ux')
  await channelDialog.getByLabel('说明').fill('claim 面板走查')
  await channelDialog.getByRole('button', { name: '创建频道' }).click()
  for (const [name, description] of [['builder', '实现功能'], ['reviewer', '检查结果'], ['helper', '打杂']] as const) {
    await page.getByRole('button', { name: '添加 Agent' }).click()
    const dialog = page.getByRole('dialog', { name: '添加 Agent' })
    await dialog.getByLabel('名称').fill(name)
    await dialog.getByLabel('说明').fill(description)
    await dialog.getByRole('button', { name: '创建 Agent' }).click()
    await page.getByText(name, { exact: true }).waitFor({ timeout: 20_000 })
  }
  await page.getByRole('button', { name: '# ux' }).hover()
  await page.getByRole('button', { name: 'ux 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑频道' }).click()
  const joinEditor = page.getByRole('dialog', { name: '编辑频道' })
  await joinEditor.waitFor()
  for (const handle of ['builder', 'reviewer', 'helper']) {
    const row = joinEditor.locator('[data-team-member-row]').filter({ hasText: `@${handle}` })
    await expect.poll(async () => await row.getByRole('button', { name: '添加' }).isEnabled(), { timeout: 30_000 }).toBe(true)
    await row.getByRole('button', { name: '添加' }).click()
  }
  await expect.poll(async () => await joinEditor.getByRole('button', { name: '移除', exact: true }).count()).toBe(3)
  await joinEditor.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '# ux' }).click()
  const composer = page.getByRole('textbox', { name: '消息内容' })
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('优化 claim 面板 @builder')
  await page.getByRole('option', { name: /@builder/ }).click()
  await page.getByRole('button', { name: '作为任务' }).click()
  await page.getByRole('button', { name: '发送' }).click()
  const entry = page.locator('[data-team-channel] [data-thread-entry] > button').first()
  await entry.waitFor()
  await entry.click()

  const workspace = scaffold.ctx.workspaceRegistry.list()[0]!
  const agentOf = (handle: string) => {
    const status = scaffold!.ctx.agentTeam.members({ workspaceId: workspace.id })
      .find((candidate: { member: { handle: string } }) => candidate.member.handle === handle)!
    return scaffold!.ctx.agents.get(status.member.sessionId)!
  }
  const taskOf = () => scaffold!.ctx.agentTeam.view({ workspaceId: workspace.id })
    .tasks.find((candidate: { taskRef: string }) => candidate.taskRef !== undefined)!
  const claimAs = async (handle: string, direction: string, requestId: string) => {
    const agent = agentOf(handle)
    const read = await scaffold!.ctx.agentTeam.readThreadForAgent(agent, {
      requestId: `${requestId}-read` as never, workspaceId: workspace.id, taskRef: taskOf().taskRef,
    })
    const claimed = await scaffold!.ctx.agentTeam.changeClaimForAgent(agent, {
      requestId: requestId as never, workspaceId: workspace.id,
      taskRef: taskOf().taskRef, action: 'claim', direction, baseRevision: read.thread.revision,
    })
    if (claimed.kind !== 'committed') throw new Error(`Claim rejected: ${claimed.kind}`)
    return claimed.claim.claimRef as string
  }
  await claimAs('builder', '实现 claim 列表的信息分层', 'vf-claim-1')
  await claimAs('reviewer', '检查视觉层级与分割线', 'vf-claim-2')
  await claimAs('helper', '补齐空态与窄屏走查', 'vf-claim-3')

  await page.getByRole('button', { name: /Claims · 3/ }).waitFor()
  await settle(page)
  const collapsed = await probe(page)
  await bandShot(page, 'thread-collapsed-desktop')
  await page.getByRole('button', { name: /Claims · 3/ }).click()
  await page.getByText('补齐空态与窄屏走查', { exact: true }).waitFor()
  await settle(page)
  const expanded = await probe(page)
  await bandShot(page, 'thread-expanded-desktop')
  await resize(page, 390, 844)
  const narrow = await probe(page)
  await bandShot(page, 'thread-expanded-narrow')
  await resize(page, 1440, 960)

  await writeFile(join(LOCAL, `verify-${LABEL}.json`), `${JSON.stringify({ collapsed, expanded, narrow }, null, 1)}\n`)
  console.log(`VERIFY ${LABEL}`)
  console.log(JSON.stringify({ expanded: { band: expanded.band, ruleCount: expanded.ruleCount, risk: expanded.risk, rows: expanded.claimRows, timelineTop: expanded.timelineTop }, narrow: { band: narrow.band, ruleCount: narrow.ruleCount, risk: narrow.risk, rows: narrow.claimRows, timelineTop: narrow.timelineTop, scrollWidth: narrow.docScrollWidth } }, null, 1))
  expect(consoleWatch.pageErrors.length).toBe(0)
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
}, 600_000)
