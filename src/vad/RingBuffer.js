export default function createRingBuffer(size) {
  if (!size || size < 1) {
    throw new Error('Ring buffer needs a positive size');
  }

  const buffer = new Array(size).fill(0);
  let index = 0;
  let filled = 0;

  return {
    push(value) {
      buffer[index] = value;
      index = (index + 1) % size;
      if (filled < size) {
        filled += 1;
      }
    },
    sum() {
      let total = 0;
      for (let i = 0; i < filled; i += 1) {
        total += buffer[i];
      }
      return total;
    },
    average() {
      return filled === 0 ? 0 : this.sum() / filled;
    },
    clear() {
      buffer.fill(0);
      index = 0;
      filled = 0;
    },
    size() {
      return filled;
    },
  };
}
