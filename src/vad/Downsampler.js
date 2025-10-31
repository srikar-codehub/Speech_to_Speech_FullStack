export default function createDownsampler(sourceSampleRate, targetSampleRate) {
  if (!sourceSampleRate || !targetSampleRate) {
    throw new Error('Sample rates must be provided for the downsampler');
  }

  const rateStep = sourceSampleRate / targetSampleRate;
  let fractionalIndex = 0;
  let lastSample = 0;

  return {
    process(chunk) {
      if (!chunk || chunk.length === 0) {
        return new Float32Array(0);
      }

      const results = [];
      let position = fractionalIndex;
      const chunkLength = chunk.length;

      while (position < chunkLength) {
        const baseIndex = Math.floor(position);
        const ratio = position - baseIndex;

        const leftSample = baseIndex >= 0 ? chunk[baseIndex] : lastSample;
        const rightSample =
          baseIndex + 1 < chunkLength ? chunk[baseIndex + 1] : chunk[chunkLength - 1];

        results.push(leftSample + (rightSample - leftSample) * ratio);
        position += rateStep;
      }

      fractionalIndex = position - chunkLength;
      lastSample = chunk[chunkLength - 1];

      return Float32Array.from(results);
    },
  };
}
