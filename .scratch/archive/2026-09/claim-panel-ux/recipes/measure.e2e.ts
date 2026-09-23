import { cp, mkdir, rm } from 'node:fs/promises'
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
const OUT = join('__OUT__', `measure-${LABEL}.json`)
let scaffold: WebScaffold | undefined
let browser: Browser | undefined

async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect?.getTiming()
    return timing === undefined || timing.iterations === Infinity || animation.playState !== 'running'
  }))
}

/** Every box and text metric the band's design decisions depend on. */
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
        size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight,
        color: style.color, box: { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) },
        lines: Number.isFinite(lineHeight) && lineHeight > 0 ? round(rect.height / lineHeight) : null,
        content: (element.textContent ?? '').slice(0, 60),
      }
    }
    const band = document.querySelector('[data-team-thread] > div:first-child, [data-team-channel] > div:first-child')
    const rules: Array<{ cls: string, top: number, bottom: number, width: number, y: number }> = []
    if (band !== null) {
      for (const element of band.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(element)
        const top = Number.parseFloat(style.borderTopWidth)
        const bottom = Number.parseFloat(style.borderBottomWidth)
        if (top > 0 || bottom > 0) {
          rules.push({ cls: element.className.slice(0, 60), top, bottom, width: round(element.getBoundingClientRect().width), y: round(element.getBoundingClientRect().y) })
        }
      }
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      band: box('[data-team-thread] > div:first-child') ?? box('[data-team-channel] > div:first-child'),
      backRow: box('[data-team-thread] [class*="backRow"], [data-team-channel] [class*="backRow"]'),
      headerRow: box('[data-team-thread] [class*="headerRow"], [data-team-channel] [class*="headerRow"]'),
      headerCopy: box('[data-team-thread] [class*="headerCopy"], [data-team-channel] [class*="headerCopy"]'),
      title: text('[data-team-thread] h1, [data-team-channel] h1'),
      taskTitle: text('[data-team-thread] [class*="taskTitle"]'),
      riskSection: box('[data-team-thread] [class*="riskSection"]'),
      riskHeading: text('[data-team-thread] [class*="riskSection"] h2'),
      riskRow: text('[data-team-thread] [class*="riskRow"]'),
      workSection: box('[data-team-thread] [class*="workSection"]'),
      claimList: box('[data-team-thread] [class*="claimList"]'),
      claimRow: box('[data-team-thread] [class*="claimRow"]'),
      claimOwner: text('[data-team-thread] [class*="claimOwner"]'),
      claimDirection: text('[data-team-thread] [class*="claimDirection"]'),
      claimState: text('[data-team-thread] [class*="claimState"]'),
      disclosureRow: box('[data-team-thread] [class*="workSection"] [data-disclosure-row]'),
      timelineTop: box('[data-team-thread] section[class*="timeline"]'),
      bandRules: rules,
      docScrollWidth: document.documentElement.scrollWidth,
    }
  })
}

it('measures the claim panel and top bars', async () => {
  await rm(HOME, { recursive: true, force: true })
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
  const initialChannelDialog = page.getByRole('dialog', { name: '新建频道' })
  await initialChannelDialog.getByLabel('名称').fill('ux')
  await initialChannelDialog.getByLabel('说明').fill('claim 面板走查')
  await initialChannelDialog.getByRole('button', { name: '创建频道' }).click()
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

  const channelProbe = await probe(page)

  await page.getByRole('button', { name: '# ux' }).click()
  const channelComposer = page.getByRole('textbox', { name: '消息内容' })
  await channelComposer.waitFor({ timeout: 30_000 })
  await channelComposer.fill('优化 claim 面板 @builder')
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
  const builderClaim = await claimAs('builder', '实现 claim 列表的信息分层', 'ux-claim-1')
  await claimAs('reviewer', '检查视觉层级与分割线', 'ux-claim-2')
  await claimAs('helper', '补齐空态与窄屏走查', 'ux-claim-3')
  {
    const agent = agentOf('builder')
    const read = await scaffold!.ctx.agentTeam.readThreadForAgent(agent, {
      requestId: 'ux-done-read' as never, workspaceId: workspace.id, taskRef: taskOf().taskRef,
    })
    await scaffold!.ctx.agentTeam.changeClaimForAgent(agent, {
      requestId: 'ux-done' as never, workspaceId: workspace.id,
      taskRef: taskOf().taskRef, claimRef: builderClaim as never, action: 'done', baseRevision: read.thread.revision,
    })
  }
  {
    const agent = agentOf('reviewer')
    const read = await scaffold!.ctx.agentTeam.readThreadForAgent(agent, {
      requestId: 'ux-chat-read' as never, workspaceId: workspace.id, taskRef: taskOf().taskRef,
    })
    await scaffold!.ctx.agentTeam.replyForAgent(agent, {
      requestId: 'ux-chat-1' as never, workspaceId: workspace.id,
      taskRef: taskOf().taskRef, body: '展开态信息有点多，先看下现状截图', baseRevision: read.thread.revision,
    })
  }

  await page.getByRole('button', { name: /Claims · 3/ }).waitFor()
  const collapsed = await probe(page)
  await page.getByRole('button', { name: /Claims · 3/ }).click()
  await page.getByText('补齐空态与窄屏走查', { exact: true }).waitFor()
  await settleAnimations(page)
  const expandedDesktop = await probe(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-collapsed="true"]').waitFor()
  await settleAnimations(page)
  const expandedNarrow = await probe(page)

  const payload = { channel: channelProbe, collapsed, expandedDesktop, expandedNarrow }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(OUT, `${JSON.stringify(payload, null, 1)}\n`)
  console.log(`MEASURE ${LABEL} written to ${OUT}`)
  console.log(JSON.stringify(payload, null, 1))
  expect(consoleWatch.pageErrors.length).toBe(0)
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
}, 600_000)
