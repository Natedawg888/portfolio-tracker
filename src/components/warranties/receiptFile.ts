/** Reading a receipt file for upload, and error text for the Warranties page. */

export function errText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

export function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_RECEIPT_BYTES) {
      reject(new Error('Receipt must be 8 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
