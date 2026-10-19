/**
 * Broker quotes for the public /see page ("From the brokers who use it").
 * The section stays hidden while this list is empty. Add only quotes a broker
 * has agreed to have published, e.g.
 *   { quote: "…", name: "First Last", brokerage: "Brokerage Name" },
 */
export type SeeQuote = { quote: string; name: string; brokerage: string };

export const SEE_QUOTES: SeeQuote[] = [];
