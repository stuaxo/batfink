// Screen grabs: a PNG still, or a WebM clip of the running canvas.

export function screenshot(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export interface Recorder {
  stop(): Promise<Blob>;
}

/** Start recording `canvas`. Returns null if the browser has no MediaRecorder. */
export function record(canvas: HTMLCanvasElement, fps = 50): Recorder | null {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
        rec.stop();
      }),
  };
}
