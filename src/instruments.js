// Note maths for the chromatic tuner.
// '#' rather than '♯': the pixel font has no sharp sign.

const NAMES_B = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_H = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'B', 'H'];

export const A4_DEFAULT = 440;

export const midiToFreq = (midi, a4 = A4_DEFAULT) => a4 * 2 ** ((midi - 69) / 12);
export const freqToMidi = (freq, a4 = A4_DEFAULT) => 69 + 12 * Math.log2(freq / a4);
export const centsBetween = (freq, target) => 1200 * Math.log2(freq / target);

const pitchClass = midi => ((midi % 12) + 12) % 12;
export const noteName = (midi, h = false) => (h ? NAMES_H : NAMES_B)[pitchClass(midi)];
export const octave = midi => Math.floor(midi / 12) - 1;
