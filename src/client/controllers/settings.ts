import type { InputController } from './input.ts';
/** Browser preferences only; device discovery/polling remains Babylon GamepadManager. */
export function bindControlSettings(input: InputController) {
  const form = document.getElementById('controller-settings')!;
  const read = () => {
    const sensitivity = Number(
      (form.querySelector('[name=sensitivity]') as HTMLSelectElement).value,
    );
    const deadZone = Number((form.querySelector('[name=dead-zone]') as HTMLSelectElement).value);
    const invertY = (form.querySelector('[name=invert-y]') as HTMLInputElement).checked;
    const immersive = (form.querySelector('[name=immersive]') as HTMLInputElement).checked;
    input.settings = { sensitivity, deadZone, invertY, immersive };
    try {
      localStorage.setItem('maze-controller', JSON.stringify(input.settings));
    } catch {
      /* Private browsing can deny storage. */
    }
  };
  try {
    const saved = JSON.parse(localStorage.getItem('maze-controller') ?? 'null');
    if (saved) {
      if ([0.6, 1, 1.4, 1.8].includes(saved.sensitivity))
        (form.querySelector('[name=sensitivity]') as HTMLSelectElement).value = String(
          saved.sensitivity,
        );
      if ([0.1, 0.16, 0.24].includes(saved.deadZone))
        (form.querySelector('[name=dead-zone]') as HTMLSelectElement).value = String(
          saved.deadZone,
        );
      (form.querySelector('[name=invert-y]') as HTMLInputElement).checked = saved.invertY === true;
      (form.querySelector('[name=immersive]') as HTMLInputElement).checked =
        saved.immersive !== false;
    }
  } catch {
    /* Invalid stored settings fall back to the form defaults. */
  }
  form.addEventListener('change', read);
  read();
}
