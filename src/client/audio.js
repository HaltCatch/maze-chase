import { weaponSounds } from '../shared/arsenal.ts';

export function createGameAudio(getYaw) {
  let audio,
    footSamples,
    breathBuffer,
    breath,
    breathLevel = 0;
  const audioClips = new Map();
  function stopBreathing() {
    if (!breath) return;
    breath.source.stop();
    breath = undefined;
    breathLevel = 0;
  }
  function updateBreathing(active, serverSelf) {
    if (audio?.state !== 'running' || !breathBuffer) return;
    const effort = 1 - serverSelf.energy;
    const level =
      active && serverSelf.alive
        ? serverSelf.exhausted
          ? 0.055
          : Math.max(0, effort - 0.47) * 0.075
        : 0;
    if (!breath && level > 0) {
      const source = audio.createBufferSource(),
        gain = audio.createGain();
      source.buffer = breathBuffer;
      source.loop = true;
      gain.gain.value = 0;
      source.connect(gain).connect(audio.destination);
      source.start();
      breath = { source, gain };
    }
    if (breath && Math.abs(level - breathLevel) > 0.003) {
      breathLevel = level;
      breath.gain.gain.setTargetAtTime(level, audio.currentTime, 0.24);
    }
  }
  function playSample(sample, level, bearing, cutoff = 12000, rate = 1) {
    if (!sample || audio?.state !== 'running') return;
    const source = audio.createBufferSource(),
      volume = audio.createGain();
    const pan = audio.createStereoPanner(),
      filter = audio.createBiquadFilter();
    source.buffer = sample;
    source.playbackRate.value = rate;
    volume.gain.value = level;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    pan.pan.value = Number.isFinite(bearing) ? Math.sin(getYaw() - (bearing * Math.PI) / 4) : 0;
    source.connect(filter).connect(volume).connect(pan).connect(audio.destination);
    source.start();
  }
  function footstep(sound) {
    if (!footSamples) return;
    const sample = footSamples[Math.floor(Math.random() * footSamples.length)];
    playSample(
      sample,
      (sound.stairs ? 0.26 : sound.heavy ? 0.37 : 0.22) * (sound.gain ?? 1),
      sound.bearing,
      sound.stairs ? 6500 : sound.heavy ? 1300 : 4600,
      (sound.heavy ? 0.86 : 1) + Math.random() * 0.1,
    );
  }
  async function loadSample(name) {
    const response = await fetch('/assets/' + name + '.mp3');
    if (!response.ok) throw new Error('Audio sample unavailable: ' + name);
    return audio.decodeAudioData(await response.arrayBuffer());
  }
  function resume() {
    if (!audio) {
      audio = new AudioContext();
      loadSample('breath')
        .then((sample) => {
          breathBuffer = sample;
        })
        .catch(console.warn);
      Promise.all([0, 1, 2, 3].map((i) => loadSample('step-' + i)))
        .then((samples) => {
          footSamples = samples;
        })
        .catch(console.warn);
      for (const name of new Set([
        'score',
        'fall-scream',
        ...Object.values(weaponSounds).flatMap(Object.values),
      ])) {
        loadSample(name)
          .then((sample) => audioClips.set(name, sample))
          .catch(console.warn);
      }
    }
    audio.resume().catch(() => {});
  }
  return {
    resume,
    stopBreathing,
    updateBreathing,
    footstep,
    play: (name, ...args) => playSample(audioClips.get(name), ...args),
  };
}
