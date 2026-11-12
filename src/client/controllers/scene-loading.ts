/** Race engine readiness against native cancellation: disposed Babylon scenes may
 * never resolve whenReadyAsync(), so leaving must release the next scene load. */
export async function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: () => void;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([task, stopped]);
  } finally {
    signal.removeEventListener('abort', cancel!);
  }
}

/** Give loading UI a paint opportunity, without deadlocking when a visible tab
 * becomes backgrounded between animation frames. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let frame = 0;
    const finish = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    };
    const timer = setTimeout(finish, document.hidden ? 0 : 100);
    if (!document.hidden)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(finish);
      });
  });
}
