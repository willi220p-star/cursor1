import type { Contact, StudioConfig } from './types';

export type CopyVariant = 'A' | 'B';

/**
 * Which half of an A/B split a row falls in. Pure and stable: it reads only the row number the
 * importer gave the contact, so odd rows are A and even rows are B however the list is sorted,
 * filtered or regenerated. Consecutive rows alternate, which gives an exact 50/50 split on any
 * even-sized list (and one extra A on an odd one).
 */
export function variantFor(contact: Pick<Contact, 'row'>): CopyVariant {
  const row = Math.trunc(Number(contact.row));
  if (!Number.isFinite(row)) return 'A';
  return Math.abs(row) % 2 === 0 ? 'B' : 'A';
}

/** Variant B is live when it is switched on and has words of its own. */
export function variantBActive(config: Pick<StudioConfig, 'copyVariantB'>) {
  return Boolean(config.copyVariantB?.copy.trim());
}

/** The variant this row actually gets: always A unless variant B is live. */
export function rowVariant(config: Pick<StudioConfig, 'copyVariantB'>, contact: Pick<Contact, 'row'>): CopyVariant {
  return variantBActive(config) ? variantFor(contact) : 'A';
}

/**
 * The config to render this row with. A rows (and every row when B is off) get the same object
 * back, so React memo and effect dependencies stay stable. B rows get the B copy, and the B P.S.
 * when one is set (no B P.S. means the row keeps variant A's P.S.).
 */
export function configForRow<T extends StudioConfig>(config: T, contact: Pick<Contact, 'row'>): T {
  if (rowVariant(config, contact) !== 'B' || !config.copyVariantB) return config;
  const variant = config.copyVariantB;
  return {
    ...config,
    copy: variant.copy,
    postscript: variant.postscript ?? config.postscript,
    openerId: variant.openerId,
  };
}

/** Opener library id behind this row's copy, or 'custom' when it was written or templated by hand. */
export function openerFor(config: Pick<StudioConfig, 'copyVariantB' | 'openerId'>, contact: Pick<Contact, 'row'>) {
  const id = rowVariant(config, contact) === 'B' ? config.copyVariantB?.openerId : config.openerId;
  return id || 'custom';
}
