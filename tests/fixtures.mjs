// Shared mock data for the Node and PHP collector tests.
export const today = new Date(), iso = d => d.toISOString().slice(0, 10), plus = n => iso(new Date(today.getTime() + n * 864e5));
export const rss = items => `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>t</title>${items.map(i => `<item><title>${i[0]}</title><link>${i[1]}</link><pubDate>${new Date(today.getTime() - (i[3] ?? 1) * 36e5).toUTCString()}</pubDate><description>${i[2] ?? ""}</description></item>`).join("")}</channel></rss>`;
export const FEEDS = {
  "/news.xml": rss([["Hmong families in Minnesota fear ICE detention after new rule", "https://ex.com/a1", "Advocates in Minneapolis say H.R. 1234 would help.", 2], ["Stocks rise in Tokyo as Japan central bank holds rates", "https://ex.com/a2", "Markets in Japan", 3], ["Chinese American voters in Houston turn out early for midterms", "https://ex.com/a3", "", 4], ["美国华裔选民在休斯顿提前投票", "https://ex.com/zh", "", 5], ["Familias hmong temen detenciones por el ICE en Minnesota para votar", "https://ex.com/es", "", 5]]),
  "/statement.xml": rss([["Statement on the Compact of Free Association funding for Guam and Marshallese families", "https://org.example/s1", "We urge Congress to pass S. 55 now.", 1]]),
};
// A WordPress feed as The Yappie serves it: the editor's excerpt comes first, WordPress adds "The post ... appeared first on ..." after it,
// and the featured image is repeated at the top of the body (as another size of the same file).
const wpPost = (n, title, excerpt, lead, hero, by = "A Writer", cats = [], hrs = n) => `<item><title>${title}</title><link>https://yp.example/${n}/</link><dc:creator><![CDATA[${by}]]></dc:creator><pubDate>${new Date(today.getTime() - hrs * 36e5).toUTCString()}</pubDate>${cats.map(c => `<category><![CDATA[${c}]]></category>`).join("")}<description><![CDATA[${excerpt ? `<p>${excerpt}</p>\n` : ""}<p>The post <a href="https://yp.example/${n}/">${title}</a> appeared first on <a href="https://yp.example">The Yappie</a>.</p>\n]]></description><content:encoded><![CDATA[${lead}<p class="wp-block-paragraph">First paragraph of ${title}.</p><p>Second paragraph.</p><p>The post office closures follow cuts announced Monday.</p>\n<p>The post <a href="https://yp.example/${n}/">${title}</a> appeared first on <a href="https://yp.example">The Yappie</a>.</p>]]></content:encoded><media:thumbnail url="${hero}" width="1024" height="" /></item>`;
const fig = (u, cap) => `<figure><img src="https://yp.example/wp-content/uploads/${u}" alt="" />${cap ? `<figcaption>${cap}</figcaption>` : ""}</figure><br />\n`;
FEEDS["/yappie.xml"] = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>The Yappie</title>${[
  wpPost(1, "Fixture Yappie: excerpt with footer", "A new bill would let wrongfully detained citizens sue the federal government for damages.", fig("2026/10/photo-one-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-one-1024x683.jpg"),
  wpPost(2, "Fixture Yappie: footer only", "", fig("2026/10/photo-two-scaled.png"), "https://yp.example/wp-content/uploads/2026/10/photo-two-1024x683.png"),
  wpPost(3, "Fixture Yappie: trimmed body text", "Community leaders in Honolulu said on Tuesday that they had gathered hundreds of residents at a rally […]", fig("2026/10/photo-three.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-three-1024x683.jpg"),
  wpPost(4, "Fixture Yappie: a different photo at the top", "The agency says the post office closures will hit Pacific Islander towns hardest this year.", fig("2026/10/other-photo.jpg"), "https://yp.example/wp-content/uploads/2026/10/cover-photo-1024x683.jpg"),
  wpPost(5, "Fixture Yappie: photo with a credit", "Organizers say turnout doubled from last year in Honolulu and across the islands.", fig("2026/10/photo-five-scaled.jpg", "Photo: A. Photographer"), "https://yp.example/wp-content/uploads/2026/10/photo-five-1024x683.jpg"),
  wpPost(6, "Fixture Yappie: staff byline", "A newsletter story under the staff byline.", fig("2026/10/photo-six-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-six-1024x683.jpg", "The Yappie Staff"),
  wpPost(7, "Fixture Yappie: author without a page link", "A story whose page names no author page.", fig("2026/10/photo-seven-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-seven-1024x683.jpg", "Nobody Linked"),
  wpPost(8, "Fixture Yappie: byline that starts with By", "A story by an author whose name starts with By.", fig("2026/10/photo-eight-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-eight-1024x683.jpg", "Byron Lee"),
  // categories: "excludeCategories" drops a story that has one of them, whatever its other categories are and however the name is capitalised
  wpPost(9, "Fixture Yappie: in the Press category", "A note from the editor.", fig("2026/10/photo-nine-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-nine-1024x683.jpg", "The Yappie Staff", ["Press", "Policy"]),
  wpPost(10, "Fixture Yappie: in the Newsletters category", "This week in AAPI news.", fig("2026/10/photo-ten-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-ten-1024x683.jpg", "The Yappie Staff", ["newsletters"]),
  wpPost(11, "Fixture Yappie: Policy and Politics categories", "A story with two ordinary categories.", fig("2026/10/photo-eleven-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/10/photo-eleven-1024x683.jpg", "A Writer", ["Policy", "Politics"]),
].join("")}</channel></rss>`;
// The feed's next pages (feed/?paged=2): page 2 reaches back past the day "keepSince" names (45 days ago), so page 3 must not be read.
const ypPage = items => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>The Yappie</title>${items.join("")}</channel></rss>`;
FEEDS["/yappie.xml?paged=2"] = ypPage([
  wpPost(21, "Fixture Yappie: page two, 35 days old", "Older than the usual 30 days, but after the keep-since day.", fig("2026/09/photo-21-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/09/photo-21-1024x683.jpg", "A Writer", ["Policy"], 35 * 24),
  wpPost(22, "Fixture Yappie: page two, Newsletters", "A newsletter on page two.", fig("2026/09/photo-22-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/09/photo-22-1024x683.jpg", "The Yappie Staff", ["Newsletters"], 36 * 24),
  wpPost(23, "Fixture Yappie: page two, before the keep-since day", "Older than the keep-since day.", fig("2026/09/photo-23-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/09/photo-23-1024x683.jpg", "A Writer", ["Policy"], 45 * 24),
]);
FEEDS["/yappie.xml?paged=3"] = ypPage([
  wpPost(31, "Fixture Yappie: page three should not be read", "Never asked for.", fig("2026/08/photo-31-scaled.jpg"), "https://yp.example/wp-content/uploads/2026/08/photo-31-1024x683.jpg", "A Writer", ["Policy"], 60 * 24),
]);
// Story pages of the fake Yappie site (the test shim sends https://yp.example/… to the mock server as /yp/…): the byline links to the author's page, as WordPress prints it ("by" + name, an avatar link with no text, the name).
export const yappiePage = path => {
  const link = (slug, name) => `<a href="https://yp.example/author/${slug}/" class="avatar"></a><a href="https://yp.example/author/${slug}/"><span>by</span><span>${name}</span></a><a href="/author/${slug}/">${name}</a>`;
  const by = /^(1|2|3|4|5|old)\/?$/.test(path) ? link("a-writer", "A Writer") : path === "8/" ? link("byron-lee", "Byron Lee") : "";
  return `<html><body><h1>Story ${path}</h1><div class="byline">${by}</div><a href="https://elsewhere.example/author/someone/">Someone else</a></body></html>`;
};
// Blocked outlets (sources.json "excludeHosts" and "excludeNames"). Google News shows a publisher's name, and the address only sometimes, so both are tested.
const gpub = (n, t, pub, url) => `<item><title>${t} - ${pub}</title><link>https://news.google.com/rss/articles/BLOCK${n}?oc=5</link><pubDate>${new Date(today.getTime() - n * 36e5).toUTCString()}</pubDate><source${url ? ` url="${url}"` : ""}>${pub}</source></item>`;
export const BLOCKED_PUBS = [
  ["Hoodline", "https://hoodline.com"], ["Vietnam.vn", "https://www.vietnam.vn"], ["dainikjagranmpcg.com", "https://www.dainikjagranmpcg.com"], ["Kelowna Daily Courier", ""], ["Kelowna Courier", ""], ["nationalenquirer.com", "https://www.nationalenquirer.com"],
  ["Sofascore", "https://www.sofascore.com"], ["US Resist News", ""], ["The National Constitution Center", "https://constitutioncenter.org"], ["History.com", "https://www.history.com"], ["Medium", "https://medium.com"],
];
FEEDS["/blocked-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[
  ...BLOCKED_PUBS.map(([pub, url], i) => gpub(40 + i, "Fixture block: Asian American story number " + (i + 1), pub, url)),
  gpub(60, "Fixture block: Asian American voters in Georgia", "The Allowed Gazette", "https://www.allowed.example"),
  gpub(61, "Fixture block: Asian American history project in Honolulu", "Historic Honolulu Gazette", ""),
  gpub(62, "Fixture block: Asian American writers circle meets", "Medium Rare Times", "https://mediumrare.example"),
].join("")}</channel></rss>`;
FEEDS["/blocked-direct.xml"] = rss([
  ["Fixture block: Asian American post on a www subdomain", "https://www.medium.com/@fixture/asian-american-post", "Asian American writers.", 40],
  ["Fixture block: Asian American post on a blog subdomain", "https://blog.history.com/asian-american-history", "Asian American history.", 41],
  ["Fixture block: Asian American post on a look-alike site", "https://notmedium.com/asian-american-post", "Asian American writers.", 42],
  ["Fixture block: Asian American post with the name in the path", "https://allowed.example/medium.com/asian-american", "Asian American news.", 43],
]);
// Country domains, routes, .gov moves and the headline test (sources.json "blockForeignDomains", "routes", "trustedOutlets", "communityPattern").
const gnew = (n, t, pub, url) => `<item><title>${t} - ${pub}</title><link>https://news.google.com/rss/articles/NEW${n}?oc=5</link><pubDate>${new Date(today.getTime() - n * 36e5).toUTCString()}</pubDate><source${url ? ` url="${url}"` : ""}>${pub}</source></item>`;
FEEDS["/new-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[
  ["Asian American group on a .ca site", "Maple Daily Fixture", "https://www.maple.ca"], ["Asian American group on a .co.uk site", "Thames Post Fixture", "https://www.thamespost.co.uk"],
  ["Asian American group on a .com.au site", "Harbour Herald Fixture", "https://harbour.com.au"], ["Asian American group on a .uz site", "Tashkent Times Fixture", "https://tashkent.uz"],
  ["Asian American group on a .ch site", "Swiss Fixture Post", "https://www.swiss.ch"], ["Asian American group from a publisher named by its address", "Tashkent24.uz", ""],
  ["Asian American group from a publisher named in Arabic", "دزاير تيوب", ""],
  ["Asian American group on a .us site", "Eagle Gazette Fixture", "https://www.eagle.us"], ["Asian American group on a .gu site", "Guam Fixture Press", "https://fixture.gu"], ["Asian American group on a .com look-alike", "Canada Dry Fixture News", "https://canada.example.com"],
  ["Asian Law Caucus Statement: Fixture route", "Asian Law Caucus", "https://www.asianlawcaucus.org"],
  ["Asian American heritage events at national parks", "National Park Fixture Service", "https://www.nps.gov"],
  ["Guam beats Bahamas 1-0 in a Fixture friendly", "Random Sports Fixture Daily", "https://www.randomsports.example"],
  ["Chamorro language classes expand", "Random Sports Fixture Daily", "https://www.randomsports.example"],
  ["Guam harbor repairs resume", "The Guam Daily Post", "https://www.postguam.example"],
].map(([t, pub, url], i) => gnew(i + 1, "Fixture new: " + t, pub, url)).join("")}</channel></rss>`;
FEEDS["/new-direct.xml"] = rss([
  ["Fixture new: Asian American story on a .ca address", "https://news.example.ca/asian-american-story", "Asian American news.", 40],
  ["Fixture new: Asian American story on a .co.uk address", "https://www.bbc.co.uk/asian-american-story", "Asian American news.", 41],
  ["Fixture new: Asian American story on a .gu address", "https://paper.example.gu/asian-american-story", "Asian American news.", 42],
  ["Fixture new: Asian American story on a .us address", "https://paper.example.us/asian-american-story", "Asian American news.", 43],
  ["Fixture new: Asian American housing grants announced", "https://www.hud.gov/fixture-grants-n", "Grants for Asian American households.", 44],
  ["Fixture new: Housing grants for immigrant families", "https://www.hud.gov/fixture-grants-i", "Grants for families.", 45],
  ["Fixture new: Asian Law Caucus files a brief", "https://www.asianlawcaucus.org/news/fixture-brief", "The Asian Law Caucus filed a brief.", 46],
  ["Fixture new: Vietnamese Americans: a survey data snapshot", "https://paper.example.com/vn-americans", "A survey of Vietnamese Americans.", 47],
  ["Fixture new: Vietnam trade talks open in Hanoi", "https://paper.example.com/vn-trade", "Ministers met.", 48],
]);
// RNZ is allowed back through allowHosts for Pacific Islander stories that are not sports (gatedHosts); Pew is a research source with its own retention and relevance pattern.
const RNZ = "https://www.rnz.co.nz/international/pacific-news/";
FEEDS["/rnz.xml"] = rss([
  ["Fixture rnz: Pacific Islanders warn climate finance is failing island nations", RNZ + "f1", "Leaders say money is not reaching communities.", 4],
  ["Fixture rnz: Fiji government unveils new budget", RNZ + "f2", "Treasury figures were released on Friday.", 5],
  ["Fixture rnz: Samoa rugby side named for Pacific Nations Cup", RNZ + "f3", "The squad has two new caps.", 6],
  ["Fixture rnz: Cook Islands deep-sea mining talks continue", RNZ + "f4", "Officials met again this week.", 7],
  ["Fixture rnz: New Zealand election poll shows a tight race", RNZ + "f5", "The parties are level.", 8],
  ["Fixture rnz: Tongan netball star retires", RNZ + "f6", "A long career ends.", 9],
  ["Fixture rnz: Auckland council approves cycling lanes", RNZ + "f7", "Work starts in spring.", 10],
  ["Fixture rnz: Solomon Islands police drug squad makes arrests", RNZ + "f8", "Three people were charged.", 11],
  ["Fixture rnz: Boxing Day sales draw Pasifika shoppers in Auckland", RNZ + "f9", "Stores opened early.", 12],
  ["Fixture rnz: Council votes on housing", RNZ + "f10", "Members of the Pacific community spoke in favour.", 13],
  ["Fixture rnz: Fonua-Blake scores winner as Tonga beats Samoa", RNZ + "f11", "A tight finish.", 14],
  ["Fixture rnz: Super Typhoon Fixture: Marianas braces for a storm", RNZ + "f12", "Residents are preparing.", 15],
  ["Fixture rnz: Micronesian leaders urge people-first approach to US-China rivalry", RNZ + "f13", "Leaders spoke at a regional meeting.", 16],
  ["Fixture rnz: Samoan PM makes position clear on Israel", RNZ + "f14", "The prime minister spoke to reporters.", 17],
  ["Fixture rnz: Fiji PM delays vote on constitution bill after mounting pressure", RNZ + "f15", "Parliament will sit again next month.", 18],
  ["Fixture rnz: Marshallese deported by ICE struggle to settle", RNZ + "f16", "Families describe the first months.", 19],
  ["Fixture rnz: Australia commits US$10 million for Fiji's HIV response", RNZ + "f17", "The funding covers testing.", 20],
  ["Fixture rnz: Marshall Islands nuclear testing compensation claim revived", RNZ + "f18", "Advocates are preparing a petition.", 21],
]);
// Pacific island nations: a news story that names one without a tie to the U.S. is dropped (sources.json pacificNations, usTie, usTieCase); a trip or celebrity story that uses a Pacific place as a destination is dropped (travelPlaces, travelWords).
FEEDS["/pacnet.xml"] = rss([
  ["Fixture pac: Palau divers missing after an extensive search", "https://paper.example.com/pac-1", "Rescuers searched the reef.", 3],
  ["Fixture pac: Fiji police seize drugs at the port", "https://paper.example.com/pac-2", "Officers made three arrests.", 4],
  ["Fixture pac: Guam governor meets the Palau president", "https://paper.example.com/pac-3", "They discussed shipping links.", 5],
  ["Fixture pac: Tonga seeks Compact-style funding from Washington", "https://paper.example.com/pac-4", "Ministers travelled to the capital.", 6],
  ["Fixture pac: Kangnam, a TV star, describes an exhausting Guam trip experience", "https://paper.example.com/pac-5", "The entertainer talked about the heat.", 7],
  ["Fixture pac: Guam visitor arrivals rise as flights return", "https://paper.example.com/pac-6", "The tourism board released figures.", 8],
  ["Fixture pac: Chamorro celebrity chef shares a Guam itinerary", "https://paper.example.com/pac-7", "Chamorro cooks lead the tour.", 9],
  ["Fixture pac: Samoa’s prime minister attends a regional summit in Apia", "https://paper.example.com/pac-8", "Leaders gathered.", 10],
  ["Fixture pac: Vanuatu volcano alert issued", "https://paper.example.com/pac-10", "Officials raised the alert level.", 12],
  ["Fixture pac: A Tahiti honeymoon itinerary from a TV star", "https://paper.example.com/pac-11", "The couple shared photos.", 13],
]);
FEEDS["/pacnet-c.xml"] = rss([
  ["Fixture pac: Fiji budget debate (community outlet)", "https://community.example.com/pac-9", "Treasury figures were released.", 11],
]);
FEEDS["/rnz-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[
  ["Vanuatu climate case at the world court gains support", "RNZ", "https://www.rnz.co.nz"],
  ["All Blacks name team for the Fixture test", "RNZ", "https://www.rnz.co.nz"],
  ["Wellington housing market update", "RNZ", "https://www.rnz.co.nz"],
  ["Pacific Islanders in Auckland rally for a Fixture cause", "Stuff", "https://www.stuff.co.nz"],
  ["Pacific Islands Forum partner statement on LinkedIn", "LinkedIn", "https://www.linkedin.com"],
  ["Pacific Islands - Independence Movements", "Britannica", "https://www.britannica.com"],
].map(([t, pub, url], i) => gnew(30 + i, "Fixture rnz: " + t, pub, url)).join("")}</channel></rss>`;
// The Independent (independent.co.uk) is allowed through allowHosts, gated to stories that name the communities (gatedHosts "community": true).
const IND = "https://www.independent.co.uk/";
FEEDS["/ind.xml"] = rss([
  ["Fixture ind: On the brink of ruin, Pacific Islanders know who is to blame", IND + "climate-change/fixture-pacific-b1", "Locals urge the world to act at the next climate summit.", 3],
  ["Fixture ind: Trump hit by poll as Asian Americans sour on the economy", IND + "news/world/americas/fixture-b2", "A new survey was released.", 4],
  ["Fixture ind: Midterms preview", IND + "news/world/americas/fixture-b3", "Chinese Americans in Queens are watching the race closely.", 5],
  ["Fixture ind: Trump signs a farm aid package", IND + "news/world/americas/fixture-b4", "Farmers will get billions.", 6],
  ["Fixture ind: Hawaii holiday guide: the best beaches", IND + "travel/fixture-b5", "Where to stay.", 7],
  ["Fixture ind: Premier League table after the weekend", IND + "sport/fixture-b6", "Results from the weekend.", 8],
]);
FEEDS["/ind-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[
  ["Anti-Asian hate incidents rise in a Fixture city", "The Independent", "https://www.independent.co.uk"],
  ["Celebrity gossip roundup", "The Independent", "https://www.independent.co.uk"],
  ["Asian American voters weigh in on a Fixture race", "BBC News", "https://www.bbc.co.uk"],
].map(([t, pub, url], i) => gnew(50 + i, "Fixture ind: " + t, pub, url)).join("")}</channel></rss>`;
// Renamed sources, routes (aclu.org to Advocacy, csis.org to Research) and blocked sites (sources.json: renames, routes, excludeHosts, excludeNames).
FEEDS["/ren-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[
  ["Asian American voters weigh in", "Bloomberg.com", "https://www.bloomberg.com"],
  ["Asian American students rally on Guam", "guampdn.com", "https://www.guampdn.com"],
  ["Asian American restaurants reopen", "INQUIRER.net USA", ""],
  ["Asian American business owners meet", "Dallas News", "https://www.dallasnews.com"],
  ["Asian American inmates and a prison policy", "Washington State Department of Corrections (DOC) (.gov)", "https://doc.wa.gov"],
  ["Asian American speakers join a panel", "Associated Press", "https://apnews.com"],
  ["Asian American voters and a court ruling", "American Civil Liberties Union", "https://www.aclu.org"],
  ["Asian American security and a Pacific study", "CSIS | Center for Strategic and International Studies", "https://www.csis.org"],
  ["Asian American workers and a union survey", "AFL-CIO", "https://aflcio.org"],
  ["Asian American voters in Israel coverage", "The Times of Israel", "https://www.timesofisrael.com"],
  ["Asian American voters in a wire story", "Yahoo", "https://news.yahoo.com"],
  ["Asian American story shown by name only", "Yahoo News", ""],
  ["Asian American story from a county paper", "Lassen County News", ""],
].map(([t, pub, url], i) => gnew(70 + i, "Fixture ren: " + t, pub, url)).join("")}</channel></rss>`;
FEEDS["/ren-direct.xml"] = rss([
  ["Fixture ren: ACLU files an Asian American voting-rights brief", "https://www.aclu.org/press-releases/fixture-brief", "The ACLU filed a brief for Asian American voters.", 3],
  ["Fixture ren: CSIS publishes a study on Asian American security views", "https://www.csis.org/analysis/fixture-study", "A new study of Asian American views.", 4],
  ["Fixture ren: Asian American story on msn.com", "https://www.msn.com/en-us/news/fixture", "Asian American news.", 5],
  ["Fixture ren: Asian American story on aol.com", "https://www.aol.com/news/fixture", "Asian American news.", 6],
  ["Fixture ren: Asian American story on jpost.com", "https://www.jpost.com/fixture", "Asian American news.", 7],
  ["Fixture ren: Asian American story on newsbreak.com", "https://www.newsbreak.com/fixture", "Asian American news.", 8],
  ["Fixture ren: Asian American story on smartnews.com", "https://www.smartnews.com/fixture", "Asian American news.", 9],
  ["Fixture ren: Asian American story on universityherald.com", "https://www.universityherald.com/articles/fixture", "Asian American news.", 10],
  ["Fixture ren: Asian American story on cedarnews.net", "https://cedarnews.net/fixture", "Asian American news.", 11],
  ["Fixture ren: Asian American story on lassennews.com", "https://www.lassennews.com/fixture", "Asian American news.", 12],
  ["Fixture ren: Asian American story on publicservices.international", "https://publicservices.international/fixture", "Asian American news.", 13],
  ["Fixture ren: Asian American story on rightlivelihood.org", "https://rightlivelihood.org/fixture", "Asian American news.", 14],
  ["Fixture ren: Asian American story on socialist-alliance.org", "https://socialist-alliance.org/fixture", "Asian American news.", 15],
  ["Fixture ren: Asian American story on londondaily.news", "https://londondaily.news/fixture", "Asian American news.", 16],
  ["Fixture ren: Asian American story on al-monitor.com", "https://www.al-monitor.com/fixture", "Asian American news.", 17],
  ["Fixture ren: Asian American story on newsgram.com", "https://www.newsgram.com/fixture", "Asian American news.", 18],
  ["Fixture ren: Asian American story on ua.news", "https://ua.news/fixture", "Asian American news.", 19],
  ["Fixture ren: Asian American story on timesofisrael.com", "https://www.timesofisrael.com/fixture", "Asian American news.", 20],
  ["Fixture ren: Asian American story on aflcio.org", "https://aflcio.org/fixture", "Asian American news.", 21],
  ["Fixture ren: Asian American story on a yahoo subdomain", "https://sports.yahoo.com/fixture", "Asian American news.", 22],
  ["Fixture ren: Asian American story kept", "https://paper.example.com/ren-kept", "Asian American news.", 23],
]);
export const FR = { description: "x", count: 3, total_pages: 1, next_page_url: null, results: [
  { title: "Proposed Rule: Language access for Native Hawaiian and Pacific Islander programs", type: "Proposed Rule", abstract: "The Department proposes to expand language assistance for Native Hawaiian and Pacific Islander communities. Comments are invited from the public. This is a long second sentence that continues for quite a while so the abstract will need to be trimmed at a sentence boundary rather than mid-sentence, which keeps it the agency's own words.", html_url: "https://www.federalregister.gov/documents/2026/10/20/2026-1/language-access", publication_date: iso(new Date(today.getTime() - 6 * 864e5)), comments_close_on: plus(12), agency_names: ["Health and Human Services Department", "Centers for Medicare & Medicaid Services"], document_number: "2026-1" },
  { title: "Sunshine Act Meetings", type: "Notice", abstract: "Meeting of Native Hawaiian advisory panel", html_url: "https://www.federalregister.gov/documents/2026/10/21/2026-2/sunshine", publication_date: iso(today), comments_close_on: null, agency_names: ["X"], document_number: "2026-2" },
  { title: "Notice of funding for Asian American and Native American Pacific Islander-Serving Institutions", type: "Notice", abstract: null, html_url: "https://www.federalregister.gov/documents/2026/10/22/2026-3/aanapisi", publication_date: iso(today), comments_close_on: null, agency_names: ["Education Department"], document_number: "2026-3" },
] };

// ---- Policy tracker fixtures (every record is synthetic; the links are not real pages)
const days = n => new Date(today.getTime() - n * 864e5);
export const FR_ISSUE = [
  { title: "Fixture: Public charge ground of inadmissibility; proposed rule", type: "Proposed Rule", abstract: "The Department of Homeland Security proposes changes to immigration public charge determinations. Comments are due in 30 days.", html_url: "https://www.federalregister.gov/documents/2026/10/23/2026-4/public-charge", publication_date: iso(days(2)), comments_close_on: plus(20), agency_names: ["Homeland Security Department"], document_number: "2026-4" },
  { title: "Fixture: Immigration fee rule with a closed comment period", type: "Rule", abstract: "Fee changes for immigration benefit requests.", html_url: "https://www.federalregister.gov/documents/2026/09/01/2026-5/fees", publication_date: iso(days(40)), comments_close_on: iso(days(5)), agency_names: ["Homeland Security Department"], document_number: "2026-5" },
  { title: "Fixture: Immigration forms notice with no comment date", type: "Notice", abstract: "Forms update.", html_url: "https://www.federalregister.gov/documents/2026/10/24/2026-6/forms", publication_date: iso(days(1)), comments_close_on: null, agency_names: ["Homeland Security Department"], document_number: "2026-6" },
];
FR.results.push(...FR_ISSUE);
FR.results.push({ title: "Agency Information Collection Activities; Proposed Collection; Comment Request; Fixture survey", type: "Notice", abstract: "Collects data by race, including Native Hawaiian and Pacific Islander respondents.", html_url: "https://www.federalregister.gov/documents/2026/10/23/2026-7/aica", publication_date: iso(today), comments_close_on: null, agency_names: ["Y"], document_number: "2026-7" });
// Federal Register page 1 (the tests set perTerm to 3): boilerplate museum notices that mention Native Hawaiian organizations. They are skipped, so the collector must read page 2 for the real results.
export const FR_PAGE1 = { count: 99, total_pages: 2, next_page_url: null, results: [1, 2, 3].map(n => ({ title: "Notice of Inventory Completion: Fixture Museum " + n + ", City, ST", type: "Notice", abstract: "Consultation with Native Hawaiian organizations was completed.", html_url: "https://www.federalregister.gov/documents/2026/10/2" + n + "/2026-80" + n + "/nagpra", publication_date: iso(today), comments_close_on: null, agency_names: ["Interior Department / National Park Service"], document_number: "2026-80" + n })) };
const eo = (title, sub, num, ago, url, abs) => ({ title, type: "Presidential Document", subtype: sub, executive_order_number: num, abstract: abs ?? null, html_url: url, publication_date: iso(days(ago - 3)), signing_date: iso(days(ago)), agency_names: ["Executive Office of the President"], document_number: "2026-9" + ago });
export const EXEC_A = eo("Fixture: Executive Order on federal programs serving Native Hawaiian and Pacific Islander communities", "Executive Order", "99001", 6, "https://www.federalregister.gov/documents/2026/10/15/2026-9001/fixture-eo", "This order directs agencies to expand language access. It sets reporting deadlines.");
export const EXEC_N = { count: 2, results: [EXEC_A, eo("Fixture: Proclamation hosted on a non-.gov site", "Proclamation", null, 7, "https://example.com/proc")] };
export const EXEC_I = { count: 6, results: [EXEC_A, eo("Fixture: Executive Order on immigration case processing", "Executive Order", "99002", 10, "https://www.federalregister.gov/documents/2026/10/11/2026-9002/fixture-eo2"), eo("Fixture: Memorandum on refugee admissions", "Memorandum", null, 12, "https://www.federalregister.gov/documents/2026/10/09/2026-9003/fixture-memo"), eo("Fixture: Restriction on entry of certain nonimmigrant workers", "Proclamation", null, 14, "https://www.federalregister.gov/documents/2026/10/07/2026-9004/fixture-nonimm"), eo("Fixture: Labor Day, 2026", "Proclamation", null, 15, "https://www.federalregister.gov/documents/2026/10/06/2026-9005/fixture-labor-day"), eo("Fixture: Citizenship Day and Constitution Week, 2026", "Proclamation", null, 16, "https://www.federalregister.gov/documents/2026/10/05/2026-9006/fixture-citizenship-day")] };
FEEDS["/gov.xml"] = rss([
  ["Fixture: Justice Department charges man in hate crime attack on Asian American family", "https://www.justice.gov/opa/pr/fixture-hate-crime", "The Civil Rights Division announced charges.", 3],
  ["Fixture: USCIS announces H-1B registration update", "https://www.uscis.gov/newsroom/news-releases/fixture-h1b", "USCIS will open registration.", 4],
  ["Fixture: Department announces new parking rules at federal buildings", "https://www.justice.gov/opa/pr/fixture-parking", "", 5],
  ["Fixture: Statement on immigration from a non-gov site", "https://news.example.com/immigration", "Immigration policy statement.", 6],
  ["Fixture: Man sentenced in immigration document fraud scheme", "https://www.justice.gov/opa/pr/fixture-case", "A federal court sentenced a man for naturalization fraud.", 8],
  ["Fixture: Man sentenced for attack on Asian American family", "https://www.justice.gov/opa/pr/fixture-case-aapi", "The sentence follows a hate crime conviction.", 9]]);
FEEDS["/caucus.xml"] = rss([["Fixture: CAPAC condemns discriminatory posts", "https://capac.house.gov/press-release/fixture-1", "Chair statement.", 7]]);
const bill = (type, number, title, chamber, ago, act) => ({ congress: 119, type, number, title, originChamber: chamber, latestAction: { actionDate: iso(days(ago)), text: act }, updateDate: iso(days(ago)) + "T10:00:00Z", url: "x" });
export const CG_BILLS = { bills: [bill("HR", "4001", "Native Hawaiian Health Care Improvement Act of 2026", "House", 2, "Referred to the House Committee on Natural Resources."), bill("S", "77", "Immigration Court Language Access Act", "Senate", 1, "Read twice and referred to the Committee on the Judiciary."), bill("HR", "4002", "Highway Funding Act", "House", 1, "Referred to committee.")], pagination: { count: 3 } };
export const CG_SUMS = { summaries: [
  { bill: { congress: 119, type: "HR", number: "4001", title: "Native Hawaiian Health Care Improvement Act of 2026", originChamber: "House" }, text: "<p>This bill reauthorizes health programs for Native Hawaiians. It also adds oversight.</p>", actionDate: iso(days(2)), actionDesc: "Introduced in House", updateDate: iso(days(2)) + "T11:00:00Z" },
  { bill: { congress: 119, type: "HR", number: "4003", title: "To improve federal survey data collection", originChamber: "House" }, text: "<p>This bill requires disaggregated data for Asian American and Native Hawaiian and Pacific Islander subgroups. It also funds grants.</p>", actionDate: iso(days(3)), actionDesc: "Introduced in House", updateDate: iso(days(3)) + "T09:00:00Z" }] };
// stored feed from an older build (also used by the PHP test)
export const OLD = [
  { id: "oldblk1", d: days(2).toISOString(), s: "Hoodline", k: "news", t: "CULTURE", h: "Fixture block: stored Asian American story from a blocked publisher", m: "", u: "https://news.google.com/rss/articles/BLOCKOLD1" },
  { id: "oldblk2", d: days(2).toISOString(), s: "Direct Outlet", k: "news", t: "CULTURE", h: "Fixture block: stored Asian American story on a blocked site", m: "", u: "https://www.history.com/stored-asian-american" },
  { id: "oldfor1", d: days(2).toISOString(), s: "Swiss Fixture Post", k: "news", t: "CULTURE", h: "Fixture new: stored Asian American story from a .ch publisher", m: "", u: "https://news.google.com/rss/articles/NEWOLD1" },
  { id: "oldfor2", d: days(2).toISOString(), s: "Old Canada Fixture", ph: "old.example.ca", k: "news", t: "CULTURE", h: "Fixture new: stored Asian American story from a .ca publisher", m: "", u: "https://news.google.com/rss/articles/NEWOLD2" },
  { id: "oldgov1", d: days(2).toISOString(), s: "National Park Fixture Service", k: "news", t: "CULTURE", h: "Fixture new: stored Asian American story from a .gov publisher", m: "", u: "https://news.google.com/rss/articles/NEWOLD3" },
  { id: "oldroute1", d: days(2).toISOString(), s: "Asian Law Caucus", k: "news", t: "CULTURE", h: "Fixture new: stored Asian Law Caucus story", m: "", u: "https://news.google.com/rss/articles/NEWOLD4" },
  { id: "oldgate1", d: days(2).toISOString(), s: "Random Sports Fixture Daily", k: "news", t: "CULTURE", h: "Fixture new: stored Guam golf results", m: "", u: "https://news.google.com/rss/articles/NEWOLD5" },
  { id: "oldgate2", d: days(2).toISOString(), s: "The Guam Daily Post", k: "news", t: "CULTURE", h: "Fixture new: stored Guam election debate", m: "", u: "https://news.google.com/rss/articles/NEWOLD6" },
  { id: "oldrnz1", d: days(2).toISOString(), s: "RNZ Pacific", k: "news", t: "CULTURE", h: "Fixture rnz: stored Fiji sevens rugby squad", m: "", u: "https://www.rnz.co.nz/international/pacific-news/old-1" },
  { id: "oldrnz2", d: days(2).toISOString(), s: "RNZ Pacific", k: "news", t: "CULTURE", h: "Fixture rnz: stored Tuvalu seeks climate funding", m: "", u: "https://www.rnz.co.nz/international/pacific-news/old-2" },
  { id: "oldrnz3", d: days(2).toISOString(), s: "RNZ", ph: "rnz.co.nz", k: "news", t: "CULTURE", h: "Fixture rnz: stored All Blacks rugby result", m: "", u: "https://news.google.com/rss/articles/RNZOLD3" },
  { id: "oldrnz4", d: days(2).toISOString(), s: "RNZ", ph: "rnz.co.nz", k: "news", t: "CULTURE", h: "Fixture rnz: stored Pacific Islanders climate story", m: "", u: "https://news.google.com/rss/articles/RNZOLD4" },
  { id: "oldrnz5", d: days(2).toISOString(), s: "RNZ Pacific", k: "news", t: "CULTURE", h: "Fixture rnz: stored Fiji parliament sitting", m: "", u: "https://www.rnz.co.nz/international/pacific-news/old-5" },
  { id: "oldpac1", d: days(2).toISOString(), s: "Pacific Net", k: "news", t: "PACIFIC", h: "Fixture pac: stored Vanuatu cabinet reshuffle", m: "", u: "https://paper.example.com/old-pac-1" },
  { id: "oldpac2", d: days(2).toISOString(), s: "Pacific Net", k: "news", t: "PACIFIC", h: "Fixture pac: stored Hawaii and Tonga share a canoe", m: "", u: "https://paper.example.com/old-pac-2" },
  { id: "oldpac3", d: days(2).toISOString(), s: "Public Radio Guam", ph: "islapublic.org", k: "news", t: "PACIFIC", h: "Fixture pac: stored Governor describes benefits of Pacific Islands Forum membership", m: "", u: "https://news.google.com/rss/articles/PACOLD3" },
  { id: "oldpac4", d: days(2).toISOString(), s: "Some Wire", ph: "wire.example.com", k: "news", t: "PACIFIC", h: "Fixture pac: stored Governor describes benefits of Pacific Islands Forum membership (elsewhere)", m: "", u: "https://news.google.com/rss/articles/PACOLD4" },
  { id: "oldren1", d: days(2).toISOString(), s: "AP News", ph: "apnews.com", k: "news", t: "CULTURE", h: "Fixture ren: stored Asian American Associated Press story", m: "", u: "https://news.google.com/rss/articles/RENOLD1" },
  { id: "oldren2", d: days(2).toISOString(), s: "CAPAC", k: "govstmt", t: "GOVERNMENT", h: "Fixture ren: stored caucus statement", m: "", u: "https://capac.house.gov/press-release/fixture-old", rl: "n" },
  { id: "oldren3", d: days(2).toISOString(), s: "TAAF", ph: "taaf.org", k: "statement", t: "CULTURE", h: "Fixture ren: stored foundation statement", m: "", u: "https://news.google.com/rss/articles/RENOLD3" },
  { id: "oldren4", d: days(2).toISOString(), s: "Yahoo", ph: "yahoo.com", k: "news", t: "CULTURE", h: "Fixture ren: stored Yahoo story", m: "", u: "https://news.google.com/rss/articles/RENOLD4" },
  { id: "oldren5", d: days(2).toISOString(), s: "American Civil Liberties Union", ph: "aclu.org", k: "news", t: "CULTURE", h: "Fixture ren: stored ACLU story", m: "", u: "https://news.google.com/rss/articles/RENOLD5" },
  { id: "oldren6", d: days(2).toISOString(), s: "CSIS | Center for Strategic and International Studies", ph: "csis.org", k: "news", t: "CULTURE", h: "Fixture ren: stored Asian American CSIS story", m: "", u: "https://news.google.com/rss/articles/RENOLD6" },
  { id: "oldind1", d: days(2).toISOString(), s: "The Independent", ph: "independent.co.uk", k: "news", t: "CULTURE", h: "Fixture ind: stored celebrity gossip roundup", m: "", u: "https://news.google.com/rss/articles/INDOLD1" },
  { id: "oldind2", d: days(2).toISOString(), s: "The Independent", ph: "independent.co.uk", k: "news", t: "CULTURE", h: "Fixture ind: stored Native Hawaiian land rights ruling", m: "", u: "https://news.google.com/rss/articles/INDOLD2" },
  { id: "oldpew1", d: days(300).toISOString(), s: "Pew Research Center", k: "research", t: "CULTURE", h: "Fixture pew: stored report on Asian Americans", m: "", u: "https://www.pewresearch.org/race-and-ethnicity/2026/01/01/fixture-old-1/" },
  { id: "oldpew2", d: days(800).toISOString(), s: "Pew Research Center", k: "research", t: "CULTURE", h: "Fixture pew: stored report from before the two-year window", m: "", u: "https://www.pewresearch.org/race-and-ethnicity/2024/01/01/fixture-old-2/" },
  { id: "oldnews60", d: days(60).toISOString(), s: "Old Outlet", k: "news", t: "CULTURE", h: "Fixture pew: stored Asian American news story from two months ago", m: "", u: "https://old.example/news60" },
  { id: "oldok1", d: days(2).toISOString(), s: "Allowed Old Outlet", k: "news", t: "CULTURE", h: "Fixture block: stored Asian American story from an allowed site", m: "", u: "https://allowed.example/stored" },
  { id: "old1", d: days(5).toISOString(), s: "Old Outlet", t: "POLICY", h: "Samoan leaders ask Congress about American Samoa deep sea mining", m: "", u: "https://old.example/1" },
  { id: "old2", d: days(3).toISOString(), s: "Old Outlet", t: "CULTURE", h: "华裔社区庆祝中秋节", m: "", u: "https://old.example/2" },
  { id: "old3", d: days(2).toISOString(), s: "Congress.gov", k: "bill", ty: "H.R. 1", t: "GOVERNMENT", h: "Fixture: stored bill that links to a non-.gov site", m: "", u: "https://example.com/not-gov", rl: "n" },
  { id: "old4", d: days(100).toISOString(), s: "Federal Register", k: "order", ty: "Executive Order 98000", t: "GOVERNMENT", h: "Fixture: older executive order about Native Hawaiian programs", m: "", u: "https://www.federalregister.gov/documents/2026/07/01/2026-0001/older-eo", rl: "n" },
  { id: "old5", d: days(100).toISOString(), s: "Old Outlet", k: "news", t: "CULTURE", h: "Fixture: very old news story about Hawaii", m: "", u: "https://old.example/5" },  { id: "old6", d: days(4).toISOString(), s: "Old Group Name", k: "statement", t: "CULTURE", h: "Fixture: stored statement from a group that was renamed", m: "", u: "https://old.example/6" },
];

// ---- Regulations.gov and GovInfo (synthetic records, mock servers only)
const rg = (id, title, type, endDays, extra = {}) => ({ id, type: "documents", attributes: { agencyId: "FIX", documentType: type, title, commentEndDate: plus(endDays) + "T04:59:59Z", postedDate: iso(days(2)) + "T04:00:00Z", withdrawn: false, ...extra } });
export const REGS = { data: [
  rg("FIX-2026-0001-0001", "Fixture: Native Hawaiian and Pacific Islander language access in federal programs", "Proposed Rule", 20, { frDocNum: "2026-X1" }),
  rg("FIX-2026-0002-0001", "Fixture: Immigration benefit fee reporting requirements", "Notice", 10, { frDocNum: "2026-X2" }),
  rg("FIX-2026-0003-0001", "Fixture: Public charge duplicate of a Federal Register listing", "Proposed Rule", 15, { frDocNum: "2026-4" }),
  rg("FIX-2026-0004-0001", "Fixture: Rule on commercial fishing quotas", "Rule", 15),
  rg("FIX-2026-0005-0001", "Fixture: Immigration comment period that already closed", "Rule", -2),
  rg("FIX-2026-0006-0001", "Fixture: Withdrawn immigration proposal", "Proposed Rule", 12, { withdrawn: true }),
  rg("FIX-2026-0007-0001", "Fixture: Supporting material on immigration", "Supporting & Related Material", 12)] };
const gi = (title, col, pid, ago, auth) => ({ title, collectionCode: col, packageId: pid, dateIssued: iso(days(ago)), governmentAuthor: auth });
export const GI_N = { count: 4, offsetMark: "next", results: [
  gi("NATIVE HAWAIIAN HEALTH CARE IMPROVEMENT ACT", "PLAW", "PLAW-119publ77", 9, ["National Archives and Records Administration", "Office of the Federal Register"]),
  gi("Fixture: Pacific Islander communities and federal recovery programs", "CHRG", "CHRG-119hhrg99001", 20, ["Congress", "House of Representatives"]),
  gi("Native American tourism and visitor experience", "CRPT", "CRPT-119srpt20", 5, ["Congress", "Senate"])] };
export const GI_I = { count: 3, results: [
  gi("Fixture: Immigration court backlogs", "CRPT", "CRPT-119hrpt849", 3, ["Congress", "House of Representatives"]),
  gi("Fixture: Review of language access services", "GAOREPORTS", "GAOREPORTS-GAO-26-100", 4, ["Government Accountability Office"]),
  gi("Fixture: Immigration hearing in an unknown collection", "XYZ", "XYZ-1", 4, ["Congress"])] };

// ---- Advocacy-organization statements: a WordPress REST list and two listing pages (the same shapes the real sites use). Synthetic; the links are not real pages.
const longDate = n => { const d = days(n); return d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }) + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); };
const shortDate = n => { const d = days(n); return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); };
const gmt = n => days(n).toISOString().slice(0, 19);
export const WP_POSTS = [
  { link: "https://wp.example/press/voter-survey", title: { rendered: "Fixture: New survey finds 90% of AAPI adults plan to vote &#8211; and cost of living tops concerns" }, date_gmt: gmt(2), excerpt: { rendered: "<p>Fixture: Asian American voters were asked about the midterms and the cost of living.</p>\n" } },
  { link: "https://wp.example/press/cambodia", title: { rendered: "Fixture: Statement on deportations to Cambodia" }, date_gmt: gmt(3), excerpt: { rendered: "" } },
  { link: "https://wp.example/press/old-post", title: { rendered: "Fixture: Old post from two months ago" }, date_gmt: gmt(60), excerpt: { rendered: "" } },
];
// A listing page: a menu link without a date, a link that wraps everything (title, <time>, summary), a link whose date sits after it, a Webflow-style pair (a hidden "#" link and the real one),
// an image-only link, a story that is too old, a link that does not match, and a relative link with a tracking query.
export const ORG_PAGE = `<html><body><nav><a href="/org/story/wrapped">Menu label</a><a href="/org/about">About us</a></nav><main>
<a href="/org/story/wrapped?utm_source=x" class="block"><h3 class="teaser__title"><span>Fixture: Voting groups sue over intimidation of naturalized voters</span></h3><p><time datetime="${days(2).toISOString()}">${longDate(2)}</time></p><p>A coalition of civil rights groups today filed a federal lawsuit to stop a program.</p></a>
<div class="h3"><a href="/org/story/date-after">Fixture: Caucus statement on a plot targeting a Hindu place of worship</a></div><div class="row"><div>${longDate(5)} </div><div><a href="/org/press">Press Release</a></div></div><div class="body"><p>Washington, D.C. - Today, Rep.</p></div>
<a href="#" class="link w-condition-invisible"><div class="text-heading--medium">Hidden duplicate</div></a>
<a href="/org/story/webflow" class="link-module w-inline-block"><div class="text-body--xxsmall"><div class="inline-text">${shortDate(8)}</div><div class="inline-text"> – </div><div class="inline-text">Org</div></div><div class="text-heading--medium"><div class="inline-text">Fixture: Foundation statement on proposed changes to the 2030 Census </div><div class="inline-text"> ↗</div></div></a>
<a href="/org/story/image-only"><img src="x.jpg"></a>
<a href="/org/story/old-story"><h3>Fixture: Story from two months ago</h3><time datetime="${days(60).toISOString()}"></time></a>
<a href="/org/story/no-date"><h3>Fixture: Story with no date anywhere</h3></a>
</main></body></html>`;
// A congressional listing page whose links are absolute .gov addresses: read once by a News "statement" source and once by a Policy "govstmt" source.
export const GOV_PAGE = `<html><body><div class="h3"><a href="https://fixture.house.gov/press-release/fixture-census-rule">Fixture: Caucus chairs demand withdrawal of census rule affecting Asian American communities</a></div><div class="row"><div>${longDate(4)} </div></div></body></html>`;
// The White House /news/ listing (same markup shape as the live page): a title link inside <h2>, a category link, then a <time datetime>. Presidential actions are listed on the page too, but come from the Federal Register instead.
const wh = (path, title, n, cat) => `<li class="wp-block-post"><div class="wp-block-whitehouse-post-template__content"><h2 class="wp-block-post-title"><a href="https://fixture.whitehouse.gov${path}" target="_self" >${title}</a></h2><div class="wp-block-whitehouse-post-template__meta"><div class="taxonomy-category wp-block-post-terms"><a href="https://fixture.whitehouse.gov/${cat}/" rel="tag">${cat}</a></div><div class="wp-block-post-date"><time datetime="${days(n).toISOString()}">${longDate(n)}</time></div></div></div></li>`;
export const WH_NEWS = `<html><body><main><ul>${[
  wh("/releases/2026/10/fixture-nhpi-grants/", "Fixture: Administration announces Native Hawaiian and Pacific Islander education grants", 3, "releases"),
  wh("/fact-sheets/2026/10/fixture-visa-rule/", "Fixture: Fact Sheet on immigration visa processing changes", 2, "fact-sheets"),
  wh("/presidential-actions/2026/10/fixture-aapi-proclamation/", "Fixture: Proclamation recognizing Asian American communities", 2, "presidential-actions"),
  wh("/releases/2026/10/fixture-tariffs/", "Fixture: Tariffs on imported machinery", 1, "releases"),
  wh("/briefings-statements/2026/06/fixture-old-statement/", "Fixture: Old statement about Native Hawaiian programs", 200, "briefings-statements")].join("")}</ul><a href="/news/page/2/">Next</a></main></body></html>`;
// scmp.com topic page (Next.js): the stories are JSON in a <script> tag, not links in the HTML. Dates are epoch milliseconds, epoch seconds as text, or ISO text; one story appears twice (a "related" list).
const msAgo = n => String(days(n).getTime());
const topicStories = [
  { entityId: "1", headline: "Fixture: Chinese American families rally for language access in Houston", urlAlias: "/news/us/society/article/3380001/fixture-chinese-american-language-access", publishedDate: msAgo(1) },
  { entityId: "2", headline: "Fixture: Hmong community leaders &amp; allies mark a milestone", urlAlias: "/news/us/article/3380002/fixture-hmong-milestone?utm_source=x", publishedDate: String(Math.floor(days(2).getTime() / 1000)) },
  { entityId: "3", headline: "Fixture: Asian-Americans in Congress", urlAlias: "/news/us/politics/article/3380003/fixture-iso-date", publishedDate: days(3).toISOString() },
  { entityId: "4", headline: "Fixture: Tokyo stocks rise as Japan central bank holds rates", urlAlias: "/business/markets/article/3380004/fixture-tokyo-stocks", publishedDate: msAgo(1) },
  { entityId: "5", headline: "Fixture: Story from two months ago about Asian Americans", urlAlias: "/news/us/article/3380005/fixture-old", publishedDate: msAgo(60) },
  { entityId: "6", headline: "Fixture: Story with no date anywhere about Asian Americans", urlAlias: "/news/us/article/3380006/fixture-no-date" }];
export const SCMP_PAGE = `<html><head><script>window.dataLayer=[{"headline":"not the data"}]</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { topic: { name: "Asian-Americans", articles: topicStories }, related: [topicStories[0]] } } })}</script><script type="application/json">{"headline":"broken</script></head><body><a href="/news/us/article/1/menu">Menu</a></body></html>`;
// HuffPost's Asian Voices page: no dates anywhere, so the date is the creation time inside the 24-hex id at the end of each story link. Each card has an image link (no text) and a headline link; the section's own list is unit "main", and the page also carries an ad module of other HuffPost stories and a header promo link, which must not be read.
const oidAgo = n => Math.floor(days(n).getTime() / 1000).toString(16).padStart(8, "0") + "e4b0a2cccd44761d";
const hcard = (slug, title, n, unit) => `<div class="card"><a class="card__image__link" aria-hidden="true" tabindex="-1" href="https://www.huffpost.com/entry/${slug}_n_${oidAgo(n)}" data-vars-unit-name="${unit}"><div class="card__image"></div></a><a class="card__headline" href="https://www.huffpost.com/entry/${slug}_n_${oidAgo(n)}?utm_campaign=x" data-vars-unit-name="${unit}" data-vars-item-name="${title}"><div class="card__headline__text">${title}</div></a></div>`;
export const HUFF_PAGE = `<html><body><nav><a class="support-button" href="https://www.huffpost.com/entry/fixture-header-promo_n_${oidAgo(1)}" data-vars-unit-name="site_header"><span>Fixture: Header promo</span></a></nav><div class="ad">${hcard("fixture-ad-story", "Fixture: Recirculated story from another section", 1, "top_ad")}</div><main>${[hcard("fixture-asian-voices-1", "Fixture: Asian American filmmakers on telling their own stories", 2, "main"), hcard("fixture-asian-voices-2", "Fixture: An AAPI family’s first Lunar New Year at a new school", 5, "main"), hcard("fixture-old", "Fixture: Old Asian Voices essay", 60, "main")].join("")}</main></body></html>`;
// Google News search results for nytimes.com (what the collector reads for sites that block automated page reads): the publisher is in <source>, and the headline ends with " - Publisher"
const GSITE = { "Nichi Bei News": "https://www.nichibei.org", "Substack": "https://redwhiteandbrown.substack.com", "The Athletic": "https://www.nytimes.com", "The New York Times": "https://www.nytimes.com" }; // Google News gives each publisher's own address
const gnews = (n, t, pub, site = GSITE[pub] ?? "https://www.nytimes.com") => `<item><title>${t} - ${pub}</title><link>https://news.google.com/rss/articles/FIXTURE${n}?oc=5</link><pubDate>${new Date(today.getTime() - n * 36e5).toUTCString()}</pubDate><source url="${site}">${pub}</source></item>`;
FEEDS["/nyt-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[gnews(2, "Fixture: Asian American voters could decide a Texas race", "The New York Times"), gnews(3, "Fixture: WNBA Finals Game 7 predictions", "The Athletic"), gnews(4, "Fixture: Asian Americans react to a ruling on school admissions", "The Athletic")].join("")}</channel></rss>`;
FEEDS["/apnorc.xml"] = rss([["Fixture: Most AAPI adults say the economy is their top concern, AP-NORC poll finds", "https://apnorc.org/projects/fixture-aapi-economy", "A poll of Asian American, Native Hawaiian and Pacific Islander adults.", 70]]);
// Nichi Bei (Google News search of nichibei.org; the site refuses automated reads): author and archive index pages come back as results with a name or two words as the "headline" and are not stories; a story about Japan that mentions Nisei is about a U.S. community, one about Okinawa is not
FEEDS["/nichibei-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[gnews(12, "Fixture: Nikkei veterans honored at monument dedication", "Nichi Bei News"), gnews(13, "Karleen Chinen", "Nichi Bei News"), gnews(14, "News Archives", "Nichi Bei News"), gnews(15, "Fixture: Nisei translators trained at Fort Snelling to read Japanese documents", "Nichi Bei News"), gnews(16, "Fixture: Anger in Japan grows after a Marine is arrested in Okinawa", "Nichi Bei News")].join("")}</channel></rss>`;
// Red, White and Brown on GitHub (Substack refuses GitHub's servers, so it is read through a Google News search of the site): the newsletter's home and archive pages come back as results and are not stories; a story about prices in India is not about a U.S. community
FEEDS["/rwb-google.xml"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>g</title>${[gnews(21, "Fixture: South Asian Americans and the midterms", "Substack"), gnews(22, "Red, White and Brown", "Substack"), gnews(23, "Archive", "Substack"), gnews(24, "Fixture: Brace for grocery price hikes across India", "Substack")].join("")}</channel></rss>`;
FEEDS["/rwb.xml"] = rss([["Fixture: South Asian Americans and the midterms", "https://redwhiteandbrown.substack.com/p/fixture-midterms", "A newsletter about the South Asian American experience.", 3], ["Fixture: Brace for grocery price hikes across India", "https://redwhiteandbrown.substack.com/p/fixture-india", "", 4]]);
export const PC_POSTS = [
  { link: "https://www.pacificcitizen.org/fixture-nisei-veterans/", title: { rendered: "Fixture: JACL honors Nisei veterans at Heart Mountain" }, date_gmt: gmt(2), excerpt: { rendered: "<p>Fixture: The ceremony remembered Japanese American soldiers.</p>\n" } },
  { link: "https://www.pacificcitizen.org/fixture-okinawa/", title: { rendered: "Fixture: Okinawa base restrictions tighten after an arrest" }, date_gmt: gmt(3), excerpt: { rendered: "" } },
  { link: "https://www.pacificcitizen.org/fixture-old/", title: { rendered: "Fixture: Old Pacific Citizen post from two months ago about JACL" }, date_gmt: gmt(60), excerpt: { rendered: "" } }];
FEEDS["/notafeed.xml"] = "<html><body>This is a web page, not a feed.</body></html>";
// Pew (WordPress REST lists; dated with gmt above)
const pewPost = (slug, title, d, excerpt) => ({ link: "https://www.pewresearch.org/short-reads/2026/01/01/" + slug + "/", title: { rendered: title }, date_gmt: gmt(d), excerpt: { rendered: excerpt ? "<p>" + excerpt + "</p>\n" : "" } });
export const PEW_ASIAN = [
  pewPost("pew-voters", "Fixture pew: Asian American voters and the midterms", 3, "A look at Asian American voters."),
  pewPost("pew-key-facts", "Fixture pew: Key facts about Asians in the U.S.", 400, "A year-old fact sheet."),
  pewPost("pew-ack", "Acknowledgments", 3, ""),
  pewPost("pew-chapter", "1. Asian American immigrants&#8217; experiences adjusting to life in the U.S.", 3, ""),
  pewPost("pew-method", "Methodology", 3, ""),
  pewPost("pew-too-old", "Fixture pew: Asian Americans in 2023, too old to keep", 800, ""),
];
export const PEW_RACE = [
  pewPost("pew-nhpi", "Fixture pew: Key facts about Native Hawaiians and Pacific Islanders in the U.S.", 10, ""),
  pewPost("pew-latino", "Fixture pew: Latinos are split on the American dream", 5, "Latinos are divided."),
  pewPost("pew-neighbors", "Fixture pew: How Americans see their neighbors", 6, "Asian Americans and Black Americans describe their communities."),
  pewPost("pew-china", "Fixture pew: Views of China across Asian countries", 7, "People in Asian countries rate China."),
];
