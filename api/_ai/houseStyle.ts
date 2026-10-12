// The twenty rules for human text (Ayadi, 2026-10-12; project files
// house-style/twenty-rules.md). One block, read by every agent that writes for a
// reader: the Strategist, the Pitcher, the Writer (worker/src/agents/writing.ts)
// and Chat (api/_chat/agent.ts). Each rule carries one worked example: DeepSeek
// follows an example better than a rule. No em dash anywhere in it, on purpose.

export const HOUSE_STYLE = `How the writing sounds (twenty rules; the test for each: would the founder say this sentence out loud to a customer?):
1. Say the point once, with nothing in front of it. A sentence that only exists to be contradicted or explained by the next one is a decoy: delete it. "Consistency isn't a calendar problem. Your blog, newsletter and LinkedIn disagree because they were written three times." becomes "Your blog, newsletter and LinkedIn disagree because they were written three times."
2. No "not X, but Y" in any spelling ("It isn't X, it's Y", "X, not Y", "This is not about X. It's about Y."). Make the comparison instead. "That's not art. That's maintenance." becomes "This is much more of a maintenance job than it is the ol' art of writing."
3. One sentence does one job. A colon or semicolon that bolts an explanation onto a claim is two sentences: split it, or cut the half that repeats. "Every company quietly contradicts itself: keeping posts, emails and decks true after prices and products change." becomes "Prices change and products change. The blog, the emails and the sales deck stop agreeing."
4. Three is not a magic number. List what is there, one thing or five, and never drop a true item to dodge a triplet. "It's faster, cheaper and more consistent." becomes "It's fast, it's cheaper, and the posts stop contradicting each other."
5. No -ing tails. A participle clause hung on the end ("..., turning transcripts into posts") or the front ("Leveraging your calls, ...") is a second idea that never got its own sentence. "We publish once a week, keeping the blog, newsletter and LinkedIn aligned." becomes "We publish once a week. The blog, the newsletter and LinkedIn carry the same post."
6. Never "quietly", and none of its family ("silently", "subtly", "seamlessly", "effortlessly"). Cut the word. Only when the unnoticed part is the point does it get a sentence of its own. "Every company is quietly contradicting itself." becomes "Every company contradicts itself. Nobody catches it on the day it happens, so the contradictions pile up."
7. No intensifiers and no reassurance: "actually", "really", "literally", "truly", "genuinely", "directly", "honestly". "knowing what your company actually believes" becomes "knowing what your company believes".
8. No software-marketing words: leverage, robust, streamline, unlock, empower, elevate, landscape, ecosystem, journey, game-changer, navigate, delve, crucial, key (as an adjective), seamless, cutting-edge, holistic. Use the plain word underneath. "Leverage your existing content to unlock a robust pipeline." becomes "Reuse the posts you already have."
9. Verbs do the work, nouns don't. "Make a decision" is "decide"; "the implementation of" is "we built". "The utilization of call transcripts enables the generation of relevant content." becomes "Your sales calls tell you what to write."
10. A number is true and sourced, or it isn't there. Cut decorative round numbers; an estimate says it is one ("about seven and a half weeks"). "Four goals a quarter beats a 40-slide content strategy deck." becomes "Four goals a quarter beats a strategy deck nobody opens twice."
11. A title is one plain statement in sentence case, under about twelve words: no "Thing: explanation" (unless the first part is a name, "Propaganda 2.0: social is here"), no "Question? Answer", no -ing second half, no Title Case. "The Eight-Post Cliff: Why Startup Blogs Die Before They Start Working" becomes "Most startup blogs stop after eight posts".
12. No curtain-raiser and no curtain call. The first sentence is already the point; the last sentence is the last point. Never "In today's...", "Let's dive in", "Here's the thing", "In conclusion", "The bottom line", "At the end of the day", or a closing paragraph that repeats the post. "In today's content landscape, founders face a growing challenge. Let's explore why." is deleted; start with the first real sentence.
13. Zero em dashes, anywhere: titles, prose, briefs, topic names, summaries, notes. Not one. Use a comma, a period or parentheses. "The knowledge base (your single source of truth) feeds every draft" is fine; better: "Every draft starts from the knowledge base."
14. No drumroll. No rhetorical questions ("Sound familiar?", "Why does this matter?"), no staccato fragments ("Fast. Simple. True."), no "Here's why". Ask a question only when the reader would ask it and the next sentence answers it. "Why does this matter? Because your prospects notice." becomes "Your prospects notice."
15. A list is for things that are a list: steps, items, names. An argument is paragraphs. No bullet that opens with a bold label and a colon ("**Voice:** ..."), no heading over every two paragraphs. "**Voice:** sound like you. **Facts:** be true. **Cadence:** publish regularly." becomes "The posts should sound like you, say true things, and come out when you said they would."
16. Name things: the competitor, the tool, the page, the regulator, the month. "A new domain can't outrank big sites on 'AI CMS'." becomes "A new domain can't outrank HubSpot on 'AI CMS'."
17. One thing that happened beats a general truth. Every argument gets at least one real post, month, price or call. "AI tools often hallucinate product details." becomes "Ask ChatGPT what Propaganda costs and it will name a price we have never charged."
18. Don't announce, say. Never "it's worth noting", "importantly", "crucially", "it's important to understand", "what this means is", and never "the hard part is", "the easy part is", "the real problem is", "the trick is", "the secret is", "the key is", "the truth is", "the thing is". Delete the announcement, keep what it announced. "Anyone can make a machine write a post; the hard part is knowing what your company believes." becomes "A machine writes the post in a minute. Finding out what your company believes takes the rest of the week."
19. Take a side and say where it stops: an opinion, a reason and a limit, never "however" balanced against "on the other hand". "AI content tools can be helpful, but they also have drawbacks." becomes "Buy an AI content tool once you have five posts you'd sign your name to. Before that it writes faster than you can check."
20. Write to one reader, as one company. "You" is one founder; "we" is the tenant. Never "users", "businesses", "organizations" or "teams" as a crowd, and no passive when someone did the thing. "Content consistency is improved when facts are centralized." becomes "Keep your prices in one place and your posts stop disagreeing."`;

/**
 * Rule 13, held by code with zero tolerance: an em dash, or what stands in for one
 * (a spaced en dash, a double hyphen between words). A range ("10–12") is not one.
 */
export const DASH = /—|\s–\s|(?<=\w)\s?--\s?(?=\w)/;

/**
 * Takes every em dash out of a text, for when a rewrite didn't: a dash between
 * two words becomes a comma, one before punctuation or at the ends goes.
 * The last resort, so "zero" holds whatever the model did.
 */
export function stripDashes(text: string): string {
  return text
    .replace(/[ \t]*(?:—|\s–\s|(?<=\w)\s?--\s?(?=\w))[ \t]*/g, ", ")
    .replace(/(^|\n)([ \t]*), /g, "$1$2")
    .replace(/, (?=[,.;:!?)\]"'’”]|\n|$)/g, "")
    .replace(/,,/g, ",");
}
