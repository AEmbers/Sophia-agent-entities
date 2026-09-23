// Measures the taskless Thread header: the anchor message is clamped to one
// line, so the band must not grow with the message's length.
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
const SHOTS = join(LOCAL, `taskless-${LABEL}`)

const LONG = '给 @Iris 交接 claim 面板优化（源头 thread:2e57e4fc）：human 9/13-14 的需求是优化 task thread 下 claim 面板、顺带审视 channel/thread 顶层栏，原截图已清理；human 还要求先看预览再决定方案。'
const SHORT = '短消息'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined

async function band(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100
    const title = document.querySelector<HTMLElement>('[data-team-thread] [class*="taskTitle"]')
    const head = document.querySelector<HTMLElement>('[data-team-thread] > div:first-child')
    const anchor = document.querySelector<HTMLElement>('[data-team-thread] [class*="timelineContent"]')
    const titleRect = title?.getBoundingClientRect()
    return {
      band: head === null ? null : round(head.getBoundingClientRect().height),
      taskTitle: title === null || titleRect === undefined ? null : {
        h: round(titleRect.height),
        lines: round(titleRect.height / Number.parseFloat(getComputedStyle(title).lineHeight)),
        clamp: getComputedStyle(title).webkitLineClamp,
        // The visible text must fit the clamped box, and the title keeps it all.
        scrollW: title.scrollWidth, clientW: title.clientWidth,
        full: title.getAttribute('title'),
        text: (title.textContent ?? '').slice(0, 40),
      },
      title: (document.querySelector('[data-team-thread] h1')?.textContent ?? '').slice(0, 20),
      timelineText: (anchor?.textContent ?? '').slice(0, 60),
    }
  })
}

async function seed(page: Page, message: string): Promise<void> {
  const composer = page.getByRole('textbox', { name: '消息内容' })
  await composer.waitFor({ timeout: 30_000 })
  await composer.fill(message)
  await page.getByRole('button', { name: '发送' }).click()
}

it('clamps the taskless Thread opener to one line', async () => {
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
  await channelDialog.getByLabel('说明').fill('taskless 顶层栏')
  await channelDialog.getByRole('button', { name: '创建频道' }).click()
  await page.getByRole('button', { name: '# ux' }).click()

  // One Channel message carrying a long anchor becomes one taskless Thread.
  await seed(page, LONG)
  const entry = page.locator('[data-team-channel] [data-thread-entry] > button').first()
  await entry.waitFor()
  await entry.click()
  await page.getByRole('button', { name: '返回频道' }).waitFor()
  await page.waitForTimeout(500)
  const long = await band(page)
  await page.locator('[data-team-thread] > div:first-child').screenshot({ path: join(SHOTS, 'taskless-long-desktop.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(700)
  const longNarrow = await band(page)
  await page.locator('[data-team-thread] > div:first-child').screenshot({ path: join(SHOTS, 'taskless-long-narrow.png') })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForTimeout(700)

  // A second, short Thread proves the band is the same height either way.
  await page.getByRole('button', { name: '返回频道' }).click()
  await seed(page, SHORT)
  const second = page.locator('[data-team-channel] [data-thread-entry] > button').nth(1)
  await second.waitFor()
  await second.click()
  await page.waitForTimeout(500)
  const short = await band(page)

  await writeFile(join(LOCAL, `taskless-${LABEL}.json`), `${JSON.stringify({ long, longNarrow, short }, null, 1)}\n`)
  console.log(JSON.stringify({ long, longNarrow, short }, null, 1))
  expect(consoleWatch.pageErrors.length).toBe(0)
  await browser?.close(); browser = undefined
  await scaffold?.close(); scaffold = undefined
}, 600_000)
