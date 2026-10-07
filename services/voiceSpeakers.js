/**
 * Five Bulbul v3 speakers that sound natural in Odia.
 * Ids must stay lowercase. Odia picks: shubh (male), ritu (female);
 * priya and ishita are the other reliable female voices, ratan the second male.
 */

const VOICES = [
  { id: 'priya', gender: 'female', name: 'Priya', pace: 1.02 },
  { id: 'ishita', gender: 'female', name: 'Ishita', pace: 1.08 },
  { id: 'ritu', gender: 'female', name: 'Ritu', pace: 0.98 },
  { id: 'shubh', gender: 'male', name: 'Shubh', pace: 1.0 },
  { id: 'ratan', gender: 'male', name: 'Ratan', pace: 0.96 },
];

const SAMPLE_LINE = 'ନମସ୍କାର, ମୁଁ ଉତ୍କଳ। କହନ୍ତୁ, ମୁଁ ଶୁଣୁଛି।';

function resolveVoice(id) {
  return VOICES.find((voice) => voice.id === String(id || '').toLowerCase()) || VOICES[0];
}

module.exports = { VOICES, SAMPLE_LINE, resolveVoice };
