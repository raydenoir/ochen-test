export function fitArtboard(availableWidth: number, availableHeight: number, width: number, height: number) {
  if (availableWidth <= 0 || availableHeight <= 0 || width <= 0 || height <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(availableWidth / width, availableHeight / height);
  return { width: width * ratio, height: height * ratio };
}
