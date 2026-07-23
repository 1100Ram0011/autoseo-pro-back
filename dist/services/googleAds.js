"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateKeywordIdeas = void 0;
const generateKeywordIdeas = async (seedKeyword) => {
    // TODO: Replace this mock implementation with actual Google Ads API integration
    // once the Developer Token is approved.
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (!seedKeyword || seedKeyword.trim() === '') {
        return { ideas: [] };
    }
    const baseKeyword = seedKeyword.toLowerCase().trim();
    // Generate realistic-looking mock data based on the seed
    const modifiers = [
        'best', 'top', 'cheap', 'services', 'near me',
        'guide', 'how to', 'examples', 'agency', 'company',
        'software', 'tools', 'free', 'online', 'cost'
    ];
    // Create 5-8 random mock ideas
    const numIdeas = Math.floor(Math.random() * 4) + 5;
    const ideas = [];
    // Always include the exact match as the first result
    ideas.push({
        keyword: baseKeyword,
        searchVolume: Math.floor(Math.random() * 50000) + 10000,
        competition: 'HIGH',
        cpcLow: (Math.random() * 2 + 0.5).toFixed(2),
        cpcHigh: (Math.random() * 10 + 3.0).toFixed(2)
    });
    for (let i = 0; i < numIdeas; i++) {
        const randomMod = modifiers[Math.floor(Math.random() * modifiers.length)];
        const isPrefix = Math.random() > 0.5;
        const ideaKw = isPrefix ? `${randomMod} ${baseKeyword}` : `${baseKeyword} ${randomMod}`;
        // Don't add duplicates
        if (ideas.some(item => item.keyword === ideaKw))
            continue;
        const compVal = Math.random();
        const competition = compVal > 0.7 ? 'HIGH' : (compVal > 0.3 ? 'MEDIUM' : 'LOW');
        const vol = competition === 'HIGH'
            ? Math.floor(Math.random() * 10000) + 1000
            : Math.floor(Math.random() * 1000) + 50;
        ideas.push({
            keyword: ideaKw,
            searchVolume: vol,
            competition: competition,
            cpcLow: (Math.random() * 1.5 + 0.1).toFixed(2),
            cpcHigh: (Math.random() * 5 + 1.0).toFixed(2)
        });
    }
    // Sort by volume descending
    ideas.sort((a, b) => b.searchVolume - a.searchVolume);
    return { ideas };
};
exports.generateKeywordIdeas = generateKeywordIdeas;
//# sourceMappingURL=googleAds.js.map