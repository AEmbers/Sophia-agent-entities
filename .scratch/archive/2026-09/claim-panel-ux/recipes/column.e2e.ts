// Answers the Human's question with numbers: are the top bars' two sides already
// aligned with the conversation column, and what changes if the column widens to
// the surface boundary instead of staying centered?
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

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

/** Left/right edge of every anchor the question touches, at the current width. */
async function edges(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100
    const find = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        x: round(rect.x), right: round(window.innerWidth - rect.right), w: round(rect.width),
        maxWidth: style.maxWidth, margin: style.marginLeft === style.marginRight ? `${style.marginLeft} (auto)` : `${style.marginLeft}/${style.marginRight}`,
      }
    }
    const surface = document.querySelector('[data-team-thread]')
    const content = (selector: string) => {
      const element = document.querySelector(selector)
      if (element === null || surface === null) return null
      const rect = element.getBoundingClientRect()
      const edge = surface.getBoundingClientRect()
      return { gapFromContentEdge: round(rect.x - edge.x), gapFromRightEdge: round(edge.right - rect.right), w: round(rect.width) }
    }
    const timelineBox = document.querySelector<HTMLElement>('[data-team-thread] [class*="timeline"]')
    const headerBox = document.querySelector<HTMLElement>('[data-team-thread] > div:first-child')
    return {
      viewport: window.innerWidth,
      timelineScrollbar: timelineBox === null ? null : {
        reserved: round(timelineBox.offsetWidth - timelineBox.clientWidth),
        gutter: getComputedStyle(timelineBox).scrollbarGutter,
        padLeft: getComputedStyle(timelineBox).paddingLeft,
        padRight: getComputedStyle(timelineBox).paddingRight,
      },
      headerPadding: headerBox === null ? null : {
        padLeft: getComputedStyle(headerBox).paddingLeft,
        padRight: getComputedStyle(headerBox).paddingRight,
      },
      surface: find('[data-team-thread]'),
      backRow: find('[data-team-thread] > div:first-child [class*="backRow"]'),
      headerRow: find('[data-team-thread] > div:first-child [class*="headerRow"]'),
      taskTitle: find('[data-team-thread] [class*="taskTitle"]'),
      claimsRow: find('[data-team-thread] [class*="workSection"] [data-disclosure-row]'),
      firstMessage: find('[data-team-thread] article, [data-team-thread] [class*="timelineContent"] > *'),
      timelineContent: find('[data-team-thread] [class*="timelineContent"]'),
      timelineCol: content('[data-team-thread] [class*="timelineContent"]'),
    }
  })
}

it('measures the header column against the conversation column', async () => {
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
  const dialog = page.getByRole('dialog', { name: '新建频道' })
  await dialog.getByLabel('名称').fill('ux')
  await dialog.getByLabel('说明').fill('claim 面板走查')
  await dialog.getByRole('button', { name: '创建频道' }).click()
  await page.getByRole('button', { name: '添加 Agent' }).click()
  const agentDialog = page.getByRole('dialog', { name: '添加 Agent' })
  await agentDialog.getByLabel('名称').fill('builder')
  await agentDialog.getByLabel('说明').fill('实现功能')
  await agentDialog.getByRole('button', { name: '创建 Agent' }).click()
  await page.getByText('builder', { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '# ux' }).hover()
  await page.getByRole('button', { name: 'ux 的操作' }).click()
  await page.getByRole('menuitem', { name: '编辑频道' }).click()
  const joinEditor = page.getByRole('dialog', { name: '编辑频道' })
  await joinEditor.waitFor()
  const memberRow = joinEditor.locator('[data-team-member-row]').filter({ hasText: '@builder' })
  await expect.poll(async () => await memberRow.getByRole('button', { name: '添加' }).isEnabled(), { timeout: 30_000 }).toBe(true)
  await memberRow.getByRole('button', { name: '添加' }).click()
  await expect.poll(async () => await joinEditor.getByRole('button', { name: '移除', exact: true }).count()).toBe(1)
  await joinEditor.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '# ux' }).click()
  const composer = page.getByRole('textbox', { name: '消息内容' })
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill('优化 claim 面板的顶层栏与对话列对齐 @builder')
  await page.getByRole('option', { name: /@builder/ }).click()
  await page.getByRole('button', { name: '作为任务' }).click()
  await page.getByRole('button', { name: '发送' }).click()
  await page.locator('[data-team-channel] [data-thread-entry]').first().waitFor()
  await page.locator('[data-team-channel] [data-thread-entry] > button').first().click()
  await page.getByRole('button', { name: /Claims · / }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)

  const centered = { desktop: await edges(page) }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(600)
  centered.wide = await edges(page)

  // Alternative: let the column run to the surface boundary.
  await page.addStyleTag({ content: `
    [data-team-thread] [class*="headerRow"], [data-team-thread] [class*="backRow"],
    [data-team-thread] [class*="workSection"], [data-team-thread] [class*="riskSection"],
    [data-team-thread] [class*="timelineContent"] { max-width: none; }
  ` })
  await page.waitForTimeout(400)
  const boundary = { wide: await edges(page) }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForTimeout(600)
  boundary.desktop = await edges(page)

  await writeFile(join(LOCAL, `column-${LABEL}.json`), `${JSON.stringify({ centered, boundary }, null, 1)}\n`)
  console.log(`COLUMN ${LABEL} written`)
  console.log(JSON.stringify({ centered, boundary }, null, 1))
  expect(consoleWatch.pageErrors.length).toBe(0)
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
}, 600_000)
