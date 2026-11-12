export function log(level, event, fields = {}) {
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  output(JSON.stringify({ level, time: new Date().toISOString(), event, ...fields }));
}
