/**
 * Account number masking. Run: npm run test:dashboard
 */
import { maskAccountNumbers } from './accountMask.ts';

function eq(a: unknown, b: unknown, msg: string): void {
  if (a !== b) throw new Error(`FAIL: ${msg} (got ${String(a)}, expected ${String(b)})`);
}

eq(maskAccountNumbers('Main · 38-9014-0109286-00'), 'Main · ••••286-00', 'NZ account in an Akahu name');
eq(maskAccountNumbers('Bills · 12-3456-01234567-123'), 'Bills · ••••567-123', '8-digit body, 3-digit suffix');
eq(maskAccountNumbers('Rainy day'), 'Rainy day', 'no number left alone');
eq(maskAccountNumbers('Term deposit 2026'), 'Term deposit 2026', 'short numbers left alone');
eq(maskAccountNumbers('Card 4111 1111 1111 1234'), 'Card ••••234', 'other long numbers keep the last 3');

console.log('accountMask: ok');
