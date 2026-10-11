/** Phrases that mark copy as machine-written filler. Used by the copy test and the cached-output scan. */
const PHRASES = [
  "delve[sd]?", "delving", "landscapes?", "nuanced", "multifaceted", "robust(ly|ness)?", "navigat(e|es|ed|ing)", "crucial(ly)?", "pivotal",
  "key factors?", "it(’|')?s important to note", "it(’|')?s worth noting", "in conclusion", "ultimately", "overall",
  "only time will tell", "it remains to be seen", "a confluence of", "a myriad of", "plays? a role", "double-edged", "game-?changer",
  "unprecedented", "tapestry", "realms?", "underscores?", "highlights the importance",
  "revolutionary", "seamless(ly)?", "cutting-edge", "next-generation", "state-of-the-art", "leverag(e|es|ed|ing)", "harness(es|ed|ing)?",
  "unlock(s|ed|ing)?", "empower(s|ed|ing)?", "supercharg(e|es|ed|ing)", "effortless(ly)?", "powerful",
];
export const BANNED: RegExp[] = PHRASES.map((p) => new RegExp(`\\b${p}\\b`, "i"));

export function bannedHits(text: string): string[] {
  const hits: string[] = [];
  for (const re of BANNED) {
    const m = text.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
