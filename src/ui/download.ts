// Hand the browser a file to save.
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(name: string, data: Uint8Array, type = 'application/octet-stream'): void {
  downloadBlob(name, new Blob([data as BlobPart], { type }));
}
