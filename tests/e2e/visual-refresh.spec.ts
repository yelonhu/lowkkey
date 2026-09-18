import { test, expect, openWorkspace } from './fixtures.ts';
import { workspaceLocale } from '../../src/i18n/workspace-resources.ts';

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const parts = color.match(/[0-9.]+/g)!.slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return parts[0]! * .2126 + parts[1]! * .7152 + parts[2]! * .0722;
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('visual refresh keeps readable themes, numeric typography and accessible layouts', async ({ page }, info) => {
  test.setTimeout(90_000);
  const text = workspaceLocale(info.project.name === 'en' ? 0 : info.project.name === 'zh-Hans' ? 1 : 2);
  // Keep repeated regression runs out of the archived visual review directory.
  const prefix = info.outputPath(info.project.name);
  await page.goto('/');
  await expect(page.locator('.login-screen h1')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 850 });
  await page.screenshot({animations:'disabled', path: prefix + '-login.png', fullPage: true });
  await openWorkspace(page, info.project.name);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    for (const width of [320, 375, 430, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('.brand').click();
      await expect(page.locator('.overview-heading h1')).toHaveText(text.today!.title!);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const colors = await page.locator('[data-artifact=WeightArtifact]').evaluate(card => {
        const root = getComputedStyle(document.documentElement), style = getComputedStyle(card), muted = getComputedStyle(card.querySelector('.muted')!);
        const action = getComputedStyle(card.querySelector('.card-action')!);
        const toRgb = (value: string) => { const node = document.createElement('span'); node.style.color = value; card.append(node); const color = getComputedStyle(node).color; node.remove(); return color; };
        return { ink: style.color, surface: style.backgroundColor, canvas: root.backgroundColor, muted: muted.color, accent: toRgb(root.getPropertyValue('--accent')), accentEnd: toRgb(root.getPropertyValue('--accent-end')), buttonText: toRgb(root.getPropertyValue('--accent-text')), actionText: action.color, shadow: style.boxShadow, border: style.borderTopWidth, radius: style.borderTopLeftRadius };
      });
      expect(contrast(colors.ink, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.muted, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.muted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.buttonText, colors.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.buttonText, colors.accentEnd)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors.actionText, colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(colors.shadow).not.toBe('none'); expect(colors.border).toBe('0px'); expect(colors.radius).toBe('24px');
      await expect(page.locator('h1')).not.toHaveCSS('font-family', /Georgia|Songti|, serif(?:,|$)/);
      await expect(page.locator('.overview-heading time')).toHaveCSS('font-variant-numeric', /tabular-nums/);
      await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-' + width + '-overview.png', fullPage: true });
      await page.locator('[data-artifact=WeightArtifact]').click();
      const input = page.locator('#weight-value');
      await expect(page.locator('.daily-weight')).toHaveAttribute('data-draft-ready','true');
      if (!await input.isVisible()) await page.getByTestId('weight-reading').click();
      await expect(input).toBeVisible();
      await input.fill('500.000');
      await expect(input).toHaveCSS('font-family', /monospace|Mono|Menlo/);
      for (const selector of ['#weight-value', '.daily-heading input', '.weight-reading select', '.weight-more', '.chat-button']) {
        const bounds = await page.locator(selector).boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      // Large precision values may scroll inside the focused numeric field, never the page.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await input.fill(''); await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-' + width + '-weight.png', fullPage: true });
      await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-' + width + '-weight-form.png' });
    }
    await page.setViewportSize({ width: 320, height: 850 });
    await page.locator('#weight-value').fill('34,3'); await page.locator('.daily-heading h1').click();
    const alert = page.locator('.weight-hero [role=alert]'); await expect(alert).toBeVisible();
    const errorColors = await alert.evaluate(element => ({ text: getComputedStyle(element).color, surface: getComputedStyle(document.documentElement).backgroundColor }));
    expect(contrast(errorColors.text, errorColors.surface)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-error.png', fullPage: true });
    await page.locator('#weight-value').fill('');
    await page.locator('.avatar').click(); await expect(page.locator('.settings-panel')).toBeVisible();
    await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-settings.png', fullPage: true });
    await page.locator('.chat-button').click(); await expect(page.locator('.conversation')).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.conversation')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.chat-button')).toHaveCSS('transition-duration', '0s');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
    await page.screenshot({animations:'disabled', path: prefix + '-' + theme + '-conversation.png', fullPage: true });
    await page.locator('.conversation .back-link').click();
  }
});
