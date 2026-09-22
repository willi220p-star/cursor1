import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export { publicAssetUrl } from './public-url';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
