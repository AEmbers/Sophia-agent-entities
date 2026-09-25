// Before/after preview of the Claim panel + top bars (Candidate A/B/C/D).
// Shoots the real fixture in its current state, then injects the candidate
// design (CSS + the DOM rewrite the implementation would perform) and shoots
// the same states again, plus numeric probes for both.
// Usage: node .scratch/archive/2026-09/claim-panel-ux/recipes/run-local.mjs preview.e2e.ts preview
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
const SHOTS = join(LOCAL, `preview-${LABEL}`)
const OUT = join(LOCAL, `preview-${LABEL}.json`)

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

async function settleAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect?.getTiming()
    return timing === undefined || timing.iterations === Infinity || animation.playState !== 'running'
  }))
}

/** One sidebar transition may still be running when the viewport changes, so
    wait for the surface's own x to stop moving rather than for an attribute. */
async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  let previous = Number.NaN
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(120)
    const current = await page.evaluate(() => {
      const surface = document.querySelector('[data-team-thread], [data-team-channel]')
      return surface === null ? -1 : Math.round(surface.getBoundingClientRect().x * 100) / 100
    })
    if (current >= 0 && current === previous) break
    previous = current
  }
  await settleAnimations(page)
}

/** Every box and text metric the redesign's claims depend on. */
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
        content: (element.textContent ?? '').slice(0, 70),
      }
    }
    const band = document.querySelector('[data-team-thread] > div:first-child, [data-team-channel] > div:first-child')
    const rules: Array<{ cls: string, top: number, bottom: number, y: number }> = []
    if (band !== null) {
      for (const element of band.querySelectorAll<HTMLElement>('*')) {
        const style = getComputedStyle(element)
        const top = Number.parseFloat(style.borderTopWidth)
        const bottom = Number.parseFloat(style.borderBottomWidth)
        if ((top > 0 || bottom > 0) && !element.className.includes('button')) {
          rules.push({ cls: element.className.slice(0, 60), top, bottom, y: round(element.getBoundingClientRect().y) })
        }
      }
    }
    const riskDiagnostics = [...document.querySelectorAll('[data-team-thread] [class*="riskRow"]')].map(row => ({
      title: row.querySelector('span')?.getAttribute('title') ?? null,
      content: (row.textContent ?? '').slice(0, 90),
    }))
    const channelMeta = [...document.querySelectorAll('[data-team-channel] [class*="headerMeta"] span')]
      .map(span => (span.textContent ?? '').trim())
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      band: box('[data-team-thread] > div:first-child, [data-team-channel] > div:first-child'),
      channelTitle: text('[data-team-channel] h1'),
      channelManage: box('[data-team-channel] header button'),
      channelMeta,
      riskSection: box('[data-team-thread] [class*="riskSection"]'),
      riskRows: [...document.querySelectorAll('[data-team-thread] [class*="riskRow"]')].map((_, index) => text(`[data-team-thread] [class*="riskRow"]:nth-child(${index + 1})`)),
      riskDiagnostics,
      workSection: box('[data-team-thread] [class*="workSection"]'),
      claimRows: [...document.querySelectorAll('[data-team-thread] [class*="claimRow"]')].map((_, index) => box(`[data-team-thread] [class*="claimRow"]:nth-of-type(${index + 1})`)),
      claimDirection: text('[data-team-thread] [class*="claimDirection"]'),
      claimState: text('[data-team-thread] [class*="claimState"]'),
      disclosureRow: box('[data-team-thread] [class*="workSection"] [data-disclosure-row]'),
      timelineTop: box('[data-team-thread] section[class*="timeline"]'),
      bandRules: rules,
      docScrollWidth: document.documentElement.scrollWidth,
    }
  })
}

async function bandShot(page: Page, name: string): Promise<void> {
  const surface = page.locator('[data-team-thread], [data-team-channel]').first()
  const surfaceBox = await surface.boundingBox()
  const bandBox = await page.locator('[data-team-thread] > div:first-child, [data-team-channel] > div:first-child').first().boundingBox()
  if (surfaceBox === null || bandBox === null) throw new Error(`no band for ${name}`)
  // Clip to the content column: the band's centered 880px column starts at the
  // surface's left edge, and element screenshots would drag the sidebar in.
  await page.screenshot({
    path: join(SHOTS, `${name}.png`),
    clip: { x: surfaceBox.x, y: bandBox.y, width: surfaceBox.width, height: bandBox.height },
  })
}

