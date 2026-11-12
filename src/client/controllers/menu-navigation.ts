export function navigateMenu(dx: number, dy: number, confirm: boolean, back: boolean) {
  const active = document.activeElement as HTMLElement | null;
  if (confirm) {
    if (
      active instanceof HTMLInputElement &&
      (active.type === 'radio' || active.type === 'checkbox')
    ) {
      active.click();
      active.dispatchEvent(new Event('change', { bubbles: true }));
    } else active?.click();
    return;
  }
  if (back) {
    const details = active?.closest('details');
    if (details?.open) {
      details.open = false;
      details.querySelector('summary')?.focus();
      return;
    }
    const button = document.querySelector<HTMLButtonElement>(
      '#map-editor [data-action=close],#room:not([hidden]) #leave',
    );
    button?.click();
    return;
  }
  if (!dx && !dy) return;
  if (active instanceof HTMLSelectElement && dx) {
    active.selectedIndex = Math.max(
      0,
      Math.min(active.options.length - 1, active.selectedIndex + dx),
    );
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (active instanceof HTMLInputElement && active.type === 'number' && dx) {
    if (dx > 0) active.stepUp();
    else active.stepDown();
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const container = document.querySelector('#map-editor') ?? document;
  const elements = [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]',
    ),
  ].filter(
    (e) =>
      e.getClientRects().length &&
      getComputedStyle(e).visibility !== 'hidden' &&
      !e.closest('[hidden]'),
  );
  const index = elements.indexOf(active!);
  elements[index < 0 ? 0 : (index + (dy || dx) + elements.length) % elements.length]?.focus();
}