it('previews the claim panel and top bars before and after', async () => {
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

  // --- Channel top bar, current state ---
  await page.getByRole('button', { name: '# ux' }).click()
  const channelComposer = page.getByRole('textbox', { name: '消息内容' })
  await channelComposer.waitFor({ timeout: 30_000 })
  await settleAnimations(page)
  const channelBefore = await probe(page)
  await bandShot(page, 'channel-bar-before-desktop')

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
    const read = await scaffold.ctx.agentTeam.readThreadForAgent(agent, {
      requestId: 'ux-done-read' as never, workspaceId: workspace.id, taskRef: taskOf().taskRef,
    })
    await scaffold.ctx.agentTeam.changeClaimForAgent(agent, {
      requestId: 'ux-done' as never, workspaceId: workspace.id,
      taskRef: taskOf().taskRef, claimRef: builderClaim as never, action: 'done', baseRevision: read.thread.revision,
    })
  }
  {
    const agent = agentOf('reviewer')
    const read = await scaffold.ctx.agentTeam.readThreadForAgent(agent, {
      requestId: 'ux-chat-read' as never, workspaceId: workspace.id, taskRef: taskOf().taskRef,
    })
    await scaffold.ctx.agentTeam.replyForAgent(agent, {
      requestId: 'ux-chat-1' as never, workspaceId: workspace.id,
      taskRef: taskOf().taskRef, body: '展开态信息有点多，先看下现状截图', baseRevision: read.thread.revision,
    })
  }

  // --- Thread, current state ---
  await page.getByRole('button', { name: /Claims · 3/ }).waitFor()
  await settleAnimations(page)
  const collapsedBefore = await probe(page)
  await bandShot(page, 'thread-collapsed-before-desktop')
  await page.getByRole('button', { name: /Claims · 3/ }).click()
  await page.getByText('补齐空态与窄屏走查', { exact: true }).waitFor()
  await settleAnimations(page)
  const expandedBefore = await probe(page)
  await bandShot(page, 'thread-expanded-before-desktop')
  await resize(page, 390, 844)
  const narrowBefore = await probe(page)
  await bandShot(page, 'thread-expanded-before-narrow')
  await resize(page, 1440, 960)

  // --- Inject the candidate ---
  // The component reads `status.diagnostic.class` and `status.presence` from the
  // live projection; a preview cannot, so the real values are read here and
  // handed to the page — the injected DOM then shows what the code would render.
  const statuses = scaffold.ctx.agentTeam.members({ workspaceId: workspace.id }) as ReadonlyArray<{
    member: { handle: string }
    presence: string
    diagnostic?: { class?: string, detail?: string }
  }>
  const riskClasses = Object.fromEntries(statuses.map(status => [status.member.handle.replace(/^@/, ''), status.diagnostic?.class ?? 'runtime']))
  const healthyHandles = statuses.filter(status => status.presence !== 'error').map(status => status.member.handle.replace(/^@/, ''))
  console.log(`RISK CLASSES ${JSON.stringify(riskClasses)} HEALTHY ${JSON.stringify(healthyHandles)}`)

  const injected = await page.evaluate(({ riskClasses, healthyHandles }) => {
    const style = document.createElement('style')
    style.textContent = `
      /* A — one structural rule per band, and separation by space, not lines */
      [class*="surfaceHeader"] { border-bottom-color: var(--dsw-alias-border-l2); }
      [class*="riskSection"], [class*="workSection"] { border-top: 0; margin-top: 14px; padding-top: 0; }
      [class*="riskSection"] h2, [class*="workSection"] h2 { margin: 0 0 6px; }
      /* A — compact single-line risk rows */
      [class*="riskRow"] { align-items: center; display: flex; flex-wrap: nowrap; gap: 6px;
        font-size: 11px; line-height: 16px; margin: 0 0 2px; overflow: hidden; }
      [class*="riskRow"] > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      [class*="riskRow"] > span > strong { font-weight: 600; color: var(--dsw-alias-label-secondary); }
      /* B — identity and state share line 1; the direction owns line 2 */
      [class*="claimList"] { gap: 0; padding: 4px 0 0 22px; }
      [class*="claimRow"] { grid-template-columns: 14px minmax(0, 1fr) auto; column-gap: 8px; row-gap: 0;
        min-height: 30px; padding: 3px 6px 5px; }
      [class*="claimRow"] > [class*="claimOwner"] { grid-column: 2; grid-row: 1; }
      [class*="claimRow"] > [class*="claimDirection"] { grid-column: 2; grid-row: 2; }
      [class*="claimRow"] > [class*="claimState"] { grid-column: 3; grid-row: 1; }
      [class*="claimOwner"] { align-items: center; display: inline-flex; font-size: 11px; gap: 4px;
        line-height: 16px; }
      [class*="claimOwner"] > i { background: var(--dsw-alias-state-success-primary); border-radius: 50%;
        corner-shape: round; display: inline-block; flex: 0 0 4px; height: 4px; width: 4px; }
      [class*="claimDirection"] { font-size: 12px; line-height: 18px; }
      [class*="claimState"] { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      /* D — the meta line wraps on spaces instead of dragging a '·' to the line start */
      [class*="headerMeta"] { column-gap: 10px; row-gap: 2px; }
      [class*="headerMeta"] > span + span::before { content: none; }
    `
    document.head.append(style)

    // The implementation would map the structured diagnostic class to a
    // localizable word; the preview does the same rewrite on the live DOM.
    const labelOfClass: Record<string, string> = {
      'session-refused': '会话格式被拒绝', 'session-unreadable': '会话不可读',
      'preset-composition': '预设装配失败', 'rollover': '上下文交接中',
      'runtime': '运行时故障', 'activation': '激活失败',
    }
    const leadOfClass: Record<string, string> = {
      'session-refused': '当前不可用', 'session-unreadable': '的会话无法读取',
      'preset-composition': '的预设无法装配', 'rollover': '正在交接上下文',
      'runtime': '遇到运行时故障', 'activation': '激活失败',
    }
    const classOfDot = (dot: Element): string => {
      const label = dot.getAttribute('aria-label') ?? dot.parentElement?.getAttribute('aria-label') ?? ''
      const handle = (label.match(/@?([A-Za-z0-9_-]+)/) ?? [])[1] ?? ''
      return riskClasses[handle] ?? 'runtime'
    }
    const cleaned: string[] = []
    const shapes: string[] = []
    for (const row of document.querySelectorAll<HTMLElement>('[data-team-thread] [class*="riskRow"]')) {
      // The row's first span is the presence dot's wrapper; the text is the
      // last one, which is also the node that carries the diagnostic.
      const spans = [...row.querySelectorAll<HTMLElement>('span')]
      const span = spans.at(-1)
      const dot = row.querySelector('[class*="target"]')
      if (span === undefined || dot === null) continue
      const original = (span.textContent ?? '').trim()
      shapes.push(row.outerHTML.slice(0, 220))
      const handle = (original.split(' ')[0] ?? '').replace(/^@/, '').trim()
      const klass = classOfDot(dot)
      // The rendered detail is '@handle 当前不可用：<host diagnostic> · <direction>';
      // the host's own first sentence is the human-readable reason.
      const colon = Math.max(original.indexOf('：'), original.indexOf(':'))
      const tail = original.slice(colon + 1)
      const detail = tail.split(' · ')[0]!.split('\n')[0]!.trim()
      const lead = `${handle} ${leadOfClass[klass] ?? leadOfClass.runtime!}`
      span.innerHTML = ''
      const strong = document.createElement('strong')
      strong.textContent = labelOfClass[klass] ?? labelOfClass.runtime!
      span.append(strong, document.createTextNode(` · ${lead} — ${detail}`))
      span.setAttribute('title', original)
      cleaned.push(`${klass} -> ${span.textContent?.slice(0, 90) ?? ''}`)
    }

    // The implementation would badge the row by availability; the preview
    // performs that DOM rewrite.
    for (const ownerCell of document.querySelectorAll<HTMLElement>('[data-team-thread] [class*="workSection"] [class*="claimOwner"]')) {
      const label = (ownerCell.textContent ?? '').trim()
      const suffix = label.startsWith('@') ? label.slice(1) : label
      ownerCell.textContent = ''
      // Only an available Member earns the live presence badge.
      if (healthyHandles.includes(suffix)) {
        const badge = document.createElement('i')
        badge.setAttribute('aria-hidden', 'true')
        ownerCell.append(badge)
      }
      ownerCell.append(document.createTextNode(suffix))
      ownerCell.setAttribute('title', `@${suffix}`)
    }
    for (const dot of document.querySelectorAll<HTMLElement>('[class*="claimRow"] > [class*="target"]')) {
      const state = dot.getAttribute('aria-label') ?? ''
      if (state.startsWith('可用') || state.startsWith('工作中')) {
        dot.style.background = 'var(--dsw-alias-state-success-primary)'
        dot.style.borderRadius = '50%'
        dot.style.height = '5px'
        dot.style.width = '5px'
      }
    }
    // Where the section anchor actually is: the disclosure chevron, its icon,
    // and its title. The claim dot should share one vertical spine with them.
    const disclosure = document.querySelector<HTMLElement>('[class*="workSection"] [data-disclosure-row]')
    const rowShape = (() => {
      const row = document.querySelector<HTMLElement>('[data-team-thread] [class*="workSection"] [class*="claimRow"]')
      if (row === null) return null
      const describe = (element: Element | null | undefined) => element == null ? null : {
        tag: element.tagName, cls: element.className.toString().slice(0, 30),
        display: getComputedStyle(element).display,
        gridColumn: getComputedStyle(element).gridColumn,
        x: Math.round(element.getBoundingClientRect().x * 100) / 100,
      }
      const wrapper = [...row.children].find(child => child.tagName === 'SPAN' && child.className === '')
      return {
        rowTemplate: getComputedStyle(row).gridTemplateColumns,
        children: [...row.children].map(describe),
        wrapperChildren: wrapper === undefined ? [] : [...wrapper.children].map(describe),
      }
    })()
    const anchors = disclosure === null ? [] : [...disclosure.querySelectorAll<HTMLElement>('svg, span, p, div')]
      .slice(0, 6)
      .map(element => {
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName, cls: element.className.toString().slice(0, 24),
          x: Math.round(rect.x * 100) / 100, w: Math.round(rect.width * 100) / 100,
          content: (element.textContent ?? '').slice(0, 20),
        }
      })
    const ownerGap = (() => {
      const owner = document.querySelector<HTMLElement>('[data-team-thread] [class*="workSection"] [class*="claimOwner"]')
      if (owner === null) return null
      const parent = owner.parentElement
      if (parent === null) return null
      return Math.round((owner.getBoundingClientRect().x - parent.getBoundingClientRect().x) * 100) / 100
    })()
    return { cleaned, shapes, anchors, ownerGap, rowShape, ownerCount: document.querySelectorAll('[class*="claimOwner"]').length }
  }, { riskClasses, healthyHandles })

  await settleAnimations(page)
  const expandedAfter = await probe(page)
  await bandShot(page, 'thread-expanded-after-desktop')
  await resize(page, 390, 844)
  const narrowAfter = await probe(page)
  await bandShot(page, 'thread-expanded-after-narrow')
  await resize(page, 1440, 960)
  await page.getByRole('button', { name: /Claims · 3/ }).click()
  await settleAnimations(page)
  const collapsedAfter = await probe(page)
  await bandShot(page, 'thread-collapsed-after-desktop')
  await page.getByRole('button', { name: '返回频道' }).click()
  await page.getByRole('textbox', { name: '消息内容' }).waitFor()
  await settleAnimations(page)
  const channelAfter = await probe(page)
  await bandShot(page, 'channel-bar-after-desktop')

  await writeFile(OUT, `${JSON.stringify({
    injected, channelBefore, channelAfter, collapsedBefore, collapsedAfter,
    expandedBefore, expandedAfter, narrowBefore, narrowAfter,
  }, null, 1)}\n`)
  console.log(`PREVIEW ${LABEL} written to ${OUT}`)
  console.log(JSON.stringify({ injected, channelBefore, channelAfter, expandedBefore: { band: expandedBefore.band, rules: expandedBefore.bandRules }, expandedAfter: { band: expandedAfter.band, rules: expandedAfter.bandRules } }, null, 1))
  expect(consoleWatch.pageErrors.length).toBe(0)
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
}, 600_000)
